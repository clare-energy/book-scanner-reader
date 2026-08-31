import { HashRouter, Routes, Route } from 'react-router-dom'
import Library from './pages/Library.jsx'
import ScanMode from './pages/ScanMode.jsx'
import Reader from './pages/Reader.jsx'

export default function App() {
  return (
    <HashRouter>
      <div className="app">
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/book/:id/scan" element={<ScanMode />} />
          <Route path="/book/:id/read" element={<Reader />} />
        </Routes>
      </div>
    </HashRouter>
  )
}
