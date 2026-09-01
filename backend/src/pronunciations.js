import express from "express";
import multer from "multer";
import {
  listPronunciationsForUser,
  upsertPronunciation,
  deletePronunciation,
  importPronunciations,
} from "./db.js";
import { buildPlsLexicon, parsePlsLexicon } from "./pls.js";

export const pronunciationsRouter = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

pronunciationsRouter.get("/", async (req, res) => {
  res.json(await listPronunciationsForUser(req.session.userId));
});

pronunciationsRouter.post("/", async (req, res) => {
  const term = req.body?.term?.trim();
  const pronunciation = req.body?.pronunciation?.trim();
  if (!term || !pronunciation) {
    return res.status(400).json({ error: "term and pronunciation are both required" });
  }
  const entry = await upsertPronunciation(req.session.userId, term, pronunciation);
  res.status(201).json(entry);
});

pronunciationsRouter.delete("/:id", async (req, res) => {
  const deleted = await deletePronunciation(req.session.userId, req.params.id);
  if (!deleted) return res.status(404).json({ error: "Entry not found" });
  res.status(204).end();
});

pronunciationsRouter.get("/export.pls", async (req, res) => {
  const entries = await listPronunciationsForUser(req.session.userId);
  const xml = buildPlsLexicon(entries);
  res.set({
    "Content-Type": "application/pls+xml",
    "Content-Disposition": 'attachment; filename="pronunciation-dictionary.pls"',
  });
  res.send(xml);
});

pronunciationsRouter.post("/import-pls", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  let parsed;
  try {
    parsed = parsePlsLexicon(req.file.buffer.toString("utf-8"));
  } catch {
    return res.status(400).json({ error: "That file isn't a valid PLS lexicon" });
  }

  const imported = await importPronunciations(req.session.userId, parsed.entries);
  res.json({ imported, skippedPhonemeOnly: parsed.skippedPhonemeOnly });
});
