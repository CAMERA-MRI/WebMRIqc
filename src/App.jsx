import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { AuthProvider } from './context/AuthContext'
import RequireAuth from './components/RequireAuth'
import Navbar  from './components/Navbar'
import Footer  from './components/Footer'
import Support from './components/Support'
import Home    from './pages/Home'
import Analyze from './pages/Analyze'
import Compare from './pages/Compare'
import Login          from './pages/Login'
import Register       from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword  from './pages/ResetPassword'
import MySubmissions  from './pages/MySubmissions'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ScrollToTop />
        <Navbar />
        <Routes>
          {/* Public */}
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Protected — an account is required to use the platform */}
          <Route path="/analyze"     element={<RequireAuth><Analyze /></RequireAuth>} />
          <Route path="/compare"     element={<RequireAuth><Compare /></RequireAuth>} />
          <Route path="/submissions" element={<RequireAuth><MySubmissions /></RequireAuth>} />
        </Routes>
        <Footer />
        {/* Floating support widget — visible on every page */}
        <Support />
      </AuthProvider>
    </BrowserRouter>
  )
}
