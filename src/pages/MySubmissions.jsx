import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fetchMySubmissions, setSubmissionPublic, getToken } from '../lib/api'
import { compareToRef } from '../lib/reference'
import s from './MySubmissions.module.css'

const STATUS_META = {
  queued:   { label: 'Queued',     cls: 'queued'  },
  running:  { label: 'Processing', cls: 'running' },
  done:     { label: 'Complete',   cls: 'done'    },
  error:    { label: 'Failed',     cls: 'error'   },
  expired:  { label: 'Complete',   cls: 'done'    },   // metrics kept even after files expire
  unknown:  { label: 'Unknown',    cls: 'expired' },
}

// Metrics to surface in history, with quality direction for benchmark ranking.
const METRICS = [
  { k: 'cnr',       label: 'CNR',    dir: +1 },
  { k: 'snr_total', label: 'SNR',    dir: +1 },
  { k: 'cjv',       label: 'CJV',    dir: -1 },
  { k: 'efc',       label: 'EFC',    dir: -1 },
  { k: 'fber',      label: 'FBER',   dir: +1 },
  { k: 'inu_med',   label: 'INU',    dir: -1 },
  { k: 'fwhm_avg',  label: 'FWHM',   dir: -1 },
  { k: 'wm2max',    label: 'WM2Max', dir: -1 },
  { k: 'tsnr',      label: 'tSNR',   dir: +1 },
  { k: 'fd_mean',   label: 'FD',     dir: -1 },
]

const pctColor = (p) => (p >= 66 ? 'var(--green)' : p >= 33 ? 'var(--amber)' : 'var(--red)')

function fmtDate(iso) {
  try {
    return new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).toLocaleString([], {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

// Compact metric row: value + percentile vs the open reference population.
function MetricsPanel({ metrics }) {
  const rows = METRICS
    .filter((m) => metrics[m.k] != null && !isNaN(Number(metrics[m.k])))
    .map((m) => ({ ...m, value: Number(metrics[m.k]), ref: compareToRef(m.k, metrics[m.k], m.dir) }))
  if (rows.length === 0) return <p className={s.muted}>No numeric metrics stored for this run.</p>
  return (
    <div className={s.metricsGrid}>
      {rows.map((r) => (
        <div key={r.k} className={s.metricCell}>
          <span className={s.metricName}>{r.label}</span>
          <span className={s.metricVal}>{r.value.toFixed(2)}</span>
          {r.ref ? (
            <span className={s.metricRank} style={{ color: pctColor(r.ref.qualityPct) }}>
              ↑ {r.ref.qualityPct}% vs benchmark
            </span>
          ) : <span className={s.metricRankNa}>—</span>}
        </div>
      ))}
    </div>
  )
}

export default function MySubmissions() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [subs, setSubs]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [open, setOpen]       = useState(() => new Set())   // expanded job_ids
  const [busyId, setBusyId]   = useState(null)              // toggling visibility

  useEffect(() => {
    if (!authLoading && !user) navigate('/login', { state: { from: '/submissions' } })
  }, [authLoading, user, navigate])

  const load = useCallback(async () => {
    try {
      const data = await fetchMySubmissions(getToken())
      setSubs(data.submissions || [])
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [user, load])

  const toggleOpen = (id) => setOpen((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  async function togglePublic(sub) {
    setBusyId(sub.job_id)
    try {
      const next = !sub.is_public
      await setSubmissionPublic(sub.job_id, next)
      setSubs((prev) => prev.map((x) => x.job_id === sub.job_id ? { ...x, is_public: next } : x))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const anyActive = subs.some((x) => x.status === 'queued' || x.status === 'running')

  if (authLoading || !user) return null

  return (
    <div className={s.page}>
      <div className="container">
        <div className={s.header}>
          <div>
            <h1 className={s.title}>My Submissions</h1>
            <p className={s.sub}>
              Signed in as <strong>{user.name || user.email}</strong>
              {user.institution ? ` · ${user.institution}` : ''}
            </p>
          </div>
          <div className={s.headerActions}>
            {anyActive && <span className={s.liveDot}>● live</span>}
            <button className={s.refreshBtn} onClick={load} title="Refresh">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
              Refresh
            </button>
            <Link to="/analyze" className={s.newBtn}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              New Analysis
            </Link>
          </div>
        </div>

        {error && <p className={s.error}>⚠️ {error}</p>}

        {loading ? (
          <p className={s.muted}>Loading your submissions…</p>
        ) : subs.length === 0 ? (
          <div className={s.empty}>
            <h3>No submissions yet</h3>
            <p>Runs you submit while signed in will appear here — with their metrics and how they compare to open benchmarks.</p>
            <Link to="/analyze" className={s.newBtn}>Run your first analysis →</Link>
          </div>
        ) : (
          <div className={s.list}>
            {subs.map((sub) => {
              const meta = STATUS_META[sub.status] || STATUS_META.unknown
              const hasMetrics = sub.metrics && Object.keys(sub.metrics).length > 0
              const isOpen = open.has(sub.job_id)
              return (
                <div key={sub.job_id} className={s.card}>
                  <div className={s.row}>
                    <button
                      className={s.rowMain}
                      onClick={() => hasMetrics && toggleOpen(sub.job_id)}
                      style={{ cursor: hasMetrics ? 'pointer' : 'default' }}
                      title={hasMetrics ? 'View metrics & benchmark comparison' : ''}
                    >
                      <span className={s.rowLabel}>
                        {hasMetrics && (
                          <svg className={isOpen ? s.chevOpen : s.chev} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                        )}
                        {sub.label || sub.job_id}
                      </span>
                      <span className={s.rowMeta}>
                        <span className={s.kindBadge}>{sub.kind === 'dicom' ? 'DICOM→BIDS' : 'MRIQC'}</span>
                        {sub.country && <span className={s.kindBadge}>{sub.country}</span>}
                        job {sub.job_id} · {fmtDate(sub.created_at)}
                      </span>
                    </button>
                    <div className={s.rowRight}>
                      {hasMetrics && (
                        <button
                          className={`${s.pubBtn} ${sub.is_public ? s.pubOn : ''}`}
                          onClick={() => togglePublic(sub)}
                          disabled={busyId === sub.job_id}
                          title={sub.is_public
                            ? 'Shared to the open benchmark pool — click to make private'
                            : 'Share these metrics to the open benchmark pool'}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                          </svg>
                          {sub.is_public ? 'Public' : 'Make public'}
                        </button>
                      )}
                      <div className={`${s.status} ${s[meta.cls]}`}>
                        <span className={s.statusDot} />
                        {meta.label}
                        {sub.status === 'queued' && sub.queue_position != null && (
                          <span className={s.queuePos}>#{sub.queue_position}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {hasMetrics && isOpen && (
                    <div className={s.metricsWrap}>
                      <MetricsPanel metrics={sub.metrics} />
                      <p className={s.benchNote}>
                        “↑ X% vs benchmark” = how this scan ranks against the open reference population
                        of {compareToRef('cnr', sub.metrics.cnr ?? 1, 1)?.refN ?? 33} scans. {' '}
                        {sub.is_public
                          ? 'These metrics are shared in the open pool.'
                          : 'Use “Make public” to contribute these metrics to the open pool.'}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <p className={s.note}>
          Your scan metrics are saved here permanently. Full result files (images, reports) are kept
          on the server only briefly — download the ZIP from the results page for long-term storage.
        </p>
      </div>
    </div>
  )
}
