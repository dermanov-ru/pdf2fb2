/**
 * Шрифты без таблицы букв (ToUnicode). Типичный случай — PDF из Word или InDesign,
 * где шрифт вшит как CID Identity-H: pdf.js (и poppler) отдают вместо букв номера
 * глифов. Номера идут в порядке глифов исходного шрифта, а он почти всегда
 * отсортирован по Юникоду:
 *   .notdef, null, CR, затем ASCII (пробел = 3), затем Latin-1, Latin Extended,
 *   затем кириллица сплошным блоком.
 * ASCII и Latin-1 сдвинуты на постоянную величину, сдвиг кириллицы зависит от
 * шрифта — подбираем его по частотам русских букв.
 *
 * Чинится текст по одному шрифту целиком (pdf.js даёт стабильное имя шрифта на весь документ).
 */

import { PT_SERIF } from './ptserif-order.ts';

export type RawItem = { s: string; font: string };

const RU_FREQ: Record<string, number> = {
  о: 10.97, е: 8.45, а: 8.01, и: 7.35, н: 6.7, т: 6.26, с: 5.47, р: 4.73, в: 4.54, л: 4.4, к: 3.49,
  м: 3.21, д: 2.98, п: 2.81, у: 2.62, я: 2.01, ы: 1.9, ь: 1.74, г: 1.7, з: 1.65, б: 1.59, ч: 1.44,
  й: 1.21, х: 0.97, ж: 0.94, ш: 0.73, ю: 0.64, ц: 0.48, щ: 0.36, э: 0.32, ф: 0.26, ъ: 0.04, ё: 0.04,
};
const LOG_FREQ = new Map(Object.entries(RU_FREQ).map(([k, v]) => [k, Math.log(v)]));
const ASCII_SHIFT = 0x1d; // глиф 3 → U+0020
const LATIN1_FROM = 0x62; // 3 + 95 глифов ASCII → U+00A0
const LATIN1_SHIFT = 0x3e;

const isGlyphCode = (c: number) => (c >= 0x01 && c < 0x20) || (c >= 0x100 && c < 0x300);

/** Похоже ли, что шрифт отдаёт номера глифов вместо букв. */
function looksGlyphCoded(text: string): boolean {
  let bad = 0;
  let total = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c === 0x20 || c === 0x0a) continue;
    total++;
    if (isGlyphCode(c)) bad++;
  }
  return total >= 40 && bad / total > 0.5;
}

/** Сдвиг кириллицы: при каком сдвиге коды ≥ 0x100 больше всего похожи на русский текст. */
function cyrShift(text: string): number | null {
  const counts = new Map<number, number>();
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x100) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  let best: number | null = null;
  let bestScore = -Infinity;
  // самый частый код — одна из русских строчных; проверяем каждую
  for (const letter of Object.keys(RU_FREQ)) {
    const k = letter.codePointAt(0)! - top;
    let score = 0;
    for (const [c, n] of counts) {
      const ch = String.fromCodePoint(c + k).toLowerCase();
      score += n * (LOG_FREQ.get(ch) ?? (c + k >= 0x400 && c + k < 0x530 ? -3 : -8));
    }
    if (score > bestScore) (bestScore = score), (best = k);
  }
  return best;
}

/** Сдвиг кириллицы PT Serif: «А» — глиф 0x149. Совпал — берём точную таблицу шрифта. */
const PT_SERIF_SHIFT = 0x410 - 0x149;

function decodeWith(s: string, k: number): string {
  const exact = k === PT_SERIF_SHIFT ? PT_SERIF : null;
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const u = exact?.get(c);
    if (c === 0x20) out += ' '; // пробел, который вставил сам pdf.js
    else if (u) out += String.fromCodePoint(u);
    else if (c >= 0x03 && c < LATIN1_FROM) out += String.fromCodePoint(c + ASCII_SHIFT);
    else if (c >= LATIN1_FROM && c < 0xc2) out += String.fromCodePoint(c + LATIN1_SHIFT);
    else if (c >= 0x100 && c + k >= 0x400 && c + k < 0x530) out += String.fromCodePoint(c + k);
    else out += '\u0000'; // неизвестный глиф: ниже решим, тире это или мусор
  }
  return out;
}

/** Отдельно стоящий неизвестный глиф между пробелами — длинное тире; прочий мусор выкидываем. */
function finish(s: string): string {
  return s
    .replace(/(\d)[\u0000Ѡ-ԯ](?=\d)/g, '$1–')
    .replace(/(^|\s)[\u0000Ѡ-ԯ](?=\s|$)/g, '$1—')
    .replace(/\u0000/g, '');
}

/**
 * Чинит текст шрифтов, которые отдают номера глифов. Меняет item.s на месте.
 * Возвращает число починенных шрифтов.
 */
export function fixGlyphFonts(items: RawItem[]): number {
  const byFont = new Map<string, string[]>();
  for (const it of items) {
    const arr = byFont.get(it.font) ?? [];
    arr.push(it.s);
    byFont.set(it.font, arr);
  }
  const shifts = new Map<string, number>();
  const sizes = new Map<string, number>();
  for (const [font, strs] of byFont) {
    const text = strs.join(' ');
    if (!looksGlyphCoded(text)) continue;
    const k = cyrShift(text);
    if (k !== null) shifts.set(font, k), sizes.set(font, text.length);
  }
  if (!shifts.size) return 0;
  // у шрифта с парой заголовков статистики мало: берём сдвиг самого большого шрифта (гарнитура обычно одна)
  const main = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  for (const [font, n] of sizes) if (n < 400) shifts.set(font, shifts.get(main)!);
  for (const it of items) {
    const k = shifts.get(it.font);
    if (k !== undefined) it.s = finish(decodeWith(it.s, k));
  }
  return shifts.size;
}
