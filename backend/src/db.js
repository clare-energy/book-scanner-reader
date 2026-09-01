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
      chapters jsonb NOT NULL DEFAULT '[{"title":"Chapter 1","pages":[]}]',
      current_chapter_index int NOT NULL DEFAULT 0,
      page_count int NOT NULL DEFAULT 0,
      last_read jsonb,
      bookmark jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS books_user_id_idx ON books(user_id);

    ALTER TABLE books ADD COLUMN IF NOT EXISTS bookmark jsonb;

    CREATE TABLE IF NOT EXISTS pronunciation_entries (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      term text NOT NULL,
      pronunciation text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, term)
    );

    CREATE INDEX IF NOT EXISTS pronunciation_entries_user_id_idx ON pronunciation_entries(user_id);
  `);
  // CREATE TABLE IF NOT EXISTS only applies to a brand-new table — it does
  // NOT alter an already-existing table's column default, so changing the
  // DEFAULT above silently does nothing once the table exists (new rows
  // kept getting the old default until this ran). Explicit ALTER instead.
  await pool.query(
    `ALTER TABLE books ALTER COLUMN chapters SET DEFAULT '[{"title":"Chapter 1","pages":[]}]'`
  );
  await migrateLegacyChapters();
}

// Chapters used to store one flat `paragraphs` array per chapter, with no
// record of which paragraphs came from which scan. Now each chapter stores
// `pages` (an array of paragraph-arrays, one per scan). Original page
// boundaries for content scanned before this change can't be recovered, so
// existing paragraphs collapse into a single synthetic "page 1" per
// chapter. Idempotent: once no legacy-shaped chapters remain, this is a
// no-op, so it's safe to run on every startup rather than as a manual step.
async function migrateLegacyChapters() {
  const { rows } = await pool.query(`SELECT id, chapters FROM books`);
  for (const row of rows) {
    let changed = false;
    const chapters = row.chapters.map((chapter) => {
      if (chapter.pages) return chapter;
      changed = true;
      const { paragraphs, ...rest } = chapter;
      return { ...rest, pages: paragraphs?.length ? [paragraphs] : [] };
    });
    if (changed) {
      await pool.query(`UPDATE books SET chapters = $2 WHERE id = $1`, [
        row.id,
        JSON.stringify(chapters),
      ]);
    }
  }
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
    bookmark: row.bookmark,
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

function splitIntoParagraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export async function appendPage(userId, bookId, text) {
  const book = await getRawBookForUser(userId, bookId);
  if (!book) return null;

  const chapters = book.chapters;
  chapters[book.current_chapter_index].pages.push(splitIntoParagraphs(text));

  const { rows } = await pool.query(
    `UPDATE books SET chapters = $3, page_count = page_count + 1, updated_at = now()
     WHERE user_id = $1 AND id = $2 RETURNING *`,
    [userId, bookId, JSON.stringify(chapters)]
  );
  return toBookDetail(rows[0]);
}

// Replaces one scanned page's text wholesale (e.g. fixing OCR errors) rather
// than appending a new one — same paragraph-splitting rule as a fresh scan,
// so hand-edited text behaves identically to OCR output everywhere else
// (TTS phrasing, EPUB export, etc).
export async function updatePageText(userId, bookId, chapterIndex, pageIndex, text) {
  const book = await getRawBookForUser(userId, bookId);
  if (!book) return null;

  const chapter = book.chapters[chapterIndex];
  if (!chapter || !chapter.pages[pageIndex]) return null;

  const chapters = book.chapters;
  chapters[chapterIndex].pages[pageIndex] = splitIntoParagraphs(text);

  const { rows } = await pool.query(
    `UPDATE books SET chapters = $3, updated_at = now() WHERE user_id = $1 AND id = $2 RETURNING *`,
    [userId, bookId, JSON.stringify(chapters)]
  );
  return toBookDetail(rows[0]);
}

export async function startNewChapter(userId, bookId) {
  const book = await getRawBookForUser(userId, bookId);
  if (!book) return null;

  const chapters = book.chapters;
  const current = chapters[book.current_chapter_index];
  if (current.pages.length === 0) {
    return toBookDetail(book);
  }

  chapters.push({ title: `Chapter ${chapters.length + 1}`, pages: [] });
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

// Only one bookmark per book/user — setting a new one overwrites the old.
export async function setBookmark(userId, bookId, chapterIndex, phraseIndex) {
  const { rowCount } = await pool.query(
    `UPDATE books SET bookmark = $3, updated_at = now() WHERE user_id = $1 AND id = $2`,
    [userId, bookId, JSON.stringify({ chapterIndex, phraseIndex })]
  );
  return rowCount > 0;
}

export async function getBookTitleAndChapters(userId, bookId) {
  const book = await getRawBookForUser(userId, bookId);
  if (!book) return null;
  return { id: book.id, title: book.title, chapters: book.chapters, updatedAt: book.updated_at };
}

// --- pronunciation dictionary ---

function toPronunciationEntry(row) {
  return { id: row.id, term: row.term, pronunciation: row.pronunciation };
}

export async function listPronunciationsForUser(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM pronunciation_entries WHERE user_id = $1 ORDER BY term`,
    [userId]
  );
  return rows.map(toPronunciationEntry);
}

// Adding a term that already exists (case-sensitive, exact match) updates its
// pronunciation instead of erroring — lets both the settings-panel "add" form
// and a re-import of the same lexicon behave like an upsert.
export async function upsertPronunciation(userId, term, pronunciation) {
  const { rows } = await pool.query(
    `INSERT INTO pronunciation_entries (id, user_id, term, pronunciation)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, term) DO UPDATE SET pronunciation = excluded.pronunciation
     RETURNING *`,
    [newId(), userId, term, pronunciation]
  );
  return toPronunciationEntry(rows[0]);
}

export async function deletePronunciation(userId, id) {
  const { rowCount } = await pool.query(
    `DELETE FROM pronunciation_entries WHERE user_id = $1 AND id = $2`,
    [userId, id]
  );
  return rowCount > 0;
}

// Bulk upsert for PLS import — same one-row-at-a-time upsert as
// upsertPronunciation, just looped in a single round trip's worth of
// sequential queries (import lists are small, a handful to low hundreds of
// entries, so a transaction here is about correctness, not performance).
export async function importPronunciations(userId, entries) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let imported = 0;
    for (const { term, pronunciation } of entries) {
      await client.query(
        `INSERT INTO pronunciation_entries (id, user_id, term, pronunciation)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, term) DO UPDATE SET pronunciation = excluded.pronunciation`,
        [newId(), userId, term, pronunciation]
      );
      imported++;
    }
    await client.query("COMMIT");
    return imported;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
