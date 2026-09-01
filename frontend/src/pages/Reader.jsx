import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getBook, setLastRead, setBookmark as apiSetBookmark } from '../lib/api.js'
import { buildPhraseIndex, PlaybackController } from '../lib/speech.js'

/** Which scanned page (within a chapter) a given phrase index falls on. */
function pageInfoFor(pageStarts, phraseIndex) {
  let pageIndex = 0
  for (let i = 0; i < pageStarts.length; i++) {
    if (pageStarts[i] <= phraseIndex) pageIndex = i
    else break
  }
  return { pageIndex, pageCount: pageStarts.length }
}

/** Snap a phrase-granular position down to the start of whichever page it falls on. */
function snapToPageStart(phrasesByChapter, rawPosition) {
  const pageStarts = phrasesByChapter[rawPosition.chapterIndex]?.pageStarts ?? [0]
  const { pageIndex } = pageInfoFor(pageStarts, rawPosition.phraseIndex)
  return { chapterIndex: rawPosition.chapterIndex, phraseIndex: pageStarts[pageIndex] ?? 0 }
}

export default function Reader() {
  const { id } = useParams()
  const navigate = useNavigate()
  const controllerRef = useRef(null)

  const [book, setBook] = useState(null)
  const [phrasesByChapter, setPhrasesByChapter] = useState(null)
  const [initialPosition, setInitialPosition] = useState(null)
  const [position, setPosition] = useState({ chapterIndex: 0, phraseIndex: 0 })
  const [bookmark, setBookmark] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [finished, setFinished] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const b = await getBook(id)
        if (cancelled) return
        const phrases = buildPhraseIndex(b)
        // Reopening a book always starts from the top of the page it was
        // last on, not the exact phrase — mid-page resume was confusing.
        const start = snapToPageStart(phrases, b.lastRead ?? { chapterIndex: 0, phraseIndex: 0 })
        setBook(b)
        setPhrasesByChapter(phrases)
        setInitialPosition(start)
        setPosition(start)
        setBookmark(b.bookmark ?? null)
      } catch {
        if (!cancelled) navigate('/')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, navigate])

  useEffect(() => {
    if (!book || !phrasesByChapter || !initialPosition) return

    const controller = new PlaybackController(
      { title: book.title, phrasesByChapter },
      initialPosition,
      {
        onPosition: (pos) => {
          setPosition(pos)
          // Best-effort: losing a position save shouldn't interrupt playback.
          setLastRead(book.id, pos.chapterIndex, pos.phraseIndex).catch(() => {})
        },
        onPlayingChange: setIsPlaying,
        onFinished: () => setFinished(true),
      }
    )
    controllerRef.current = controller
    return () => controller.destroy()
  }, [book, phrasesByChapter, initialPosition])

  async function handleSetBookmark() {
    try {
      await apiSetBookmark(book.id, position.chapterIndex, position.phraseIndex)
      setBookmark({ chapterIndex: position.chapterIndex, phraseIndex: position.phraseIndex })
      setStatus('Bookmark set at the current phrase.')
    } catch (err) {
      setStatus(err.message || 'Could not set bookmark, please retry.')
    }
  }

  function handlePlayFromBookmark() {
    if (!bookmark) return
    controllerRef.current?.seek(bookmark.chapterIndex, bookmark.phraseIndex)
    controllerRef.current?.play()
  }

  if (!book || !phrasesByChapter) return <p>Loading…</p>

  const totalPhrasesInChapter = phrasesByChapter[position.chapterIndex]?.phrases.length ?? 0
  const chapterTitle = book.chapters[position.chapterIndex]?.title ?? ''
  const pageStarts = phrasesByChapter[position.chapterIndex]?.pageStarts ?? []
  const { pageIndex, pageCount } = pageInfoFor(pageStarts, position.phraseIndex)

  return (
    <div className="stack">
      <div className="top-bar">
        <h1>Reading: {book.title}</h1>
      </div>

      <p className="progress-text">
        {chapterTitle} — Page {Math.min(pageIndex + 1, pageCount)} of {pageCount} — phrase{' '}
        {Math.min(position.phraseIndex + 1, totalPhrasesInChapter)} of {totalPhrasesInChapter} ·
        Chapter {position.chapterIndex + 1} of {book.chapters.length}
      </p>

      <div className="status" role="status" aria-live="polite">
        {finished ? 'Finished the book.' : isPlaying ? 'Playing.' : 'Paused.'}
      </div>

      <div className="row">
        <button onClick={() => controllerRef.current?.previousPage()} aria-label="Previous page">
          ◀◀ Page
        </button>
        <button onClick={() => controllerRef.current?.nextPage()} aria-label="Next page">
          Page ▶▶
        </button>
      </div>

      <div className="row">
        <button
          onClick={() => controllerRef.current?.previous()}
          aria-label="Previous phrase"
        >
          ⏮ Previous
        </button>
        <button
          className="primary"
          onClick={() => controllerRef.current?.togglePlayPause()}
        >
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
        <button onClick={() => controllerRef.current?.next()} aria-label="Next phrase">
          Next ⏭
        </button>
      </div>

      <div className="row">
        <button onClick={handleSetBookmark}>Set Bookmark Here</button>
        {bookmark && <button onClick={handlePlayFromBookmark}>Play from Last Bookmark</button>}
      </div>

      {status && (
        <div className="status" role="status" aria-live="polite">
          {status}
        </div>
      )}

      <button onClick={() => navigate('/')}>Back to Library</button>
    </div>
  )
}
