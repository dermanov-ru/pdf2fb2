/**
 * Из PDF (pdf.js) в разметку книги: строки с отступами, главы, метаданные.
 *
 * Вместо `pdftotext -layout` из CLI работаем с координатами pdf.js:
 *  - кегль основного текста — самый частый размер по числу букв;
 *  - левый край колонки — самый частый x строк основного кегля на странице;
 *  - отступ строки считаем в em этого кегля;
 *  - буквица — одиночная крупная буква, приклеиваем к верхней строке рядом;
 *  - колонтитулы — строки, которые повторяются на многих страницах;
 *  - главы — закладки PDF, а если их нет, крупные заголовки (кегль ≥ 1,3 основного).
 */
import { buildParagraphs, tidyTitle, type Line } from './textproc.ts';
import { fixGlyphFonts, type RawItem } from './glyphfix.ts';

const TOC_LINE = /(\s*[.·…]){3,}\s*\d{1,4}\s*$/;
const TOC_HEAD = /^(оглавление|содержание|contents)\s*:?$/i;
const normKey = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '');

/** То, что нужно от pdf.js. Тип свой, чтобы ядро не зависело от сборки pdf.js. */
export type PdfDoc = {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: any[] }> }>;
  getOutline(): Promise<any[] | null>;
  getDestination(id: string): Promise<any[] | null>;
  getPageIndex(ref: any): Promise<number>;
  getMetadata(): Promise<{ info: any }>;
};

type Item = { s: string; x: number; y: number; w: number; fs: number };
type PLine = { page: number; y: number; x: number; fs: number; text: string; dropCap?: boolean; dropLetter?: string };

export type Section = {
  title: string;
  pageFrom: number;
  pageTo: number;
  paragraphs: string[];
  chars: number;
  include: boolean;
  /** почему глава снята автоматически — показываем рядом с галочкой */
  skip?: string;
  hanging: boolean;
};

export type Book = {
  title: string;
  author: string;
  pages: number;
  /** мало текста на страницу: скорее всего скан без текстового слоя */
  scanned: boolean;
  fromOutline: boolean;
  sections: Section[];
};

const SKIP_TITLE = /^(содержание|оглавление|указатель|именной указатель|предметный указатель|выходные данные|contents|index)(?=$|[\s.:])/i;
function skipReason(title: string, chars: number, front: boolean): string | undefined {
  const m = title.match(SKIP_TITLE);
  if (m) return m[1].toLowerCase().startsWith('указат') || m[1].toLowerCase() === 'index' ? 'указатель' : m[1].toLowerCase() === 'выходные данные' ? 'выходные данные' : 'оглавление';
  if (front) return 'титул';
  if (chars < 400) return 'пустые страницы';
  return undefined;
}
const BIB_TITLE = /(литератур|библиограф|источник|bibliograph|references)/i;
const letters = (s: string) => s.replace(/[^A-Za-zА-Яа-яЁё]/g, '');

function round(n: number, step: number) {
  return Math.round(n / step) * step;
}

function modeOf(values: number[], weights?: number[]): number {
  const m = new Map<number, number>();
  values.forEach((v, i) => m.set(v, (m.get(v) ?? 0) + (weights ? weights[i] : 1)));
  let best = values[0] ?? 0;
  let bw = -1;
  for (const [v, w] of m) if (w > bw) (best = v), (bw = w);
  return best;
}

type Raw = RawItem & { transform: number[]; width: number };

function rawItems(raw: any[]): Raw[] {
  return raw
    .filter((it) => typeof it.str === 'string' && it.str.trim())
    .map((it) => ({ s: it.str, font: it.fontName ?? '', transform: it.transform, width: it.width }));
}

function toItems(raw: Raw[]): Item[] {
  const out: Item[] = [];
  for (const it of raw) {
    if (!it.s.trim()) continue;
    const t = it.transform;
    // U+00AD сюда доходит только широким (патч pdf.js) — это длинное тире
    // управляющие символы между пробелами в книжных шрифтах — тоже тире (0x1F, 0x82…)
    const s = it.s.replace(/\u00ad/g, '—').replace(/(^|\s)[\u0001-\u0008\u000b\u000c\u000e-\u001f\u0080-\u009f](?=\s|$)/g, '$1—').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u0080-\u009f]/g, '');
    out.push({ s, x: t[4], y: t[5], w: it.width, fs: Math.hypot(t[2], t[3]) || Math.abs(t[3]) });
  }
  return out;
}

