import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transcribePage } from "./ocr.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.join(__dirname, "../../frontend/dist");

const app = express();
app.use(cors());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/ocr", upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image uploaded" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Server is not configured with an OCR API key" });
  }

  try {
    const result = await transcribePage(req.file.buffer, req.file.mimetype);
    res.json(result);
  } catch (err) {
    console.error("OCR failed:", err);
    res.status(502).json({ error: "OCR request failed, please retry" });
  }
});

// Serve the built PWA and support client-side routing.
app.use(express.static(FRONTEND_DIST));
app.get(/^(?!\/(ocr|health)).*/, (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, "index.html"), (err) => {
    if (err) {
      res.status(503).send("Frontend build not found. Run the frontend build before starting the server.");
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Book reader backend listening on :${PORT}`);
});
