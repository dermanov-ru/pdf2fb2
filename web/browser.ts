/** Обвязка для браузера: pdf.js с пропатченным воркером (см. pdfjs-patch.mjs). */
// legacy-сборка: в современной pdf.js 6 есть Map.getOrInsertComputed, которого нет в Chrome до 2026 года
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?worker';
import { extractBook, type Book } from './extract.ts';

let workerReady = false;

export async function convertFile(file: File, onProgress: (done: number, total: number) => void): Promise<Book> {
  if (!workerReady) {
    pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
    workerReady = true;
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    return await extractBook(doc as any, file.name, onProgress);
  } finally {
    task.destroy();
  }
}
