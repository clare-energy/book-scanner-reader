import express from "express";
import {
  listBooksForUser,
  getBookForUser,
  createBookForUser,
  renameBook,
  deleteBook,
  appendPage,
  updatePageText,
  startNewChapter,
  setLastRead,
  setBookmark,
  getBookTitleAndChapters,
  listPronunciationsForUser,
} from "./db.js";
import { buildEpub } from "./epub.js";

export const booksRouter = express.Router();

booksRouter.get("/", async (req, res) => {
  res.json(await listBooksForUser(req.session.userId));
});

booksRouter.post("/", async (req, res) => {
  const book = await createBookForUser(req.session.userId, req.body?.title);
  res.status(201).json(book);
});

booksRouter.get("/:id", async (req, res) => {
  const book = await getBookForUser(req.session.userId, req.params.id);
  if (!book) return res.status(404).json({ error: "Book not found" });
  res.json(book);
});

booksRouter.patch("/:id", async (req, res) => {
  const book = await renameBook(req.session.userId, req.params.id, req.body?.title);
  if (!book) return res.status(404).json({ error: "Book not found" });
  res.json(book);
});

booksRouter.delete("/:id", async (req, res) => {
  const deleted = await deleteBook(req.session.userId, req.params.id);
  if (!deleted) return res.status(404).json({ error: "Book not found" });
  res.status(204).end();
});

booksRouter.post("/:id/pages", async (req, res) => {
  const text = req.body?.text;
  if (typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "No text provided" });
  }
  const book = await appendPage(req.session.userId, req.params.id, text);
  if (!book) return res.status(404).json({ error: "Book not found" });
  res.json(book);
});

booksRouter.put("/:id/chapters/:chapterIndex/pages/:pageIndex", async (req, res) => {
  const chapterIndex = Number(req.params.chapterIndex);
  const pageIndex = Number(req.params.pageIndex);
  const text = req.body?.text;
  if (!Number.isInteger(chapterIndex) || !Number.isInteger(pageIndex)) {
    return res.status(400).json({ error: "chapterIndex and pageIndex must be integers" });
  }
  if (typeof text !== "string") {
    return res.status(400).json({ error: "No text provided" });
  }
  const book = await updatePageText(req.session.userId, req.params.id, chapterIndex, pageIndex, text);
  if (!book) return res.status(404).json({ error: "Book or page not found" });
  res.json(book);
});

booksRouter.post("/:id/chapters", async (req, res) => {
  const book = await startNewChapter(req.session.userId, req.params.id);
  if (!book) return res.status(404).json({ error: "Book not found" });
  res.json(book);
});

booksRouter.put("/:id/position", async (req, res) => {
  const { chapterIndex, phraseIndex } = req.body ?? {};
  if (!Number.isInteger(chapterIndex) || !Number.isInteger(phraseIndex)) {
    return res.status(400).json({ error: "chapterIndex and phraseIndex must be integers" });
  }
  const ok = await setLastRead(req.session.userId, req.params.id, chapterIndex, phraseIndex);
  if (!ok) return res.status(404).json({ error: "Book not found" });
  res.status(204).end();
});

booksRouter.put("/:id/bookmark", async (req, res) => {
  const { chapterIndex, phraseIndex } = req.body ?? {};
  if (!Number.isInteger(chapterIndex) || !Number.isInteger(phraseIndex)) {
    return res.status(400).json({ error: "chapterIndex and phraseIndex must be integers" });
  }
  const ok = await setBookmark(req.session.userId, req.params.id, chapterIndex, phraseIndex);
  if (!ok) return res.status(404).json({ error: "Book not found" });
  res.status(204).end();
});

booksRouter.get("/:id/epub", async (req, res) => {
  const book = await getBookTitleAndChapters(req.session.userId, req.params.id);
  if (!book) return res.status(404).json({ error: "Book not found" });

  const pronunciationEntries = await listPronunciationsForUser(req.session.userId);
  const buffer = await buildEpub(book, pronunciationEntries);
  res.set({
    "Content-Type": "application/epub+zip",
    "Content-Disposition": `attachment; filename="${book.title.replace(/[^\w\- ]/g, "")}.epub"`,
  });
  res.send(buffer);
});