/** Строки страницы: группируем элементы по базовой линии. */
function toLines(items: Item[], page: number, bodyFs: number): PLine[] {
  const dropCaps = items.filter((i) => letters(i.s).length === 1 && i.s.trim().length === 1 && i.fs >= bodyFs * 1.8);
  const rest = items.filter((i) => !dropCaps.includes(i)).sort((a, b) => b.y - a.y || a.x - b.x);
  const tol = bodyFs * 0.35;
  const groups: Item[][] = [];
  for (const it of rest) {
    const g = groups.find((gr) => Math.abs(gr[0].y - it.y) < tol);
    if (g) g.push(it);
    else groups.push([it]);
  }
  const lines: PLine[] = groups.map((g) => {
    g.sort((a, b) => a.x - b.x);
    let text = '';
    let end = -Infinity;
    for (const it of g) {
      const gap = it.x - end;
      if (text && gap > bodyFs * 0.15 && !text.endsWith(' ') && !it.s.startsWith(' ')) text += ' ';
      text += it.s;
      end = it.x + it.w;
    }
    const main = g.reduce((a, b) => (b.s.length > a.s.length ? b : a));
    // перенос отдельным элементом в конце строки («срав» + «-») не должен отрываться пробелом
    text = text.replace(/\s+/g, ' ').trim().replace(/\s+([-‐])$/, '$1');
    return { page, y: g[0].y, x: g[0].x, fs: round(main.fs, 0.5), text };
  });
  lines.sort((a, b) => b.y - a.y);
  // буквица: к самой верхней строке справа от неё в пределах её высоты
  for (const dc of dropCaps) {
    const target = lines
      .filter((l) => l.x > dc.x && l.y >= dc.y - tol && l.y <= dc.y + dc.fs * 1.2)
      .sort((a, b) => b.y - a.y)[0];
    if (target) {
      target.dropLetter = dc.s.trim();
      target.text = dc.s.trim() + target.text;
      target.dropCap = true;
      target.x = dc.x;
    }
  }
  return lines;
}

async function outlineStarts(doc: PdfDoc): Promise<{ title: string; page: number }[]> {
  const outline = await doc.getOutline().catch(() => null);
  if (!outline?.length) return [];
  const out: { title: string; page: number }[] = [];
  for (const o of outline) {
    try {
      const dest = typeof o.dest === 'string' ? await doc.getDestination(o.dest) : o.dest;
      if (!dest?.[0]) continue;
      const idx = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0]);
      out.push({ title: String(o.title ?? '').trim(), page: idx + 1 });
    } catch {
      /* битая закладка — пропускаем */
    }
  }
  return out.sort((a, b) => a.page - b.page);
}

