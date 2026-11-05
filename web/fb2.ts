/** FB2 (FictionBook 2.0) из разобранной книги. Порт fb2.py без картинок. */
import type { Book } from './extract.ts';

export const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const p = (t: string) => `<p>${esc(t)}</p>`;

export function splitAuthor(author: string) {
  const parts = author.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: '', middle: '', last: '' };
  if (parts.length === 1) return { first: '', middle: '', last: parts[0] };
  // «Фамилия И. О.» или «Имя Отчество Фамилия»
  if (/^[А-ЯЁA-Z]\.$/.test(parts[1] ?? '')) return { last: parts[0], first: parts[1], middle: parts.slice(2).join(' ') };
  return { first: parts[0], middle: parts.slice(1, -1).join(' '), last: parts[parts.length - 1] };
}

export function bookId(book: Book) {
  const s = `${book.author}|${book.title}|${book.pages}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return 'pdf2fb2-' + (h >>> 0).toString(16);
}

export function buildFb2(book: Book): string {
  const a = splitAuthor(book.author);
  const author =
    '<author>' +
    (a.first ? `<first-name>${esc(a.first)}</first-name>` : '') +
    (a.middle ? `<middle-name>${esc(a.middle)}</middle-name>` : '') +
    (a.last ? `<last-name>${esc(a.last)}</last-name>` : '<nickname>неизвестен</nickname>') +
    '</author>';
  const today = new Date().toISOString().slice(0, 10);
  const sections = book.sections.filter((s) => s.include);
  const body = [
    '<body>',
    `<title>${book.author ? p(book.author) : ''}${p(book.title)}</title>`,
    ...sections.map((s) => ['<section>', `<title>${p(s.title)}</title>`, ...s.paragraphs.map(p), '</section>'].join('\n')),
    '</body>',
  ].join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">',
    '<description>',
    '<title-info>',
    '<genre>nonfiction</genre>',
    author,
    `<book-title>${esc(book.title)}</book-title>`,
    '<lang>ru</lang>',
    '</title-info>',
    '<document-info>',
    '<author><nickname>pdf2fb2</nickname></author>',
    '<program-used>pdf2fb2 web (dermanov.ru/pdf2fb2/)</program-used>',
    `<date value="${today}">${today}</date>`,
    `<id>${bookId(book)}</id>`,
    '<version>1.0</version>',
    '</document-info>',
    '</description>',
    body,
    '</FictionBook>',
  ].join('\n');
}
