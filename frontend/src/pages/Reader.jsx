import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getBook, setLastRead } from '../lib/api.js'
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

export default function Reader() {
  const { id } = useParams()
  const navigate = useNavigate()
  const controllerRef = useRef(null)

  const [book, setBook] = useState(null)
  const [phrasesByChapter, setPhrasesByChapter] = useState(null)
  const [position, setPosition] = useState({ chapterIndex: 0, phraseIndex: 0 })
  const [isPlaying, setIsPlaying] = useState(false)
  const [finished, setFinished] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const b = await getBook(id)
        if (cancelled) return
        const phrases = buildPhraseIndex(b)
        setBook(b)
        setPhrasesByChapter(phrases)
        setPosition(b.lastRead ?? { chapterIndex: 0, phraseIndex: 0 })
      } catch {
        if (!cancelled) navigate('/')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, navigate])

  useEffect(() => {
    if (!book || !phrasesByChapter) return

    const controller = new PlaybackController(
      { title: book.title, phrasesByChapter },
      book.lastRead ?? { chapterIndex: 0, phraseIndex: 0 },
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
  }, [book, phrasesByChapter])

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

      <button onClick={() => navigate('/')}>Back to Library</button>
    </div>
  )
}
