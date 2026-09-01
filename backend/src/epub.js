// Ported from frontend/src/lib/epub.js — same EPUB3 structure, but built
// server-side now that the backend owns book data. Only difference from the
// frontend version is the JSZip output type (nodebuffer vs. blob).
import JSZip from "jszip";

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Mirrors frontend/src/lib/speech.js's TITLE_EXPANSIONS. Kept as a
// duplicate rather than shared, same reasoning as the rest of this file:
// small enough not to be worth monorepo tooling, and the two uses are
// genuinely different (this wraps markup around the original text for
// whatever reader opens the exported EPUB; speech.js rewrites text fed
// straight to our own in-app SpeechSynthesisUtterance).
const TITLE_EXPANSIONS = {
  mr: "Mister", mrs: "Missus", ms: "Miz", mx: "Mix", dr: "Doctor",
  prof: "Professor", jr: "Junior", sr: "Senior", rev: "Reverend",
  gen: "General", capt: "Captain", col: "Colonel", sgt: "Sergeant",
  lt: "Lieutenant", fr: "Father", msgr: "Monsignor", hon: "Honorable",
  sen: "Senator", rep: "Representative", gov: "Governor",
  vs: "versus", etc: "et cetera", approx: "approximately",
};

/**
 * Wraps recognized title abbreviations in <abbr title="..."> so the
 * original printed text ("Mr.") stays exactly as scanned, while readers/TTS
 * engines that honor the title attribute get a pronunciation hint
 * ("Mister"). Support for this varies a lot across EPUB readers — many
 * just speak the visible text and ignore it — so this is a best-effort
 * addition, not a guaranteed fix for every app the export gets opened in.
 */
function annotateAbbreviations(paragraph) {
  return escapeXml(paragraph).replace(/\b(\p{L}+)\.(?=\s|$)/gu, (match, word) => {
    const expansion = TITLE_EXPANSIONS[word.toLowerCase()];
    return expansion ? `<abbr title="${expansion}">${match}</abbr>` : match;
  });
}

function chapterXhtml(chapter) {
  const paragraphs = chapter.pages
    .flat()
    .map((p) => `<p>${annotateAbbreviations(p)}</p>`)
    .join("\n    ");
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head>
    <title>${escapeXml(chapter.title)}</title>
    <link rel="stylesheet" type="text/css" href="styles.css" />
  </head>
  <body>
    <h1>${escapeXml(chapter.title)}</h1>
    ${paragraphs}
  </body>
</html>`;
}

function contentOpf(book) {
  const manifestItems = book.chapters
    .map((_, i) => `    <item id="chapter-${i}" href="chapter-${i}.xhtml" media-type="application/xhtml+xml" />`)
    .join("\n");
  const spineItems = book.chapters.map((_, i) => `    <itemref idref="chapter-${i}" />`).join("\n");
  const modified = new Date(book.updatedAt).toISOString().replace(/\.\d+Z$/, "Z");

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${book.id}</dc:identifier>
    <dc:title>${escapeXml(book.title)}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
    <item id="css" href="styles.css" media-type="text/css" />
${manifestItems}
  </manifest>
  <spine toc="ncx">
${spineItems}
  </spine>
</package>`;
}

function navXhtml(book) {
  const items = book.chapters
    .map((c, i) => `      <li><a href="chapter-${i}.xhtml">${escapeXml(c.title)}</a></li>`)
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Contents</title></head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Contents</h1>
      <ol>
${items}
      </ol>
    </nav>
  </body>
</html>`;
}

function tocNcx(book) {
  const navPoints = book.chapters
    .map(
      (c, i) => `    <navPoint id="chapter-${i}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(c.title)}</text></navLabel>
      <content src="chapter-${i}.xhtml" />
    </navPoint>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${book.id}" />
  </head>
  <docTitle><text>${escapeXml(book.title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`;
}

const STYLES_CSS = `body { font-family: serif; line-height: 1.5; margin: 1.5em; }
h1 { font-size: 1.4em; }
p { margin: 0 0 1em; text-indent: 1.2em; }`;

/**
 * @param {{ id: string, title: string, updatedAt: Date|string|number, chapters: { title: string, pages: string[][] }[] }} book
 * @returns {Promise<Buffer>}
 */
export async function buildEpub(book) {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  const meta = zip.folder("META-INF");
  meta.file(
    "container.xml",
    `<?xml version="1.0" encoding="utf-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`
  );

  const oebps = zip.folder("OEBPS");
  oebps.file("content.opf", contentOpf(book));
  oebps.file("nav.xhtml", navXhtml(book));
  oebps.file("toc.ncx", tocNcx(book));
  oebps.file("styles.css", STYLES_CSS);
  book.chapters.forEach((chapter, i) => {
    oebps.file(`chapter-${i}.xhtml`, chapterXhtml(chapter, i));
  });

  return zip.generateAsync({ type: "nodebuffer" });
}
