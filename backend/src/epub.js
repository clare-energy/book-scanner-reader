// Ported from frontend/src/lib/epub.js — same EPUB3 structure, but built
// server-side now that the backend owns book data. Only difference from the
// frontend version is the JSZip output type (nodebuffer vs. blob).
import JSZip from "jszip";
import { buildPlsLexicon } from "./pls.js";

// Unicode combining diacritical marks (U+0300-U+036F), built from code
// points rather than a literal character class to avoid editor/encoding
// mishaps with combining characters in source.
const DIACRITIC_MARKS = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, "g");

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

function stripDiacritics(str) {
  return str.normalize("NFD").replace(DIACRITIC_MARKS, "");
}

/**
 * Same single-pass matcher as frontend/src/lib/speech.js's
 * buildPronunciationMatcher, duplicated rather than shared for the same
 * reason as TITLE_EXPANSIONS above (different runtime, small enough not to
 * be worth sharing). Builds one regex from the user's custom pronunciation
 * dictionary, matched diacritic- and case-insensitively.
 */
function buildCustomMatcher(entries) {
  if (!entries?.length) return null;
  const sorted = [...entries].sort((a, b) => b.term.length - a.term.length);
  const lookup = new Map();
  const patterns = [];
  for (const { term, pronunciation } of sorted) {
    const key = stripDiacritics(term).toLowerCase();
    if (!key || lookup.has(key)) continue;
    lookup.set(key, pronunciation);
    patterns.push(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
  if (!patterns.length) return null;
  return { regex: new RegExp(`\\b(?:${patterns.join("|")})\\b`, "g"), lookup };
}

/**
 * Wraps custom-dictionary matches in <abbr title="..."> using the same
 * diacritic-insensitive index-mapped matching as applyPronunciations in
 * speech.js, but wrapping the original (already-escaped) text instead of
 * replacing it — the visible text stays exactly as scanned, only the title
 * attribute carries the pronunciation hint.
 */
function annotateCustomPronunciations(escapedText, matcher) {
  if (!matcher) return escapedText;
  const normalized = stripDiacritics(escapedText).toLowerCase();
  if (normalized.length !== escapedText.length) return escapedText;
  let result = "";
  let lastIndex = 0;
  for (const match of normalized.matchAll(matcher.regex)) {
    const start = match.index;
    const end = start + match[0].length;
    const original = escapedText.slice(start, end);
    const pronunciation = escapeXml(matcher.lookup.get(match[0]));
    result += escapedText.slice(lastIndex, start) + `<abbr title="${pronunciation}">${original}</abbr>`;
    lastIndex = end;
  }
  return result + escapedText.slice(lastIndex);
}

/**
 * Wraps recognized title abbreviations, and any custom pronunciation-
 * dictionary terms, in <abbr title="..."> so the original printed text
 * ("Mr.", "Dún Laoghaire") stays exactly as scanned, while readers/TTS
 * engines that honor the title attribute get a pronunciation hint
 * ("Mister", "Doon Leary"). Support for this varies a lot across EPUB
 * readers — many just speak the visible text and ignore it — so this is a
 * best-effort addition, not a guaranteed fix for every app the export gets
 * opened in.
 */
function annotateAbbreviations(paragraph, customMatcher) {
  const withCustom = annotateCustomPronunciations(escapeXml(paragraph), customMatcher);
  return withCustom.replace(/\b(\p{L}+)\.(?=\s|$)/gu, (match, word) => {
    const expansion = TITLE_EXPANSIONS[word.toLowerCase()];
    return expansion ? `<abbr title="${expansion}">${match}</abbr>` : match;
  });
}

// Assigns each scanned page a book-wide sequential number (1, 2, 3, ... across
// all chapters) rather than resetting per chapter like the in-app Reader's
// display does — an EPUB page-list is meant to stand in for print/source page
// numbers, so it needs to be monotonic across the whole book, not per-chapter.
// Pages with no paragraphs (nothing to anchor an id to) are skipped: they
// don't get a page-list entry, but the page number still isn't wasted, since
// there was nothing scanned there to number in the first place.
function buildPageList(book) {
  const entries = [];
  let nextPageNumber = 1;
  book.chapters.forEach((chapter, chapterIndex) => {
    chapter.pages.forEach((page) => {
      if (!page.length) return;
      entries.push({
        pageNumber: nextPageNumber++,
        chapterIndex,
        id: `page-${nextPageNumber - 1}`,
      });
    });
  });
  return entries;
}

function chapterXhtml(chapter, chapterIndex, pageList, customMatcher) {
  const pageIdsInOrder = pageList
    .filter((e) => e.chapterIndex === chapterIndex)
    .map((e) => e.id);
  let pageCursor = 0;
  const paragraphs = chapter.pages
    .flatMap((page) => {
      const idForThisPage = page.length ? pageIdsInOrder[pageCursor++] : null;
      return page.map((p, i) => {
        const id = i === 0 && idForThisPage ? ` id="${idForThisPage}"` : "";
        return `<p${id}>${annotateAbbreviations(p, customMatcher)}</p>`;
      });
    })
    .join("\n    ");
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
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

function contentOpf(book, { includePlsLexicon }) {
  const manifestItems = book.chapters
    .map((_, i) => `    <item id="chapter-${i}" href="chapter-${i}.xhtml" media-type="application/xhtml+xml" />`)
    .join("\n");
  const spineItems = book.chapters.map((_, i) => `    <itemref idref="chapter-${i}" />`).join("\n");
  const modified = new Date(book.updatedAt).toISOString().replace(/\.\d+Z$/, "Z");
  // properties="pronunciation-lexicon" associates the lexicon with the whole
  // publication per the EPUB3 spec, rather than needing a <link> in each
  // content document. Support for this is rare among reading systems — same
  // best-effort framing as the <abbr> hints and page-list nav above.
  const plsItem = includePlsLexicon
    ? `    <item id="pronunciation-lexicon" href="pronunciation.pls" media-type="application/pls+xml" properties="pronunciation-lexicon" />\n`
    : "";

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
${plsItem}${manifestItems}
  </manifest>
  <spine toc="ncx">
${spineItems}
  </spine>
</package>`;
}

function navXhtml(book, pageList) {
  const items = book.chapters
    .map((c, i) => `      <li><a href="chapter-${i}.xhtml">${escapeXml(c.title)}</a></li>`)
    .join("\n");
  const pageListSection = pageList.length
    ? `
    <nav epub:type="page-list" id="page-list" hidden="hidden">
      <h1>Pages</h1>
      <ol>
${pageList
  .map(
    (e) =>
      `        <li><a href="chapter-${e.chapterIndex}.xhtml#${e.id}">${e.pageNumber}</a></li>`
  )
  .join("\n")}
      </ol>
    </nav>`
    : "";
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Contents</title></head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Contents</h1>
      <ol>
${items}
      </ol>
    </nav>${pageListSection}
  </body>
</html>`;
}

function tocNcx(book, pageList) {
  const navPoints = book.chapters
    .map(
      (c, i) => `    <navPoint id="chapter-${i}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(c.title)}</text></navLabel>
      <content src="chapter-${i}.xhtml" />
    </navPoint>`
    )
    .join("\n");
  const pageListXml = pageList.length
    ? `
  <pageList>
    <navLabel><text>Pages</text></navLabel>
${pageList
  .map(
    (e, i) => `    <pageTarget id="${e.id}" type="normal" value="${e.pageNumber}" playOrder="${i + 1}">
      <navLabel><text>${e.pageNumber}</text></navLabel>
      <content src="chapter-${e.chapterIndex}.xhtml#${e.id}" />
    </pageTarget>`
  )
  .join("\n")}
  </pageList>`
    : "";
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${book.id}" />
  </head>
  <docTitle><text>${escapeXml(book.title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>${pageListXml}
</ncx>`;
}

const STYLES_CSS = `body { font-family: serif; line-height: 1.5; margin: 1.5em; }
h1 { font-size: 1.4em; }
p { margin: 0 0 1em; text-indent: 1.2em; }`;

/**
 * @param {{ id: string, title: string, updatedAt: Date|string|number, chapters: { title: string, pages: string[][] }[] }} book
 * @param {{ term: string, pronunciation: string }[]} pronunciationEntries
 * @returns {Promise<Buffer>}
 */
export async function buildEpub(book, pronunciationEntries = []) {
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

  const pageList = buildPageList(book);
  const customMatcher = buildCustomMatcher(pronunciationEntries);
  const includePlsLexicon = pronunciationEntries.length > 0;

  const oebps = zip.folder("OEBPS");
  oebps.file("content.opf", contentOpf(book, { includePlsLexicon }));
  oebps.file("nav.xhtml", navXhtml(book, pageList));
  oebps.file("toc.ncx", tocNcx(book, pageList));
  oebps.file("styles.css", STYLES_CSS);
  if (includePlsLexicon) {
    oebps.file("pronunciation.pls", buildPlsLexicon(pronunciationEntries));
  }
  book.chapters.forEach((chapter, i) => {
    oebps.file(`chapter-${i}.xhtml`, chapterXhtml(chapter, i, pageList, customMatcher));
  });

  return zip.generateAsync({ type: "nodebuffer" });
}
