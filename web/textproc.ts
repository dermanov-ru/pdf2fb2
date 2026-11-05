/**
 * Сборка абзацев из строк страницы. Порт textproc.py из pdf2fb2.
 *
 * Свёрстанная книга (InDesign, TeX) кодирует абзацы отступом красной строки.
 * Правила те же, что в CLI:
 *  - красная строка (отступ в разумных пределах) начинает новый абзац;
 *  - строка у левого края или глубоко под буквицей продолжает абзац;
 *  - перенос в конце строки склеивается, настоящий дефис («во-первых») остаётся;
 *  - номера страниц выбрасываются;
 *  - разрыв страницы абзац не заканчивает;
 *  - режим hanging для списка литературы: новая запись начинается от края.
 */

export type Line = {
  text: string;
  /** отступ от левого края колонки в долях кегля основного текста (em) */
  indent: number;
  /** с этой строки точно начинается новый абзац: буквица, смена кегля (сноска, врезка) */
  force?: boolean;
};

const KEEP_HYPHEN_NEXT = new RegExp(
  '^(перв|втор|трет|четверт|пят|шест|седьм|восьм|девят|десят' +
    '|нибудь|либо|то|таки|как|русск|абхазск|прежнему|новому|моему|твоему' +
    '|своему|нашему|вашему|разному|другому|всякому|человечески|осеннему' +
    '|зимнему|летнему|весеннему|доброму|хорошему|прошлому|видимому)',
  'i',
);
const PAGENUM = /^\s*\d{1,3}\s*$/;

/** Красная строка в em: в CLI это 2–6 пробелов `pdftotext -layout`. */
export const PARA_MIN = 0.5;
export const PARA_MAX = 2.6;

export function joinHyphen(buf: string, frag: string): string {
  frag = frag.trim();
  if (!frag) return buf;
  if (buf.endsWith('-') && !buf.endsWith('--')) {
    const firstWord = frag.split(' ', 1)[0];
    if (KEEP_HYPHEN_NEXT.test(firstWord)) return buf + frag;
    return buf.slice(0, -1) + frag;
  }
  if (!buf) return frag;
  return buf + ' ' + frag;
}

export function buildParagraphs(lines: Line[], opts: { hanging?: boolean } = {}): string[] {
  const paras: string[] = [];
  let buf = '';
  const flush = () => {
    if (buf.trim()) paras.push(buf.trim());
    buf = '';
  };
  for (const l of lines) {
    const t = l.text.trim();
    if (!t || PAGENUM.test(t)) continue;
    if (opts.hanging) {
      if (l.indent < 0.3) {
        flush();
        buf = t;
      } else buf = joinHyphen(buf, t);
      continue;
    }
    if (l.force || (l.indent >= PARA_MIN && l.indent <= PARA_MAX)) {
      flush();
      buf = t;
    } else buf = joinHyphen(buf, t);
  }
  flush();
  return paras;
}

/** Заголовок из капса в нормальный регистр: «ДЕТСТВО» → «Детство», короткие аббревиатуры остаются. */
export function tidyTitle(s: string, proper: Set<string> = new Set()): string {
  s = s.replace(/\s+/g, ' ').trim();
  let first = true;
  let afterInitial = false;
  return s
    .split(' ')
    .map((w) => {
      const core = w.replace(/[^A-Za-zА-Яа-яЁё]/g, '');
      const isCaps = core.length > 1 && core === core.toUpperCase();
      let out: string;
      if (!isCaps) out = w; // слово уже в нормальном регистре — не трогаем
      else if (core.length <= 4 && !first) out = w; // СССР, АН
      else {
        out = w.toLowerCase();
        if (proper.has(core.toLowerCase()) || afterInitial) out = out.replace(/[a-zа-яё]/, (c) => c.toUpperCase());
      }
      afterInitial = /^[А-ЯЁA-Z]\.$|[А-ЯЁA-Z]\.[А-ЯЁA-Z]\.$/.test(w);
      if (first && core) {
        out = out.replace(/[A-Za-zА-Яа-яЁё]/, (c) => c.toUpperCase());
        first = false;
      }
      return out;
    })
    .join(' ')
    .replace(/([.!?]\s+)([а-яёa-z])/g, (_, a, c) => a + c.toUpperCase());
}
