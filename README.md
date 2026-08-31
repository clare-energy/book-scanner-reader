# Book Scanner Reader

See [SPEC.md](./SPEC.md) for the full product spec. This is a mobile-first PWA:
photograph physical book pages, OCR them via a small backend, accumulate an
EPUB per book, and read it aloud phrase-by-phrase. Multiple people can sign up
and each only sees their own books.

## Structure

- `backend/` — Express service. `/auth/*` (email+password, session cookies)
  and `/books/*` (CRUD, page/chapter append, EPUB export) are backed by
  Postgres — books belong to a user and only that user can read/write them.
  `/ocr` (image in, transcribed text out, via the Claude API's vision
  capability) is also session-gated. Also serves the built frontend in
  production, so the whole app is one Render service.
- `frontend/` — React + Vite PWA. No local storage of book data anymore —
  the backend is the source of truth; the app just calls the API.

## Local development

Requires Node 20+ and a Postgres instance. Easiest via Docker:
```
docker run -d --name book-reader-pg -p 5432:5432 -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=bookreader postgres:16
```

**Backend** (in one terminal):
```
cd backend
cp .env.example .env   # add ANTHROPIC_API_KEY, DATABASE_URL, SESSION_SECRET
npm install
npm run dev             # listens on :3000, creates its tables on startup
```

**Frontend** (in another terminal):
```
cd frontend
npm install
npm run dev              # listens on :5173, proxies /auth, /books, /ocr, /health to :3000
```

Open `http://localhost:5173`, sign up, and go. To test camera capture you'll
generally need a real phone (or a desktop browser with a webcam) — file
inputs with `capture="environment"` fall back to a normal file picker on
desktop.

## Production build

The backend serves the built frontend, so build the frontend first:
```
cd frontend && npm install && npm run build
cd ../backend && npm install
ANTHROPIC_API_KEY=... DATABASE_URL=... SESSION_SECRET=... NODE_ENV=production PORT=3000 npm start
```

## Deploying to Render

`render.yaml` defines a Blueprint: the web service plus a managed Postgres
database, wired together automatically. In the Render dashboard: **New +** →
**Blueprint** → select this repo → it'll prompt for `ANTHROPIC_API_KEY` (the
only secret not auto-generated) → deploy.

Note: Render's **free Postgres plan expires after 30 days** and gets deleted.
Fine for testing; move to a paid plan before relying on it for real.

## Notable implementation choices

- **Auth**: email + password, `bcryptjs` hashing, `express-session` with a
  Postgres-backed store (`connect-pg-simple`) so sessions survive restarts/
  redeploys. Every `/books*` query is scoped by `user_id`, and a book owned
  by someone else 404s rather than 403s, so IDs don't leak existence.
- **OCR**: the backend calls the Claude API (vision) to transcribe each page,
  rejoin hyphenation, and strip headers/footers/page numbers, via a forced
  tool call so the response is structured JSON (`text`, `lowConfidence`,
  `uncertainPassages`) rather than freeform text. Gated behind login since
  it's a direct proxy onto a paid API key.
- **EPUB**: built server-side on demand (`GET /books/:id/epub`) from the
  book's `chapters` JSONB column — valid EPUB3 (OPF manifest/spine,
  nav.xhtml, and an NCX for wider reader compatibility), generated fresh
  each time rather than stored, so it's always current.
- **Perspective correction**: uses `@techstark/opencv-js` + `jscanify`,
  lazy-loaded client-side only when a page is scanned (it's a ~15MB one-time
  download, excluded from the PWA's install-time precache and instead
  cached on first use). If it fails to load or finds no page contour,
  preprocessing falls back to grayscale + contrast stretch only — the scan
  flow never blocks on it.
- **Low-confidence pages**: rather than showing OCR text for visual proofing
  (impractical for a low-vision user), the app speaks the recognized text
  aloud immediately and offers Keep / Retry.

## Known gaps / things to verify on real hardware

This was built and smoke-tested (full backend API + the Vite dev proxy path,
including cookies) without a real device or browser automation available in
the dev environment, so the following are unverified:
- Camera capture end-to-end on Android Chrome (`<input capture="environment">`
  behavior, EXIF orientation handling).
- The OpenCV.js/jscanify perspective-correction wiring in an actual mobile
  browser (built and lint-clean, but not exercised against a real photo).
- `speechSynthesis` voice availability/behavior on Android Chrome, and the
  pause/resume fallback under real conditions.
- Actual OCR quality/latency from the Claude API on real book-page photos.
- The full Login/Library/Scan/Reader UI flow in an actual browser (verified
  via API calls and code review, not a rendered page).

Worth running through sign up → scan → OCR → keep/retry → read → export on a
real phone early, before adding anything further.
