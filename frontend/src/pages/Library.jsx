import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { listBooks, createBook, renameBook, deleteBook, fetchEpubBlob } from '../lib/api.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { getAvailableVoices, subscribeToVoices } from '../lib/speech.js'

export default function Library() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [books, setBooks] = useState(null)
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [status, setStatus] = useState('')
  const [voices, setVoices] = useState(() => getAvailableVoices())

  const refresh = useCallback(async () => {
    setBooks(await listBooks())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    setVoices(getAvailableVoices())
    return subscribeToVoices(() => setVoices(getAvailableVoices()))
  }, [])

  async function handleNewBook() {
    const book = await createBook()
    navigate(`/book/${book.id}/scan`)
  }

  function startRename(book) {
    setRenamingId(book.id)
    setRenameValue(book.title)
  }

  async function confirmRename(id) {
    await renameBook(id, renameValue)
    setRenamingId(null)
    await refresh()
    setStatus('Book renamed.')
  }

  async function handleDelete(book) {
    if (!window.confirm(`Delete "${book.title}"? This cannot be undone.`)) return
    await deleteBook(book.id)
    await refresh()
    setStatus(`Deleted "${book.title}".`)
  }

  async function handleExport(book) {
    let blob
    try {
      blob = await fetchEpubBlob(book.id)
    } catch (err) {
      setStatus(err.message || 'Export failed.')
      return
    }
    const file = new File([blob], `${book.title}.epub`, { type: 'application/epub+zip' })
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: book.title })
        return
      } catch {
        // user cancelled or share failed; fall through to download
      }
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${book.title}.epub`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="stack">
      <div className="top-bar">
        <h1>Library</h1>
        <button onClick={logout} aria-label={`Log out of ${user?.email ?? 'your account'}`}>
          Log Out
        </button>
      </div>

      <button className="primary" onClick={handleNewBook}>
        + New Book
      </button>

      <div className="status" role="status" aria-live="polite">
        {status}
      </div>

      {books === null && <p>Loading library…</p>}
      {books?.length === 0 && <p>No books yet. Tap "New Book" to start scanning.</p>}

      <ul className="book-list">
        {books?.map((book) => (
          <li key={book.id} className="book-card">
            {renamingId === book.id ? (
              <div className="field">
                <label htmlFor={`rename-${book.id}`}>Book title</label>
                <input
                  id={`rename-${book.id}`}
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  autoFocus
                />
                <div className="row">
                  <button className="primary" onClick={() => confirmRename(book.id)}>
                    Save
                  </button>
                  <button onClick={() => setRenamingId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="book-card__title">{book.title}</div>
                <div className="book-card__meta">
                  {book.pageCount} page{book.pageCount === 1 ? '' : 's'} · {book.chapterCount}{' '}
                  chapter{book.chapterCount === 1 ? '' : 's'}
                </div>
                <div className="row">
                  <button onClick={() => navigate(`/book/${book.id}/scan`)}>Scan pages</button>
                  <button
                    onClick={() => navigate(`/book/${book.id}/read`)}
                    disabled={book.pageCount === 0}
                  >
                    Read
                  </button>
                </div>
                <div className="row">
                  <button onClick={() => startRename(book)}>Rename</button>
                  <button onClick={() => handleExport(book)} disabled={book.pageCount === 0}>
                    Export EPUB
                  </button>
                  <button className="danger" onClick={() => handleDelete(book)}>
                    Delete
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>

      <details>
        <summary>Voice options on this device ({voices.length})</summary>
        {voices.length === 0 ? (
          <p>No voices reported yet, or this browser doesn't expose a voice list.</p>
        ) : (
          <ul>
            {voices.map((v) => (
              <li key={v.voiceURI}>
                {v.name} — {v.lang}
                {v.default ? ' · default' : ''}
                {v.localService ? '' : ' · network'}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  )
}
