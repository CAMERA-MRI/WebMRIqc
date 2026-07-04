/**
 * GoogleButton — "Sign in with Google" via Google Identity Services (GIS).
 *
 * The Google client ID is fetched at runtime from /auth/config, so no build-time
 * env var is needed. If Google sign-in isn't configured on the server (empty
 * client ID), the button renders nothing. On success it exchanges the Google
 * ID token for a WebMRIQC session and navigates onward.
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fetchAuthConfig } from '../lib/api'

// Load the GIS script once, shared across mounts.
let gsiPromise
function loadGsi() {
  if (gsiPromise) return gsiPromise
  gsiPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve()
    const sc = document.createElement('script')
    sc.src = 'https://accounts.google.com/gsi/client'
    sc.async = true
    sc.defer = true
    sc.onload = () => resolve()
    sc.onerror = () => reject(new Error('Could not load Google Sign-In'))
    document.head.appendChild(sc)
  })
  return gsiPromise
}

export default function GoogleButton({ onError, dest = '/analyze' }) {
  const { loginWithGoogle } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const ref = useRef(null)
  const [clientId, setClientId] = useState(null)   // null = loading, '' = disabled

  useEffect(() => {
    fetchAuthConfig()
      .then((c) => setClientId(c.google_client_id || ''))
      .catch(() => setClientId(''))
  }, [])

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    loadGsi()
      .then(() => {
        if (cancelled || !ref.current) return
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (resp) => {
            try {
              await loginWithGoogle(resp.credential)
              navigate(location.state?.from || dest)
            } catch (e) {
              onError?.(e.message || 'Google sign-in failed')
            }
          },
        })
        window.google.accounts.id.renderButton(ref.current, {
          theme: 'outline', size: 'large', text: 'continue_with',
          shape: 'pill', width: 320, logo_alignment: 'center',
        })
      })
      .catch((e) => onError?.(e.message))
    return () => { cancelled = true }
  }, [clientId])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!clientId) return null   // still loading, or Google sign-in disabled
  return <div ref={ref} style={{ display: 'flex', justifyContent: 'center' }} />
}
