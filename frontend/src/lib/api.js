async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  })

  if (response.status === 401) {
    window.dispatchEvent(new Event('auth:unauthorized'))
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `Request failed (${response.status})`)
  }

  if (response.status === 204) return null
  return response.json()
}

// --- auth ---

export const signup = (email, password) =>
  request('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) })

export const login = (email, password) =>
  request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })

export const logout = () => request('/auth/logout', { method: 'POST' })

export const me = () => request('/auth/me')

// --- books ---

export const listBooks = () => request('/books')

export const createBook = (title) =>
  request('/books', { method: 'POST', body: JSON.stringify({ title }) })

export const getBook = (id) => request(`/books/${id}`)

export const renameBook = (id, title) =>
  request(`/books/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) })

export const deleteBook = (id) => request(`/books/${id}`, { method: 'DELETE' })

export const appendPageText = (id, text) =>
  request(`/books/${id}/pages`, { method: 'POST', body: JSON.stringify({ text }) })

export const startNewChapter = (id) => request(`/books/${id}/chapters`, { method: 'POST' })

export const setLastRead = (id, chapterIndex, phraseIndex) =>
  request(`/books/${id}/position`, {
    method: 'PUT',
    body: JSON.stringify({ chapterIndex, phraseIndex }),
  })

export async function fetchEpubBlob(id) {
  const response = await fetch(`/books/${id}/epub`)
  if (response.status === 401) {
    window.dispatchEvent(new Event('auth:unauthorized'))
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || 'Export failed')
  }
  return response.blob()
}
