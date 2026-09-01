const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('en', { granularity: 'sentence' })
  : null

// Intl.Segmenter's sentence boundaries have no notion of abbreviations, so
// "Mr. Goenka" reads as two sentences ("Mr." / "Goenka") and "S. N. Goenka"
// reads as three ("S." / "N." / "Goenka") — each becomes its own
// SpeechSynthesisUtterance, so the abbreviation gets spoken in isolation
// (typically as a bare letter/initialism) with an audible gap before the
// name that should immediately follow it.
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'mx', 'dr', 'prof', 'st', 'jr', 'sr', 'rev', 'gen',
  'capt', 'col', 'sgt', 'lt', 'fr', 'msgr', 'hon', 'sen', 'rep', 'gov',
  'vs', 'etc', 'approx', 'no', 'vol', 'ed', 'est', 'dept', 'inc', 'ltd', 'co',
])

/** True if `text` ends in something that can't actually end a sentence. */
function endsWithAbbreviation(text) {
  const match = text.match(/(\p{L}+)\.$/u)
  if (!match) return false
  const word = match[1]
  // A single letter before the period is a lone initial (as in "S. N.
  // Goenka" or "U.S."), never a complete sentence on its own.
  return word.length === 1 || ABBREVIATIONS.has(word.toLowerCase())
}

// Merging phrases (above) fixes phrase *boundaries* for navigation, but the
// speech engine itself still sees a literal "." after "Mr" and inserts its
// own pause there — that happens at the TTS engine level, independent of
// how many sentences we packed into one utterance. So the abbreviation
// itself needs rewriting before it's spoken: expand common titles to full
// words, and strip the period after lone initials so there's no "."
// left for the engine to pause on.
const TITLE_EXPANSIONS = {
  mr: 'Mister', mrs: 'Missus', ms: 'Miz', mx: 'Mix', dr: 'Doctor',
  prof: 'Professor', jr: 'Junior', sr: 'Senior', rev: 'Reverend',
  gen: 'General', capt: 'Captain', col: 'Colonel', sgt: 'Sergeant',
  lt: 'Lieutenant', fr: 'Father', msgr: 'Monsignor', hon: 'Honorable',
  sen: 'Senator', rep: 'Representative', gov: 'Governor',
  vs: 'versus', etc: 'et cetera', approx: 'approximately',
}

/** Rewrite abbreviations so the speech engine doesn't pause mid-utterance. */
function normalizeForSpeech(text) {
  return text
    .replace(/\b(\p{L}+)\.(?=\s|$)/gu, (match, word) => {
      const expansion = TITLE_EXPANSIONS[word.toLowerCase()]
      return expansion ?? match
    })
    // Lone initials with a space between them ("S. N. Goenka") — drop the
    // period so the engine doesn't treat it as a sentence end. The negative
    // lookbehind excludes compact forms like "U.S." (no space between
    // letters): without it, "S." in "U.S." would still match on its own
    // and lose its period while "U." keeps its (guarded by the lookahead
    // below), corrupting "U.S." into "U.S" instead of leaving it alone.
    .replace(/\b(?<!\p{Lu}\.)(\p{Lu})\.(?=\s)/gu, '$1')
}

/** Split a paragraph into sentence-level phrases. */
function segmentPhrases(text) {
  if (!text) return []
  const rawPhrases = segmenter
    ? Array.from(segmenter.segment(text), (s) => s.segment.trim()).filter(Boolean)
    : text
        // Fallback for browsers without Intl.Segmenter: naive sentence split.
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean)

  const phrases = []
  let buffer = ''
  for (const raw of rawPhrases) {
    buffer = buffer ? `${buffer} ${raw}` : raw
    if (!endsWithAbbreviation(buffer)) {
      phrases.push(buffer)
      buffer = ''
    }
  }
  if (buffer) phrases.push(buffer)
  return phrases
}

