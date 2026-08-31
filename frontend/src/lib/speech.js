const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('en', { granularity: 'sentence' })
  : null

/** Split a paragraph into sentence-level phrases. */
function segmentPhrases(text) {
  if (!text) return []
  if (!segmenter) {
    // Fallback for browsers without Intl.Segmenter: naive sentence split.
    return text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return Array.from(segmenter.segment(text), (s) => s.segment.trim()).filter(Boolean)
}

/** Flatten a book's chapters into per-chapter arrays of phrases. */
export function buildPhraseIndex(book) {
  return book.chapters.map((chapter) =>
    chapter.paragraphs.flatMap((paragraph) => segmentPhrases(paragraph))
  )
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
   * @param {{ title: string, phrasesByChapter: string[][] }} book
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
    return this.phrasesByChapter[chapterIndex]?.length ?? 0
  }

  _currentText() {
    return this.phrasesByChapter[this.chapterIndex]?.[this.phraseIndex] ?? ''
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
  const utterance = new SpeechSynthesisUtterance(text)
  if (onEnd) utterance.onend = onEnd
  window.speechSynthesis.speak(utterance)
}

export function stopSpeaking() {
  window.speechSynthesis.cancel()
}
