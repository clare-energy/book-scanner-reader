import express from "express";
import cors from "cors";
import multer from "multer";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transcribePage } from "./ocr.js";
import { pool, initSchema } from "./db.js";
import { authRouter, requireAuth } from "./auth.js";
import { booksRouter } from "./books.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.join(__dirname, "../../frontend/dist");
const isProduction = process.env.NODE_ENV === "production";

const app = express();
app.set("trust proxy", 1); // Render terminates TLS at its proxy; needed for secure cookies.
app.use(cors());
app.use(express.json());

const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || "dev-only-insecure-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/auth", authRouter);
app.use("/books", requireAuth, booksRouter);

app.post("/ocr", requireAuth, upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image uploaded" });
  }
  if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    return res.status(500).json({ error: "Server is not configured with an OCR API key" });
  }

  try {
    const result = await transcribePage(req.file.buffer);
    res.json(result);
  } catch (err) {
    console.error("OCR failed:", err.code, err.message, err);
    if (err.code === 8) {
      // gRPC RESOURCE_EXHAUSTED
      return res.status(429).json({ error: "OCR service is busy, wait a few seconds and retry." });
    }
    res.status(502).json({ error: "OCR request failed, please retry" });
  }
});

// Serve the built PWA and support client-side routing.
app.use(express.static(FRONTEND_DIST));
app.get(/^(?!\/(ocr|health|auth|books)).*/, (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, "index.html"), (err) => {
    if (err) {
      res.status(503).send("Frontend build not found. Run the frontend build before starting the server.");
    }
  });
});

// Without this, a multer error (e.g. LIMIT_FILE_SIZE) bypasses every JSON
// error response above and falls through to Express's default HTML error
// page — which the frontend can't parse, so it shows a generic message
// with no clue what actually happened.
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "Photo is too large. Try again, or lower your camera resolution." });
  }
  res.status(500).json({ error: "Unexpected server error, please retry." });
});

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Book reader backend listening on :${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database schema:", err);
    process.exit(1);
  });
