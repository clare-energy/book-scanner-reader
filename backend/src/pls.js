// Reads and writes W3C Pronunciation Lexicon Specification (PLS) documents,
// used both for the standalone dictionary export/import and for the .pls
// file embedded in exported EPUBs. Only the <alias> (plain respelling) form
// is used — this app has no IPA/phoneme input anywhere, so a lexeme's
// <phoneme> can't be turned into anything we can act on.
import { XMLParser } from "fast-xml-parser";

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildPlsLexicon(entries, { lang = "en-US" } = {}) {
  const lexemes = entries
    .map(
      (e) => `  <lexeme>
    <grapheme>${escapeXml(e.term)}</grapheme>
    <alias>${escapeXml(e.pronunciation)}</alias>
  </lexeme>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<lexicon version="1.0" xmlns="http://www.w3.org/2005/01/pronunciation-lexicon" alphabet="ipa" xml:lang="${lang}">
${lexemes}
</lexicon>`;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === "lexeme",
});

/**
 * @returns {{ entries: {term: string, pronunciation: string}[], skippedPhonemeOnly: number }}
 */
export function parsePlsLexicon(xmlText) {
  const doc = parser.parse(xmlText);
  // fast-xml-parser doesn't throw on non-XML/malformed input by default — it
  // just returns whatever it could make of it — so a missing <lexicon> root
  // is the actual signal that this wasn't a PLS document at all.
  if (!doc?.lexicon) {
    throw new Error("Not a PLS lexicon document");
  }
  const lexemes = doc.lexicon.lexeme ?? [];
  const entries = [];
  let skippedPhonemeOnly = 0;
  for (const lex of lexemes) {
    const grapheme = typeof lex?.grapheme === "string" ? lex.grapheme.trim() : "";
    const alias = typeof lex?.alias === "string" ? lex.alias.trim() : "";
    if (!grapheme) continue;
    if (!alias) {
      skippedPhonemeOnly++;
      continue;
    }
    entries.push({ term: grapheme, pronunciation: alias });
  }
  return { entries, skippedPhonemeOnly };
}
