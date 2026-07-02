/**
 * RequireAuth — gate for protected routes.
 *
 * The platform requires an account: unauthenticated visitors are redirected
 * to /login (remembering where they were headed). While the session is still
 * being restored from a stored token, we render a brief loader so a logged-in
 * user isn't bounced to /login on a page refresh.
 */

import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div style={{
        minHeight: 'calc(100vh - 72px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-3, #8a949b)', fontSize: '0.9rem',
      }}>
        Checking your session…
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return children
}
