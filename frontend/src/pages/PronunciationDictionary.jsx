import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  listPronunciations,
  addPronunciation,
  deletePronunciation,
  fetchPronunciationsPlsBlob,
  importPronunciationsPls,
} from '../lib/api.js'

export default function PronunciationDictionary() {
  const navigate = useNavigate()
  const fileInputRef = useRef(null)
  const [entries, setEntries] = useState(null)
  const [term, setTerm] = useState('')
  const [pronunciation, setPronunciation] = useState('')
  const [status, setStatus] = useState('')

  const refresh = useCallback(async () => {
    setEntries(await listPronunciations())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleAdd(e) {
    e.preventDefault()
    if (!term.trim() || !pronunciation.trim()) return
    try {
      await addPronunciation(term.trim(), pronunciation.trim())
      setTerm('')
      setPronunciation('')
      await refresh()
      setStatus('Entry saved.')
    } catch (err) {
      setStatus(err.message || 'Could not save entry, please retry.')
    }
  }

  async function handleDelete(entry) {
    try {
      await deletePronunciation(entry.id)
      await refresh()
      setStatus(`Removed "${entry.term}".`)
    } catch (err) {
      setStatus(err.message || 'Could not remove entry, please retry.')
    }
  }

  async function handleExport() {
    try {
      const blob = await fetchPronunciationsPlsBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'pronunciation-dictionary.pls'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setStatus(err.message || 'Export failed.')
    }
  }

  async function handleImport(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const result = await importPronunciationsPls(file)
      await refresh()
      const skippedNote =
        result.skippedPhonemeOnly > 0
          ? ` (${result.skippedPhonemeOnly} phoneme-only entr${result.skippedPhonemeOnly === 1 ? 'y' : 'ies'} skipped — this app only supports respelling, not IPA)`
          : ''
      setStatus(`Imported ${result.imported} entr${result.imported === 1 ? 'y' : 'ies'}.${skippedNote}`)
    } catch (err) {
      setStatus(err.message || 'Import failed.')
    }
  }

  return (
    <div className="stack">
      <div className="top-bar">
        <h1>Pronunciation Dictionary</h1>
      </div>

      <p className="progress-text">
        Words spelled here will be read using your chosen pronunciation everywhere you read or
        listen — useful for foreign place names, unfamiliar names, or anything else the voice
        engine tends to get wrong.
      </p>

      <form className="stack" onSubmit={handleAdd}>
        <div className="field">
          <label htmlFor="term">Word or phrase as it appears in the text</label>
          <input
            id="term"
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Dún Laoghaire"
          />
        </div>
        <div className="field">
          <label htmlFor="pronunciation">How it should be spoken</label>
          <input
            id="pronunciation"
            type="text"
            value={pronunciation}
            onChange={(e) => setPronunciation(e.target.value)}
            placeholder="Doon Leary"
          />
        </div>
        <div className="row">
          <button className="primary" type="submit">
            Add Entry
          </button>
        </div>
      </form>

      <div className="row">
        <button onClick={handleExport} disabled={!entries?.length}>
          Download (.pls)
        </button>
        <button onClick={() => fileInputRef.current?.click()}>Import (.pls)</button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pls,application/pls+xml"
          onChange={handleImport}
          hidden
        />
      </div>

      {status && (
        <div className="status" role="status" aria-live="polite">
          {status}
        </div>
      )}

      {entries === null && <p>Loading…</p>}
      {entries?.length === 0 && <p>No entries yet.</p>}

      <ul className="book-list">
        {entries?.map((entry) => (
          <li key={entry.id} className="book-card">
            <div className="book-card__title">{entry.term}</div>
            <div className="book-card__meta">spoken as "{entry.pronunciation}"</div>
            <div className="row">
              <button className="danger" onClick={() => handleDelete(entry)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      <button onClick={() => navigate('/')}>Back to Library</button>
    </div>
  )
}
