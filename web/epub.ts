/**
 * EPUB 3 из разобранной книги. Оглавление и в nav.xhtml (EPUB 3), и в toc.ncx —
 * для старых читалок. mimetype лежит первым и без сжатия, как требует стандарт.
 */
import { zipSync, strToU8 } from 'fflate';
import type { Book } from './extract.ts';
import { esc, bookId } from './fb2.ts';

const xhtml = (title: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ru" lang="ru">
<head><meta charset="UTF-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>`;

const CSS = `body { font-family: serif; line-height: 1.5; margin: 0 4%; }
h1 { font-size: 1.5em; margin: 1.5em 0 1em; text-align: center; }
p { margin: 0; text-indent: 1.5em; text-align: justify; }
.title { text-align: center; margin-top: 30%; }
.title p { text-indent: 0; text-align: center; }
.title .book { font-size: 1.8em; font-weight: bold; margin-top: 0.5em; }`;

export function buildEpub(book: Book): Uint8Array {
  const id = bookId(book);
  const sections = book.sections.filter((s) => s.include);
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  files['mimetype'] = [strToU8('application/epub+zip'), { level: 0 }];
  files['META-INF/container.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  files['OEBPS/style.css'] = strToU8(CSS);
  files['OEBPS/title.xhtml'] = strToU8(
    xhtml(book.title, `<div class="title">${book.author ? `<p>${esc(book.author)}</p>` : ''}<p class="book">${esc(book.title)}</p></div>`),
  );
  const names = sections.map((_, i) => `ch${String(i + 1).padStart(3, '0')}.xhtml`);
  sections.forEach((s, i) => {
    files[`OEBPS/${names[i]}`] = strToU8(xhtml(s.title, `<h1>${esc(s.title)}</h1>\n` + s.paragraphs.map((t) => `<p>${esc(t)}</p>`).join('\n')));
  });
  files['OEBPS/nav.xhtml'] = strToU8(
    xhtml(
      'Оглавление',
      `<nav epub:type="toc" id="toc"><h1>Оглавление</h1><ol>\n${sections.map((s, i) => `<li><a href="${names[i]}">${esc(s.title)}</a></li>`).join('\n')}\n</ol></nav>`,
    ),
  );
  files['OEBPS/toc.ncx'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${id}"/></head>
<docTitle><text>${esc(book.title)}</text></docTitle>
<navMap>
${sections.map((s, i) => `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(s.title)}</text></navLabel><content src="${names[i]}"/></navPoint>`).join('\n')}
</navMap>
</ncx>`);
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  files['OEBPS/content.opf'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="ru">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${id}</dc:identifier>
<dc:title>${esc(book.title)}</dc:title>
${book.author ? `<dc:creator>${esc(book.author)}</dc:creator>` : ''}
<dc:language>ru</dc:language>
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
${names.map((n, i) => `<item id="c${i + 1}" href="${n}" media-type="application/xhtml+xml"/>`).join('\n')}
</manifest>
<spine toc="ncx">
<itemref idref="title"/>
<itemref idref="nav"/>
${names.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('\n')}
</spine>
</package>`);
  return zipSync(files as any);
}
