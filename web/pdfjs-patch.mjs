/**
 * Патч рабочего модуля pdf.js: широкое «невидимое» U+00AD не выбрасывать.
 *
 * В InDesign-шрифтах длинное тире бывает записано символом 173, а его ToUnicode — U+00AD
 * (мягкий перенос). pdf.js считает U+00AD невидимым знаком форматирования и пропускает
 * глиф, и в тексте вместо «Папа — инвалид» получается «Папа инвалид». pdftotext такие
 * тире сохраняет. Настоящий мягкий перенос нулевой или узкий, тире — шириной в кегль,
 * поэтому глиф шире половины em оставляем; extract.ts превращает его в «—».
 */
const TARGET = 'if (category.isInvisibleFormatMark) {';
const FIX = 'if (category.isInvisibleFormatMark && !(glyph.unicode === "\\u00ad" && glyph.width >= 500)) {';

export function patchPdfWorker(code) {
  if (!code.includes(TARGET)) return null;
  return code.replace(TARGET, FIX);
}

/** Плагин Vite: правит pdf.worker.mjs при сборке. Без цели падает, чтобы обновление pdf.js не сломало тире молча. */
export function pdfjsDashPlugin() {
  return {
    name: 'pdfjs-soft-hyphen-dash',
    enforce: 'pre',
    transform(code, id) {
      if (!/pdfjs-dist[\\/].*pdf\.worker(\.min)?\.mjs/.test(id)) return;
      const out = patchPdfWorker(code);
      if (out) return { code: out, map: null };
      // ?worker — обёртка Vite без кода pdf.js; сам модуль придёт отдельным id
      if (!id.includes('?')) this.error('pdfjs-patch: не нашёл место для патча в ' + id + ' — проверь после обновления pdfjs-dist');
    },
  };
}
