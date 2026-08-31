# Book Scanner Reader

See [SPEC.md](./SPEC.md) for the full product spec. This is a mobile-first PWA:
photograph physical book pages, OCR them via a small backend, accumulate an
EPUB per book, and read it aloud phrase-by-phrase.

## Structure

- `backend/` — Express service. One `/ocr` endpoint (image in, transcribed text
  out, via the Claude API's vision capability). Also serves the built frontend
  in production, so the whole app is one Render service.
- `frontend/` — React + Vite PWA. All book/EPUB data lives in the browser
  (IndexedDB) — the backend holds no state.

## Local development

Requires Node 20+.

**Backend** (in one terminal):
```
cd backend
cp .env.example .env   # then add your ANTHROPIC_API_KEY
npm install
npm run dev             # listens on :3000
```

**Frontend** (in another terminal):
```
cd frontend
npm install
npm run dev              # listens on :5173, proxies /ocr to :3000
```

Open `http://localhost:5173`. To test camera capture you'll generally need a
real phone (or a desktop browser with a webcam) — file inputs with
`capture="environment"` fall back to a normal file picker on desktop.

## Production build

The backend serves the built frontend, so build the frontend first:
```
cd frontend && npm install && npm run build
cd ../backend && npm install
ANTHROPIC_API_KEY=... PORT=3000 npm start
```

## Deploying to Render

Single Render Web Service:
- **Build command**: `npm install --prefix frontend && npm run build --prefix frontend && npm install --prefix backend`
- **Start command**: `npm start --prefix backend`
- **Environment variable**: `ANTHROPIC_API_KEY` (set in the Render dashboard, never committed)

## Notable implementation choices

- **OCR**: the backend calls the Claude API (vision) to transcribe each page,
  rejoin hyphenation, and strip headers/footers/page numbers, via a forced
  tool call so the response is structured JSON (`text`, `lowConfidence`,
  `uncertainPassages`) rather than freeform text.
- **EPUB**: built client-side with JSZip from scratch (valid EPUB3: OPF
  manifest/spine, nav.xhtml, and an NCX for wider reader compatibility). The
  EPUB blob in IndexedDB is regenerated after every page/chapter change, so
  it's always the current, exportable file — not something assembled only at
  export time.
- **Perspective correction**: uses `@techstark/opencv-js` + `jscanify`,
  lazy-loaded only when a page is scanned (it's a ~15MB one-time download,
  excluded from the PWA's install-time precache and instead cached on first
  use). If it fails to load or finds no page contour, preprocessing falls
  back to grayscale + contrast stretch only — the scan flow never blocks on
  it.
- **Low-confidence pages**: rather than showing OCR text for visual proofing
  (impractical for a low-vision user), the app speaks the recognized text
  aloud immediately and offers Keep / Retry.

## Known gaps / things to verify on real hardware

This was built and smoke-tested without a real device or browser automation
available in the dev environment, so the following are unverified:
- Camera capture end-to-end on Android Chrome (`<input capture="environment">`
  behavior, EXIF orientation handling).
- The OpenCV.js/jscanify perspective-correction wiring in an actual mobile
  browser (built and lint-clean, but not exercised against a real photo).
- `speechSynthesis` voice availability/behavior on Android Chrome, and the
  pause/resume fallback under real conditions.
- Actual OCR quality/latency from the Claude API on real book-page photos.

Worth running through the core scan → OCR → keep/retry → read loop on a real
phone early, before adding anything further.
