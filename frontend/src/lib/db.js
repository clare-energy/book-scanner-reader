import { openDB } from 'idb'
import { buildEpub } from './epub.js'

const DB_NAME = 'book-reader'
const DB_VERSION = 1

/**
 * @typedef {{ title: string, paragraphs: string[] }} Chapter
 * @typedef {{
 *   id: string,
 *   title: string,
 *   createdAt: number,
 *   updatedAt: number,
 *   chapters: Chapter[],
 *   currentChapterIndex: number,
 *   pageCount: number,
 *   lastRead: { chapterIndex: number, phraseIndex: number } | null,
 * }} Book
 */

function dbPromise() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('books', { keyPath: 'id' })
      db.createObjectStore('epubs', { keyPath: 'bookId' })
    },
  })
}

const dbp = dbPromise()

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function defaultTitle() {
  return `Untitled — ${new Date().toLocaleDateString()}`
}

async function saveBook(book) {
  const db = await dbp
  await db.put('books', book)
  const blob = await buildEpub(book)
  await db.put('epubs', { bookId: book.id, blob, updatedAt: book.updatedAt })
  return book
}

export async function listBooks() {
  const db = await dbp
  const books = await db.getAll('books')
  return books.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getBook(id) {
  const db = await dbp
  return db.get('books', id)
}

export async function createBook(title) {
  const now = Date.now()
  /** @type {Book} */
  const book = {
    id: newId(),
    title: title?.trim() || defaultTitle(),
    createdAt: now,
    updatedAt: now,
    chapters: [{ title: 'Chapter 1', paragraphs: [] }],
    currentChapterIndex: 0,
    pageCount: 0,
    lastRead: null,
  }
  await saveBook(book)
  return book
}

export async function renameBook(id, title) {
  const book = await getBook(id)
  if (!book) throw new Error('Book not found')
  book.title = title.trim() || book.title
  book.updatedAt = Date.now()
  await saveBook(book)
  return book
}

export async function deleteBook(id) {
  const db = await dbp
  await db.delete('books', id)
  await db.delete('epubs', id)
}

/**
 * Append OCR'd page text to the book's current chapter as one or more
 * paragraphs (split on blank lines), and rebuild the EPUB.
 */
export async function appendPageText(id, text) {
  const book = await getBook(id)
  if (!book) throw new Error('Book not found')

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const chapter = book.chapters[book.currentChapterIndex]
  chapter.paragraphs.push(...paragraphs)
  book.pageCount += 1
  book.updatedAt = Date.now()

  await saveBook(book)
  return book
}

/** Close the current chapter and start a new one. */
export async function startNewChapter(id) {
  const book = await getBook(id)
  if (!book) throw new Error('Book not found')

  const currentChapter = book.chapters[book.currentChapterIndex]
  if (currentChapter.paragraphs.length === 0) {
    // Nothing scanned into the current chapter yet — no-op.
    return book
  }

  book.chapters.push({ title: `Chapter ${book.chapters.length + 1}`, paragraphs: [] })
  book.currentChapterIndex = book.chapters.length - 1
  book.updatedAt = Date.now()

  await saveBook(book)
  return book
}

export async function setLastRead(id, chapterIndex, phraseIndex) {
  const db = await dbp
  const book = await getBook(id)
  if (!book) return
  book.lastRead = { chapterIndex, phraseIndex }
  book.updatedAt = Date.now()
  // Reading position updates don't change the EPUB content, so write the
  // book record directly rather than paying for a full EPUB rebuild.
  await db.put('books', book)
}

export async function getEpubBlob(id) {
  const db = await dbp
  const record = await db.get('epubs', id)
  return record?.blob ?? null
}
