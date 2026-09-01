import { ImageAnnotatorClient } from "@google-cloud/vision";

let client;
function getClient() {
  if (!client) {
    client = new ImageAnnotatorClient({
      projectId: process.env.GOOGLE_PROJECT_ID,
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      },
    });
  }
  return client;
}

const HEADER_FOOTER_MARGIN = 0.08; // top/bottom 8% of the page
const HEADER_FOOTER_MAX_CHARS = 60;
const PAGE_NUMBER_RE = /^\d{1,4}$/;
const LOW_CONFIDENCE_THRESHOLD = 0.88;
const UNCERTAIN_WORD_THRESHOLD = 0.6;

function blockText(block) {
  // Rejoins words split by a line-end hyphen and turns other line breaks
  // within a paragraph into spaces, so each paragraph reads as continuous
  // prose (matching how the app splits pages into paragraphs on blank
  // lines).
  let text = "";
  for (const paragraph of block.paragraphs ?? []) {
    let paragraphText = "";
    for (const word of paragraph.words ?? []) {
      for (const symbol of word.symbols ?? []) {
        const breakType = symbol.property?.detectedBreak?.type;
        if (symbol.text === "-" && breakType === "HYPHEN") {
          continue; // drop the hyphen; word continues with the next symbol
        }
        paragraphText += symbol.text;
        if (breakType === "SPACE" || breakType === "SURE_SPACE") {
          paragraphText += " ";
        } else if (breakType === "EOL_SURE_SPACE" || breakType === "LINE_BREAK") {
          paragraphText += " ";
        }
      }
    }
    paragraphText = paragraphText.trim();
    if (paragraphText) text += (text ? "\n\n" : "") + paragraphText;
  }
  return text;
}

function blockYRatio(block, pageHeight) {
  const ys = (block.boundingBox?.vertices ?? []).map((v) => v.y ?? 0);
  if (!ys.length || !pageHeight) return 0.5;
  const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
  return avgY / pageHeight;
}

function looksLikeHeaderOrFooter(text, yRatio) {
  if (PAGE_NUMBER_RE.test(text)) return true;
  const nearEdge = yRatio < HEADER_FOOTER_MARGIN || yRatio > 1 - HEADER_FOOTER_MARGIN;
  return nearEdge && text.length <= HEADER_FOOTER_MAX_CHARS;
}

function wordConfidences(page) {
  const confidences = [];
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const word of paragraph.words ?? []) {
        if (typeof word.confidence === "number") confidences.push(word.confidence);
      }
    }
  }
  return confidences;
}

/**
 * @param {Buffer} imageBuffer
 * @returns {Promise<{ text: string, lowConfidence: boolean, uncertainPassages: string[] }>}
 */
export async function transcribePage(imageBuffer) {
  const [result] = await getClient().documentTextDetection({
    image: { content: imageBuffer },
  });

  const page = result.fullTextAnnotation?.pages?.[0];
  if (!page) {
    return { text: "", lowConfidence: true, uncertainPassages: [] };
  }

  const kept = [];
  for (const block of page.blocks ?? []) {
    const text = blockText(block);
    if (!text) continue;
    if (looksLikeHeaderOrFooter(text, blockYRatio(block, page.height))) continue;
    kept.push(text);
  }

  const confidences = wordConfidences(page);
  const avgConfidence = confidences.length
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0;

  const uncertainPassages = [];
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const word of paragraph.words ?? []) {
        if (word.confidence < UNCERTAIN_WORD_THRESHOLD) {
          uncertainPassages.push((word.symbols ?? []).map((s) => s.text).join(""));
        }
      }
    }
  }

  return {
    text: kept.join("\n\n"),
    lowConfidence: confidences.length === 0 || avgConfidence < LOW_CONFIDENCE_THRESHOLD,
    uncertainPassages: uncertainPassages.slice(0, 10),
  };
}