function stripDiacritics(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Builds a single-pass matcher for a user's pronunciation dictionary, so
 * applying it to a phrase costs one regex scan rather than one scan per
 * dictionary entry. Matching is diacritic- and case-insensitive (both the
 * dictionary keys and the search text are compared in stripped-lowercased
 * form) so "Dún Laoghaire" and "Dun Laoghaire" hit the same entry, while the
 * replacement text and everywhere else the original text is used stay
 * untouched. Longest terms are tried first so a multi-word entry isn't
 * shadowed by a shorter overlapping one.
 */
export function buildPronunciationMatcher(entries) {
  if (!entries?.length) return null
  const sorted = [...entries].sort((a, b) => b.term.length - a.term.length)
  const lookup = new Map()
  const patterns = []
  for (const { term, pronunciation } of sorted) {
    const key = stripDiacritics(term).toLowerCase()
    if (!key || lookup.has(key)) continue
    lookup.set(key, pronunciation)
    patterns.push(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  }
  if (!patterns.length) return null
  return { regex: new RegExp(`\\b(?:${patterns.join('|')})\\b`, 'g'), lookup }
}

/**
 * Applies a pronunciation matcher to one phrase. Matching runs against a
 * diacritic-stripped, lowercased copy of the text (same length as the
 * original, since stripping a combining mark always collapses one
 * precomposed accented character back to one base character) so the match
 * span's index lines up with the original string, which is what actually
 * gets sliced and replaced.
 */
export function applyPronunciations(text, matcher) {
  if (!matcher) return text
  const normalized = stripDiacritics(text).toLowerCase()
  if (normalized.length !== text.length) return text
  let result = ''
  let lastIndex = 0
  for (const match of normalized.matchAll(matcher.regex)) {
    const start = match.index
    const end = start + match[0].length
    result += text.slice(lastIndex, start) + matcher.lookup.get(match[0])
    lastIndex = end
  }
  return result + text.slice(lastIndex)
}

/**
 * Flatten a book's chapters into per-chapter phrase lists, keeping track of
 * which flattened phrase index each scanned page starts at (pageStarts) so
 * the Reader can jump between physical pages, not just phrases. Pronunciation
 * substitution and abbreviation normalization both run here, once per phrase
 * at build time, rather than at speak time — that build only happens once
 * per book-open (or after an edit), so this avoids re-scanning the same
 * phrase's text on every replay.
 */
export function buildPhraseIndex(book, pronunciationEntries = []) {
  const matcher = buildPronunciationMatcher(pronunciationEntries)
  return book.chapters.map((chapter) => {
    const phrases = []
    const pageStarts = []
    for (const page of chapter.pages) {
      pageStarts.push(phrases.length)
      for (const paragraph of page) {
        for (const phrase of segmentPhrases(paragraph)) {
          phrases.push(normalizeForSpeech(applyPronunciations(phrase, matcher)))
        }
      }
    }
    return { phrases, pageStarts }
  })
}

/**
 * Drives phrase-by-phrase SpeechSynthesis playback for a book, with
 * Media Session integration for Bluetooth/hardware remote support.
 *
 * Native `speechSynthesis.pause()/resume()` is unreliable on Android Chrome,
 * so pause is implemented as cancel + resume-from-current-phrase-start.
 */
export class PlaybackController {
  /**
   * @param {{ title: string, phrasesByChapter: { phrases: string[], pageStarts: number[] }[] }} book
   * @param {{ chapterIndex: number, phraseIndex: number }} startPosition
   * @param {{
   *   onPosition?: (pos: { chapterIndex: number, phraseIndex: number }) => void,
   *   onPlayingChange?: (isPlaying: boolean) => void,
   *   onFinished?: () => void,
   * }} handlers
   */
  constructor(book, startPosition, handlers = {}) {
    this.title = book.title
    this.phrasesByChapter = book.phrasesByChapter
    this.chapterIndex = clamp(startPosition?.chapterIndex ?? 0, 0, this.phrasesByChapter.length - 1)
    this.phraseIndex = clamp(startPosition?.phraseIndex ?? 0, 0, this._chapterLength(this.chapterIndex) - 1)
    this.isPlaying = false
    this.handlers = handlers
    this._playToken = 0
    this._setupMediaSession()
  }

  _chapterLength(chapterIndex) {
    return this.phrasesByChapter[chapterIndex]?.phrases.length ?? 0
  }

  _currentText() {
    return this.phrasesByChapter[this.chapterIndex]?.phrases[this.phraseIndex] ?? ''
  }

  _pageStarts(chapterIndex = this.chapterIndex) {
    return this.phrasesByChapter[chapterIndex]?.pageStarts ?? []
  }

  /** Which page (within the current chapter) the current phrase falls on. */
  _pageInfo() {
    const pageStarts = this._pageStarts()
    let pageIndex = 0
    for (let i = 0; i < pageStarts.length; i++) {
      if (pageStarts[i] <= this.phraseIndex) pageIndex = i
      else break
    }
    return { pageIndex, pageCount: pageStarts.length }
  }

  _notifyPosition() {
    this.handlers.onPosition?.({ chapterIndex: this.chapterIndex, phraseIndex: this.phraseIndex })
  }

  _setupMediaSession() {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({ title: this.title })
    navigator.mediaSession.setActionHandler('play', () => this.play())
    navigator.mediaSession.setActionHandler('pause', () => this.pause())
    navigator.mediaSession.setActionHandler('previoustrack', () => this.previous())
    navigator.mediaSession.setActionHandler('nexttrack', () => this.next())
  }

  _setPlaying(isPlaying) {
    this.isPlaying = isPlaying
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
    }
    this.handlers.onPlayingChange?.(isPlaying)
  }

  _speakCurrent() {
    const text = this._currentText()
    if (!text) {
      this._advanceOrFinish()
      return
    }
    window.speechSynthesis.cancel()
    const token = ++this._playToken
    // text is already normalized + pronunciation-substituted — that all
    // happens once in buildPhraseIndex(), not per utterance/replay here.
    const utterance = new SpeechSynthesisUtterance(text)
    // Cancelling the previous utterance (below, and on next/previous/pause)
    // fires ITS onend/onerror asynchronously. Without the token guard, that
    // stale event would trigger a second, spurious _advanceOrFinish() on
    // top of the one the navigation action already did.
    utterance.onend = () => {
      if (!this.isPlaying || token !== this._playToken) return
      this._advanceOrFinish()
    }
    utterance.onerror = () => {
      if (!this.isPlaying || token !== this._playToken) return
      this._advanceOrFinish()
    }
    window.speechSynthesis.speak(utterance)
  }

  _advanceOrFinish() {
    if (this.phraseIndex + 1 < this._chapterLength(this.chapterIndex)) {
      this.phraseIndex += 1
    } else if (this.chapterIndex + 1 < this.phrasesByChapter.length) {
      this.chapterIndex += 1
      this.phraseIndex = 0
    } else {
      this._setPlaying(false)
      this.handlers.onFinished?.()
      return
    }
    this._notifyPosition()
    this._speakCurrent()
  }

  play() {
    if (this.isPlaying) return
    this._setPlaying(true)
    this._speakCurrent()
  }

  pause() {
    if (!this.isPlaying) return
    this._setPlaying(false)
    window.speechSynthesis.cancel()
  }

  togglePlayPause() {
    if (this.isPlaying) this.pause()
    else this.play()
  }

  next() {
    if (this.phraseIndex + 1 < this._chapterLength(this.chapterIndex)) {
      this.phraseIndex += 1
    } else if (this.chapterIndex + 1 < this.phrasesByChapter.length) {
      this.chapterIndex += 1
      this.phraseIndex = 0
    } else {
      return
    }
    this._notifyPosition()
    if (this.isPlaying) this._speakCurrent()
  }

  previous() {
    if (this.phraseIndex > 0) {
      this.phraseIndex -= 1
    } else if (this.chapterIndex > 0) {
      this.chapterIndex -= 1
      this.phraseIndex = Math.max(0, this._chapterLength(this.chapterIndex) - 1)
    } else {
      return
    }
    this._notifyPosition()
    if (this.isPlaying) this._speakCurrent()
  }

  /**
   * Swap in freshly rebuilt phrase data (e.g. after a page's text was hand-
   * edited), clamping the current position so it stays valid even if the
   * edit changed the phrase count. Callers should follow up with seek() to
   * land somewhere meaningful rather than relying on the clamp alone.
   */
  updatePhrases(phrasesByChapter) {
    this.phrasesByChapter = phrasesByChapter
    this.chapterIndex = clamp(this.chapterIndex, 0, this.phrasesByChapter.length - 1)
    this.phraseIndex = clamp(this.phraseIndex, 0, this._chapterLength(this.chapterIndex) - 1)
  }

  /** Jump straight to a given chapter + phrase (e.g. from page navigation). */
  seek(chapterIndex, phraseIndex) {
    const ci = clamp(chapterIndex, 0, this.phrasesByChapter.length - 1)
    const pi = clamp(phraseIndex, 0, this._chapterLength(ci) - 1)
    this.chapterIndex = ci
    this.phraseIndex = pi
    this._notifyPosition()
    if (this.isPlaying) this._speakCurrent()
  }

  /** Jump to the next scanned page, crossing into the next chapter if needed. */
  nextPage() {
    const { pageIndex, pageCount } = this._pageInfo()
    if (pageIndex + 1 < pageCount) {
      this.seek(this.chapterIndex, this._pageStarts()[pageIndex + 1])
    } else if (this.chapterIndex + 1 < this.phrasesByChapter.length) {
      this.seek(this.chapterIndex + 1, 0)
    }
  }

  /** Jump to the previous scanned page, crossing into the previous chapter if needed. */
  previousPage() {
    const { pageIndex } = this._pageInfo()
    if (pageIndex > 0) {
      this.seek(this.chapterIndex, this._pageStarts()[pageIndex - 1])
    } else if (this.chapterIndex > 0) {
      const prevStarts = this._pageStarts(this.chapterIndex - 1)
      this.seek(this.chapterIndex - 1, prevStarts[prevStarts.length - 1] ?? 0)
    }
  }

  destroy() {
    window.speechSynthesis.cancel()
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', null)
      navigator.mediaSession.setActionHandler('pause', null)
      navigator.mediaSession.setActionHandler('previoustrack', null)
      navigator.mediaSession.setActionHandler('nexttrack', null)
    }
  }
}

function clamp(value, min, max) {
  if (Number.isNaN(value) || max < min) return 0
  return Math.min(Math.max(value, min), max)
}

/** Speak a one-off piece of text (used for the low-confidence OCR readback check). */
export function speakOnce(text, onEnd) {
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(normalizeForSpeech(text))
  if (onEnd) utterance.onend = onEnd
  window.speechSynthesis.speak(utterance)
}

export function stopSpeaking() {
  window.speechSynthesis.cancel()
}

/** Currently available SpeechSynthesis voices (may be empty until the browser finishes loading them — see subscribeToVoices). */
export function getAvailableVoices() {
  return typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : []
}

/**
 * Voice lists often load asynchronously after the page starts. Calls
 * `callback` whenever the browser's voice list changes/becomes available.
 * Returns an unsubscribe function.
 */
export function subscribeToVoices(callback) {
  if (typeof speechSynthesis === 'undefined') return () => {}
  speechSynthesis.addEventListener('voiceschanged', callback)
  return () => speechSynthesis.removeEventListener('voiceschanged', callback)
}
