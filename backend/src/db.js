import pg from "pg";
import crypto from "node:crypto";

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY,
      email text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS books (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title text NOT NULL,
      chapters jsonb NOT NULL DEFAULT '[{"title":"Chapter 1","paragraphs":[]}]',
      current_chapter_index int NOT NULL DEFAULT 0,
      page_count int NOT NULL DEFAULT 0,
      last_read jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS books_user_id_idx ON books(user_id);
  `);
}

function newId() {
  return crypto.randomUUID();
}

// --- users ---

export async function createUser(email, passwordHash) {
  const id = newId();
  const { rows } = await pool.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)
     RETURNING id, email`,
    [id, email, passwordHash]
  );
  return rows[0];
}

export async function findUserByEmail(email) {
  const { rows } = await pool.query(
    `SELECT id, email, password_hash FROM users WHERE email = $1`,
    [email]
  );
  return rows[0] ?? null;
}

export async function findUserById(id) {
  const { rows } = await pool.query(`SELECT id, email FROM users WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

// --- books ---

function toBookSummary(row) {
  return {
    id: row.id,
    title: row.title,
    pageCount: row.page_count,
    chapterCount: row.chapters.length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRead: row.last_read,
  };
}

function toBookDetail(row) {
  return {
    ...toBookSummary(row),
    chapters: row.chapters,
    currentChapterIndex: row.current_chapter_index,
  };
}

export async function listBooksForUser(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM books WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId]
  );
  return rows.map(toBookSummary);
}

export async function getBookForUser(userId, bookId) {
  const { rows } = await pool.query(`SELECT * FROM books WHERE user_id = $1 AND id = $2`, [
    userId,
    bookId,
  ]);
  return rows[0] ? toBookDetail(rows[0]) : null;
}

async function getRawBookForUser(userId, bookId) {
  const { rows } = await pool.query(`SELECT * FROM books WHERE user_id = $1 AND id = $2`, [
    userId,
    bookId,
  ]);
  return rows[0] ?? null;
}

export async function createBookForUser(userId, title) {
  const id = newId();
  const bookTitle = title?.trim() || `Untitled — ${new Date().toLocaleDateString()}`;
  const { rows } = await pool.query(
    `INSERT INTO books (id, user_id, title) VALUES ($1, $2, $3) RETURNING *`,
    [id, userId, bookTitle]
  );
  return toBookDetail(rows[0]);
}

export async function renameBook(userId, bookId, title) {
  const trimmed = title?.trim();
  if (!trimmed) return getBookForUser(userId, bookId);
  const { rows } = await pool.query(
    `UPDATE books SET title = $3, updated_at = now() WHERE user_id = $1 AND id = $2 RETURNING *`,
    [userId, bookId, trimmed]
  );
  return rows[0] ? toBookDetail(rows[0]) : null;
}

export async function deleteBook(userId, bookId) {
  const { rowCount } = await pool.query(`DELETE FROM books WHERE user_id = $1 AND id = $2`, [
    userId,
    bookId,
  ]);
  return rowCount > 0;
}

export async function appendPage(userId, bookId, text) {
  const book = await getRawBookForUser(userId, bookId);
  if (!book) return null;

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const chapters = book.chapters;
  chapters[book.current_chapter_index].paragraphs.push(...paragraphs);

  const { rows } = await pool.query(
    `UPDATE books SET chapters = $3, page_count = page_count + 1, updated_at = now()
     WHERE user_id = $1 AND id = $2 RETURNING *`,
    [userId, bookId, JSON.stringify(chapters)]
  );
  return toBookDetail(rows[0]);
}

export async function startNewChapter(userId, bookId) {
  const book = await getRawBookForUser(userId, bookId);
  if (!book) return null;

  const chapters = book.chapters;
  const current = chapters[book.current_chapter_index];
  if (current.paragraphs.length === 0) {
    return toBookDetail(book);
  }

  chapters.push({ title: `Chapter ${chapters.length + 1}`, paragraphs: [] });
  const newIndex = chapters.length - 1;

  const { rows } = await pool.query(
    `UPDATE books SET chapters = $3, current_chapter_index = $4, updated_at = now()
     WHERE user_id = $1 AND id = $2 RETURNING *`,
    [userId, bookId, JSON.stringify(chapters), newIndex]
  );
  return toBookDetail(rows[0]);
}

export async function setLastRead(userId, bookId, chapterIndex, phraseIndex) {
  const { rowCount } = await pool.query(
    `UPDATE books SET last_read = $3, updated_at = now() WHERE user_id = $1 AND id = $2`,
    [userId, bookId, JSON.stringify({ chapterIndex, phraseIndex })]
  );
  return rowCount > 0;
}

export async function getBookTitleAndChapters(userId, bookId) {
  const book = await getRawBookForUser(userId, bookId);
  if (!book) return null;
  return { id: book.id, title: book.title, chapters: book.chapters, updatedAt: book.updated_at };
}
