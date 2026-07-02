/**
 * AuthContext — user accounts for WebMRIQC.
 *
 * An account is required to use the platform: the analysis routes are gated
 * by <RequireAuth>, and the backend rejects unauthenticated job submissions.
 * On login the JWT is stored in localStorage (the key api.js reads) so every
 * MRIQC / DICOM submission is attributed to the user and appears on the
 * "My Submissions" dashboard.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import {
  TOKEN_KEY, getToken,
  registerUser, loginUser, fetchMe,
} from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null)
  const [loading, setLoading] = useState(true)   // true while restoring session

  // Restore session on first load: if a token exists, fetch the user.
  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    fetchMe(token)
      .then((data) => setUser(data.user))
      .catch(() => localStorage.removeItem(TOKEN_KEY))   // stale/invalid token
      .finally(() => setLoading(false))
  }, [])

  const persist = useCallback((data) => {
    localStorage.setItem(TOKEN_KEY, data.token)
    setUser(data.user)
    return data.user
  }, [])

  const login = useCallback(async (creds) => {
    return persist(await loginUser(creds))
  }, [persist])

  const register = useCallback(async (info) => {
    return persist(await registerUser(info))
  }, [persist])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
