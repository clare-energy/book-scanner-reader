import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getBook, appendPageText, startNewChapter } from '../lib/db.js'
import { preprocessPageImage } from '../lib/imagePrep.js'
import { ocrImage } from '../lib/ocrClient.js'
import { speakOnce, stopSpeaking } from '../lib/speech.js'

export default function ScanMode() {
  const { id } = useParams()
  const navigate = useNavigate()
  const fileInputRef = useRef(null)

  const [book, setBook] = useState(null)
  const [status, setStatus] = useState('')
  const [isError, setIsError] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [pendingReview, setPendingReview] = useState(null)

  const refresh = useCallback(async () => {
    const b = await getBook(id)
    if (!b) {
      navigate('/')
      return
    }
    setBook(b)
  }, [id, navigate])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => stopSpeaking, [])

  function openCamera() {
    fileInputRef.current?.click()
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setIsError(false)
    setIsBusy(true)
    try {
      setStatus('Processing photo…')
      const prepared = await preprocessPageImage(file)

      setStatus('Reading page text…')
      const result = await ocrImage(prepared)

      if (!result.text.trim()) {
        setIsError(true)
        setStatus('No text was found on that page. Try again with better lighting or framing.')
        return
      }

      if (result.lowConfidence) {
        setPendingReview(result)
        setStatus('Some text may be unclear. Listen to the readback, then choose Keep or Retry.')
        speakOnce(result.text)
      } else {
        await commitPage(result.text)
      }
    } catch (err) {
      setIsError(true)
      setStatus(err.message || 'Something went wrong, please retry.')
    } finally {
      setIsBusy(false)
    }
  }

  async function commitPage(text) {
    const updated = await appendPageText(id, text)
    setBook(updated)
    setIsError(false)
    setStatus(`Page ${updated.pageCount} added to ${updated.chapters[updated.currentChapterIndex].title}.`)
  }

  async function handleKeep() {
    stopSpeaking()
    const text = pendingReview.text
    setPendingReview(null)
    await commitPage(text)
  }

  function handleRetry() {
    stopSpeaking()
    setPendingReview(null)
    setStatus('Discarded. Take another photo of the same page.')
  }

  async function handleNewChapter() {
    const updated = await startNewChapter(id)
    setBook(updated)
    setStatus(`Started ${updated.chapters[updated.currentChapterIndex].title}.`)
  }

  if (!book) return <p>Loading…</p>

  const currentChapter = book.chapters[book.currentChapterIndex]

  return (
    <div className="stack">
      <div className="top-bar">
        <h1>Scan: {book.title}</h1>
      </div>

      <p className="progress-text">
        {currentChapter.title} · {book.pageCount} page{book.pageCount === 1 ? '' : 's'} scanned overall
      </p>

      <div className={`status${isError ? ' error' : ''}`} role="status" aria-live="polite">
        {status || 'Ready to scan the next page.'}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="visually-hidden"
        aria-hidden="true"
        tabIndex={-1}
      />

      {pendingReview ? (
        <div className="stack">
          <button className="primary" onClick={handleKeep}>
            Keep this page
          </button>
          <button onClick={handleRetry}>Retry — take the photo again</button>
        </div>
      ) : (
        <button className="primary" onClick={openCamera} disabled={isBusy}>
          {isBusy ? 'Working…' : 'Take Photo'}
        </button>
      )}

      <div className="row">
        <button onClick={handleNewChapter} disabled={isBusy || !!pendingReview}>
          New Chapter
        </button>
        <button onClick={() => navigate('/')} disabled={isBusy || !!pendingReview}>
          Done — Back to Library
        </button>
      </div>
    </div>
  )
}