export async function extractBook(doc: PdfDoc, fileName: string, onProgress?: (done: number, total: number) => void): Promise<Book> {
  const n = doc.numPages;
  const rawPages: Raw[][] = [];
  for (let p = 1; p <= n; p++) {
    const page = await doc.getPage(p);
    rawPages.push(rawItems((await page.getTextContent()).items));
    onProgress?.(p, n);
  }
  // шрифты без таблицы букв отдают номера глифов — переводим обратно в буквы до всего остального
  fixGlyphFonts(rawPages.flat());
  const perPage: Item[][] = rawPages.map(toItems);
  const all = perPage.flat();
  const totalChars = all.reduce((s, i) => s + i.s.length, 0);
  const bodyFs = modeOf(all.map((i) => round(i.fs, 0.5)), all.map((i) => i.s.length)) || 10;

  let lines = perPage.flatMap((items, i) => toLines(items, i + 1, bodyFs));

  // буквица-предлог («Я», «В»): «Япоступил» → «Я поступил», если так пишется в самой книге
  // словарь книги без самих строк с буквицей, иначе «япоступил» найдёт сам себя
  const vocab = new Set(lines.filter((l) => !l.dropLetter).flatMap((l) => l.text.toLowerCase().split(/[^а-яёa-z]+/)).filter(Boolean));
  for (const l of lines) {
    if (!l.dropLetter) continue;
    const rest = l.text.slice(l.dropLetter.length);
    const w = (rest.match(/^[А-Яа-яЁёA-Za-z]+/) ?? [''])[0].toLowerCase();
    const solo = /^[ЯВАИОУКСI]$/i.test(l.dropLetter);
    if (/^\d/.test(rest) || (solo && w && !vocab.has(l.dropLetter.toLowerCase() + w) && vocab.has(w))) l.text = l.dropLetter + ' ' + rest;
  }

  // колонтитулы: одинаковый текст (без цифр) на многих страницах
  const key = (l: PLine) => l.text.replace(/\d+/g, '#').toLowerCase();
  const seen = new Map<string, Set<number>>();
  for (const l of lines) {
    const k = key(l);
    if (k.length < 3) continue;
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k)!.add(l.page);
  }
  const runningMin = Math.max(5, n * 0.15);
  lines = lines.filter((l) => (seen.get(key(l))?.size ?? 0) < runningMin);

  // печатное оглавление: «Название . . . . 31» — берём оттуда написание глав, сами строки в текст не пускаем
  const toc = parseToc(lines);
  lines = lines.filter((l) => !TOC_LINE.test(l.text) && !TOC_HEAD.test(l.text.trim()));

  // левый край колонки на странице: самый частый x строк основного кегля
  const margin = new Map<number, number>();
  for (let p = 1; p <= n; p++) {
    const body = lines.filter((l) => l.page === p && Math.abs(l.fs - bodyFs) <= bodyFs * 0.12 && !l.dropCap);
    if (body.length) margin.set(p, modeOf(body.map((l) => round(l.x, 1))));
  }

  // заголовок: короткая строка заметно крупнее основного кегля и крупнее соседнего текста
  const big = new Set<PLine>();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (letters(l.text).length < 2 || l.text.length > 90 || /^\d+$/.test(l.text) || TOC_LINE.test(l.text)) continue;
    if (l.fs < bodyFs * 1.15) continue;
    const next = lines.slice(i + 1, i + 4).find((x) => x.page === l.page && x.fs < l.fs);
    const ref = next ? next.fs : bodyFs;
    if (l.fs >= ref * 1.1) big.add(l);
  }
  const isHeading = (l: PLine) => big.has(l);

  // начала глав
  type Start = { title: string; idx: number; page: number };
  const starts: Start[] = [];
  const outline = await outlineStarts(doc);
  const fromOutline = outline.length > 0;
  if (fromOutline) {
    for (const o of outline) {
      const idx = lines.findIndex((l) => l.page >= o.page);
      if (idx >= 0) starts.push({ title: o.title, idx, page: o.page });
    }
  } else {
    for (let i = 0; i < lines.length; i++) {
      if (!isHeading(lines[i])) continue;
      const parts = [lines[i].text];
      let j = i + 1;
      while (j < lines.length && isHeading(lines[j]) && lines[j].page === lines[i].page) parts.push(lines[j++].text);
      starts.push({ title: parts.join(' '), idx: i, page: lines[i].page });
      i = j - 1;
    }
  }

  // имена собственные: слова, которые в тексте почти всегда с большой буквы
  const caps = properNouns(lines);
  const titleMeta = guessMeta(lines, n);
  const nice = (t: string) => {
    const k = normKey(t);
    const hit = toc.find((e) => normKey(e) === k) ?? toc.find((e) => k.length > 4 && (normKey(e).startsWith(k) || k.startsWith(normKey(e))));
    return hit ?? tidyTitle(t, caps);
  };
  for (const st of starts) if (!fromOutline) st.title = nice(st.title);

  // сноска: мелкий кегль ниже последней строки основного текста на странице
  const lowestBody = new Map<number, number>();
  for (const l of lines) if (Math.abs(l.fs - bodyFs) <= bodyFs * 0.04 && !/^\d{1,4}$/.test(l.text)) lowestBody.set(l.page, Math.min(lowestBody.get(l.page) ?? Infinity, l.y));
  const isFootnote = (l: PLine) => l.fs <= bodyFs * 0.94 && l.y < (lowestBody.get(l.page) ?? -Infinity);

  const toLine = (l: PLine, prev?: PLine): Line => ({
    text: l.text,
    indent: (l.x - (margin.get(l.page) ?? l.x)) / bodyFs,
    force: l.dropCap || (prev ? Math.abs(prev.fs - l.fs) > bodyFs * 0.12 : false),
  });

  const sections: Section[] = [];
  const bounds = [...starts];
  if (!bounds.length || bounds[0].idx > 0) bounds.unshift({ title: 'Начало', idx: 0, page: 1 });
  for (let s = 0; s < bounds.length; s++) {
    const from = bounds[s].idx;
    const to = s + 1 < bounds.length ? bounds[s + 1].idx : lines.length;
    // в теле главы не нужны строки-заголовки; сноски внизу страницы уходят в конец главы,
    // чтобы абзац, перенесённый через страницу, не рвался на сноске
    const chunk = lines.slice(from, to).filter((l) => !isHeading(l));
    const notes = chunk.filter((l) => isFootnote(l));
    const body = chunk.filter((l) => !notes.includes(l));
    let title = bounds[s].title || `Часть ${s + 1}`;
    // титульный лист с названием книги — это вступление, а не глава
    if (titleMeta.title && normKey(title).includes(normKey(titleMeta.title))) title = 'Вступление';
    const hanging = BIB_TITLE.test(title);
    const conv: Line[] = body.map((l, k) => toLine(l, body[k - 1]));
    const paragraphs = buildParagraphs(conv, { hanging });
    if (notes.length) {
      const nconv: Line[] = notes.map((l, k) => ({ ...toLine(l, notes[k - 1]), force: /^\d{1,3}\s/.test(l.text) || k === 0 }));
      paragraphs.push(...buildParagraphs(nconv));
    }
    const chars = paragraphs.reduce((a, p) => a + p.length, 0);
    const front = s === 0 && bounds[0].title === 'Начало' && starts[0]?.idx !== 0;
    sections.push({
      title,
      pageFrom: bounds[s].page,
      pageTo: s + 1 < bounds.length ? Math.max(bounds[s].page, bounds[s + 1].page - (bounds[s + 1].idx === lines.findIndex((l) => l.page === bounds[s + 1].page) ? 1 : 0)) : n,
      paragraphs,
      chars,
      include: !skipReason(title, chars, front && starts.length > 0),
      skip: skipReason(title, chars, front && starts.length > 0),
      hanging,
    });
  }
  // если глав не нашли, всё одной частью и её включаем
  if (sections.length === 1) {
    sections[0].include = true;
    sections[0].skip = undefined;
    sections[0].title = 'Текст';
  }

  const meta = await doc.getMetadata().catch(() => ({ info: {} as any }));
  const info = meta.info ?? {};
  const stem = fileName.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
  return {
    title: (info.Title && String(info.Title).trim()) || titleMeta.title || stem,
    // «DudinaSP», «user01» — логин верстальщика из свойств файла, а не автор
    author: ((a) => (a && !/^[\w.-]+$/.test(a) ? a : ''))(info.Author ? String(info.Author).trim() : '') || titleMeta.author || '',
    pages: n,
    scanned: totalChars / Math.max(1, n) < 200,
    fromOutline,
    sections,
  };
}

