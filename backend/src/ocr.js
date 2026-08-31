import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `You transcribe a single photographed page from a physical book for a low-vision \
user who will have the text read aloud by text-to-speech software. Accuracy matters more than speed.

Rules:
- Transcribe all body text exactly as printed, preserving paragraph breaks as blank lines.
- Rejoin words that are hyphenated across a line break into a single word (remove the hyphen).
- Do NOT include running headers, running footers, or standalone page numbers.
- Do NOT add any commentary, titles, or text that is not on the page.
- If the image is blank, blurry, upside down, or otherwise has no legible body text, return an \
empty string for "text" and set "lowConfidence" to true.
- Set "lowConfidence" to true if any word or passage is illegible, ambiguous, or you are not \
confident you transcribed it correctly. List a short excerpt of each such passage in \
"uncertainPassages".`;

const TRANSCRIBE_TOOL = {
  name: "submit_transcription",
  description: "Submit the transcription of the photographed book page.",
  input_schema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The transcribed body text of the page.",
      },
      lowConfidence: {
        type: "boolean",
        description: "true if any part of the page was illegible or you are unsure of the transcription",
      },
      uncertainPassages: {
        type: "array",
        items: { type: "string" },
        description: "Short excerpts of passages you were unsure about (only when lowConfidence is true)",
      },
    },
    required: ["text", "lowConfidence"],
  },
};

/**
 * @param {Buffer} imageBuffer
 * @param {string} mimeType
 * @returns {Promise<{ text: string, lowConfidence: boolean, uncertainPassages: string[] }>}
 */
export async function transcribePage(imageBuffer, mimeType) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [TRANSCRIBE_TOOL],
    tool_choice: { type: "tool", name: "submit_transcription" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType,
              data: imageBuffer.toString("base64"),
            },
          },
          {
            type: "text",
            text: "Transcribe this book page.",
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse) {
    throw new Error("Model did not return a transcription");
  }

  const { text = "", lowConfidence = false, uncertainPassages = [] } = toolUse.input;
  return { text, lowConfidence, uncertainPassages };
}
