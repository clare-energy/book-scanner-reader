import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext.jsx'
import Login from './pages/Login.jsx'
import Library from './pages/Library.jsx'
import ScanMode from './pages/ScanMode.jsx'
import Reader from './pages/Reader.jsx'

function RequireAuth({ children }) {
  const { user, checking } = useAuth()
  if (checking) return <p>Loading…</p>
  if (!user) return <Navigate to="/login" replace />
  return children
}

function RedirectIfAuthed({ children }) {
  const { user, checking } = useAuth()
  if (checking) return <p>Loading…</p>
  if (user) return <Navigate to="/" replace />
  return children
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAuthed>
            <Login />
          </RedirectIfAuthed>
        }
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Library />
          </RequireAuth>
        }
      />
      <Route
        path="/book/:id/scan"
        element={
          <RequireAuth>
            <ScanMode />
          </RequireAuth>
        }
      />
      <Route
        path="/book/:id/read"
        element={
          <RequireAuth>
            <Reader />
          </RequireAuth>
        }
      />
    </Routes>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <div className="app">
          <AppRoutes />
        </div>
      </AuthProvider>
    </HashRouter>
  )
}
