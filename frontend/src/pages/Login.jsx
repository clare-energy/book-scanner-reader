import { useState } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'

export default function Login() {
  const { login, signup } = useAuth()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'login') {
        await login(email, password)
      } else {
        await signup(email, password)
      }
    } catch (err) {
      setError(err.message || 'Something went wrong, please retry.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <h1>{mode === 'login' ? 'Log In' : 'Sign Up'}</h1>

      <form className="stack" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>

        {error && (
          <div className="status error" role="alert">
            {error}
          </div>
        )}

        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Working…' : mode === 'login' ? 'Log In' : 'Sign Up'}
        </button>
      </form>

      <button onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
        {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
      </button>
    </div>
  )
}
