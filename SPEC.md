# Spec: Physical Book Reader PWA

## Overview
A mobile-first Progressive Web App (installed via "Add to Home Screen," no app store submission) that lets a low-vision user photograph physical book pages, converts them to text via cloud OCR, accumulates pages into a growing EPUB per book, and reads them aloud with phrase-level navigation. Built for Android/Chrome as the primary target.

## Core user flow
1. User opens app → sees **Library** (list of in-progress books)
2. User taps a book (or creates a new one) → enters **Scan mode**
3. Camera capture → client-side preprocessing (crop/deskew/contrast) → send to backend OCR (requires connectivity)
4. OCR text returned → appended to the current chapter, or starts a new chapter if the user marked one
5. User taps **Read** → phrase-by-phrase playback via Web Speech API, resuming wherever they left off
6. User can return to Library, resume any book, or scan the next page later as a separate session

## 1. Book management (Library)
- Persistent list of books, each with: title (user-editable, default "Untitled — [date]"), page count, chapter count, created/last-modified date, last read position (chapter + phrase index)
- Actions per book: rename, delete, continue scanning, resume reading, export/share EPUB
- Storage: books belong to the signed-in user and live server-side in Postgres (see §7) — a user only ever sees their own books

## 2. Scanning & OCR
- Capture via `<input type="file" capture="environment">` or `getUserMedia`
- Client-side preprocessing: OpenCV.js or jscanify — edge detection, perspective correction, contrast/binarization — before upload
- POST preprocessed image to Render-hosted `/ocr` endpoint
- Backend (Render, Node/Express): holds OCR provider credentials as env vars, calls the cloud OCR service (Google Cloud Vision — a dedicated OCR API, not a general-purpose LLM, deliberately: an LLM vision model's built-in guardrails against reproducing copyrighted text verbatim conflict directly with OCR-ing real book pages), returns cleaned text; also handles hyphenation rejoin and header/footer/page-number stripping where detectable
- `/ocr` requires a signed-in session, same as every other book-related endpoint — it's a direct proxy onto a paid API key and must not be an open endpoint
- **Scanning requires an active connection** — no offline queueing for v1. Fail clearly if the OCR call can't complete (retry, don't silently drop the page)
- **OCR quality control**: pages append automatically and silently by default. If the OCR provider reports low confidence for a page, the app speaks that page's recognized text aloud immediately (via the same TTS used for reading) and offers "keep" / "retry photo" so the user can catch garbled text by ear — visual proofreading isn't viable for a low-vision user, so this check is audio-only

## 3. EPUB assembly
- Book text (chapters/paragraphs) is the source of truth, stored server-side; the EPUB itself is built on demand from that data when exported, not stored as a separate artifact that could drift out of sync
- **Chapter model**: consecutive scanned pages append into the current chapter by default. User has an explicit "New Chapter" action in Scan mode that closes the current chapter and starts the next
- Export/share the EPUB at any point (e.g. to hand off to @Voice via Android share sheet)
- Recognized title abbreviations ("Mr.", "Dr.", ...) are wrapped as `<abbr title="Mister">Mr.</abbr>` in the exported EPUB — original printed text stays exactly as scanned, with a pronunciation hint for readers/TTS engines that honor the `title` attribute. Support for this varies a lot across EPUB apps (many just speak the visible text and ignore it), so it's a best-effort addition, not a guaranteed fix in every app the export gets opened in

## 4. Reading & phrase/page navigation
- Text segmented into phrases via `Intl.Segmenter` (sentence granularity, with room to go finer if sentences feel too coarse), with a merge pass afterward: `Intl.Segmenter` has no notion of abbreviations, so "Mr. Goenka" or "S. N. Goenka" would otherwise split into separate phrases at each period, and each phrase becomes its own utterance with an audible gap. Phrases ending in a known title/abbreviation (Mr., Dr., etc., ...) or a lone initial (a single letter + period) get merged into the next phrase
- Playback state machine: current book + chapter + phrase index; `SpeechSynthesisUtterance` queue with `onend` auto-advance
- Before each utterance, the text is separately normalized for speech (independent of the phrase-merge above, which only fixes phrase *boundaries*): known titles expand to full words ("Mr." → "Mister", "Dr." → "Doctor", ...) and periods after space-separated lone initials are stripped ("S. N. Goenka" → "S N Goenka") — otherwise the speech engine still inserts its own pause at the literal "." even within one merged utterance
- The Reader shows a list of the device's available `SpeechSynthesisVoice` options (name, language, default/network) in a collapsible panel, for troubleshooting/awareness — no voice *selection* UI yet, playback always uses the browser's default voice
- Skip forward/back by phrase, and separately by whole scanned page (jumps to the first phrase of the next/previous page; crosses a chapter boundary at the first/last page of a chapter rather than stopping) — both bound to on-screen controls; phrase skip is also bound to the Media Session API (`nexttrack`/`previoustrack`) for Bluetooth remote compatibility
- Pause/resume: attempt native `speechSynthesis.pause()/resume()`, but implement cancel+resume-from-phrase-start as a fallback given known Android Chrome reliability issues with native pause
- Resume position persisted per book server-side, but reopening a book always starts from the first phrase of the page it was last on, not the exact phrase — mid-page resume was confusing
- **Bookmark**: separate from the auto-tracked resume position, the user can explicitly mark one phrase per book ("Set Bookmark Here" on the Reader) to return to later, regardless of where auto-resume would otherwise land. Setting a new bookmark overwrites the previous one — only one per book/user. "Play from Last Bookmark" (shown only once a bookmark exists) jumps straight there and starts playback
- **v1 is audio-only** — no on-screen text display or highlighting (explicitly deferred, not a blocker)

## 5. Backend (Render)
- `/ocr` endpoint: image in, text out
- `/auth/*` and `/books/*` endpoints for accounts and book CRUD (see §7)
- OCR provider: Google Cloud Vision
- API keys and secrets stored in Render environment variables, never exposed client-side
- Also serves the built frontend as static files — one Render service hosts the PWA, the API, and (via a linked Render Postgres database) storage

## 6. UI accessibility
- Full accessible UI across every screen (Library, Scan mode, menus, settings) — not just the book-reading feature
- Proper ARIA labels/roles and TalkBack-friendly navigation throughout
- Large touch targets and a high-contrast theme
- This is distinct from book-content reading (§4), which is audio-only by design; §6 covers making the app's own controls usable by a low-vision/screen-reader user

## 7. Accounts & multi-user storage
- Real accounts: anyone can sign up, log in, and only ever sees their own books
- Auth: email + password, hashed server-side; session cookie (httpOnly, secure in production), not a client-stored token
- Storage: Postgres (Render-managed). `users` table for accounts; `books` table (title, chapters/paragraphs as JSON, page count, reading position) scoped by `user_id` — every book query is filtered by the signed-in user, and a book that exists but belongs to someone else 404s rather than 403s, so IDs don't leak who owns what
- A logged-out user is redirected to a Login/Sign-up screen before seeing the Library

## Technical stack
- Frontend: React + Vite (PWA tooling, Web Speech/Media Session APIs); no client-side data storage — the backend is the source of truth
- Backend: Render, Node/Express, serving `/ocr`, `/auth/*`, `/books/*`, and the static frontend build, backed by a Render Postgres database

## Explicitly out of scope for v1
- Offline scanning/OCR queueing
- On-screen text display or phrase highlighting