/** Строки печатного оглавления → названия глав в том написании, как в книге. */
function parseToc(lines: PLine[]): string[] {
  const out: string[] = [];
  let acc = '';
  for (const l of lines) {
    if (TOC_HEAD.test(l.text.trim())) { acc = ''; continue; }
    if (TOC_LINE.test(l.text)) {
      const t = (acc + ' ' + l.text.replace(TOC_LINE, '')).replace(/\s+/g, ' ').trim();
      if (letters(t).length >= 2) out.push(t);
      acc = '';
    } else if (l.text.length < 70 && acc.length < 120) {
      // название главы может переноситься, а точки с номером уходят на следующую строку
      acc = acc && lines[lines.indexOf(l) - 1]?.page === l.page ? acc + ' ' + l.text : l.text;
    } else acc = '';
  }
  return out;
}

/** Слова, которые в середине предложения почти всегда пишутся с большой буквы. */
function properNouns(lines: PLine[]): Set<string> {
  const up = new Map<string, number>();
  const low = new Map<string, number>();
  for (const l of lines) {
    const words = l.text.split(/\s+/);
    for (let i = 1; i < words.length; i++) {
      const prev = words[i - 1];
      if (/[.!?…»]$/.test(prev)) continue;
      const w = words[i].replace(/[^А-Яа-яЁёA-Za-z-]/g, '');
      if (w.length < 3) continue;
      const k = w.toLowerCase();
      if (/^[А-ЯЁA-Z][а-яёa-z]/.test(w)) up.set(k, (up.get(k) ?? 0) + 1);
      else if (/^[а-яёa-z]/.test(w)) low.set(k, (low.get(k) ?? 0) + 1);
    }
  }
  const out = new Set<string>();
  for (const [k, n] of up) if (n >= 2 && n > (low.get(k) ?? 0) * 3) out.add(k);
  return out;
}

/** Название и автор с титульного листа: самая крупная строка первых страниц и имя рядом с ней. */
function guessMeta(lines: PLine[], n: number): { title: string; author: string } {
  const first = lines.filter((l) => l.page <= Math.min(5, n) && letters(l.text).length >= 2);
  if (!first.length) return { title: '', author: '' };
  const maxFs = Math.max(...first.map((l) => l.fs));
  const top = first.filter((l) => l.fs >= maxFs * 0.95);
  const page = top[0].page;
  // подзаголовок под названием чуть мельче («Ардзинба-Адзинба-Квадзба») — тоже часть названия
  const parts = top.filter((l) => l.page === page);
  for (const l of lines.filter((x) => x.page === page && !parts.includes(x))) {
    const last = parts[parts.length - 1];
    if (l.fs >= maxFs * 0.75 && Math.abs(l.y - last.y) < maxFs * 2.2 && letters(l.text).length >= 2) parts.push(l);
  }
  const title = tidyTitle(parts.map((l) => l.text).join(' '));
  const NAME = /^([А-ЯЁA-Z][а-яёa-z]+\s+){1,2}[А-ЯЁA-Z][а-яёa-z]+$|^([А-ЯЁA-Z]\.\s?){1,2}[А-ЯЁA-Z][а-яёa-z]+$/;
  const author = first.find((l) => l.page === page && l.fs < maxFs && NAME.test(l.text.trim()))?.text.trim() ?? '';
  return { title, author };
}
