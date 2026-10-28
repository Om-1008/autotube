import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000';

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  generating:       { label: '🧠 Generating script',  color: '#6c63ff', bg: '#f0efff' },
  researching:      { label: '🔎 Researching topic',  color: '#6c63ff', bg: '#f0efff' },
  writing:          { label: '✍️ Writing script',     color: '#6c63ff', bg: '#f0efff' },
  finalizing:       { label: '🏷️ Finishing details',  color: '#6c63ff', bg: '#f0efff' },
  pending_approval: { label: '⏳ Needs Your Review',  color: '#d97706', bg: '#fffbeb' },
  approved:         { label: '✅ Approved',           color: '#10b981', bg: '#ecfdf5' },
  queued:           { label: '🖥️ Starting render',    color: '#3b82f6', bg: '#eff6ff' },
  voiceover:        { label: '🎙️ Recording voice',    color: '#3b82f6', bg: '#eff6ff' },
  footage:          { label: '🎞️ Finding footage',    color: '#3b82f6', bg: '#eff6ff' },
  rendering:        { label: '🎬 Editing video',      color: '#3b82f6', bg: '#eff6ff' },
  uploading:        { label: '📤 Uploading',          color: '#8b5cf6', bg: '#f5f3ff' },
  rendered:         { label: '📦 Rendered',           color: '#0f766e', bg: '#f0fdfa' },
  uploaded:         { label: '🎉 Live on YouTube',    color: '#059669', bg: '#d1fae5' },
  rejected:         { label: '❌ Rejected',           color: '#ef4444', bg: '#fef2f2' },
  error:            { label: '⚠️ Error',              color: '#dc2626', bg: '#fef2f2' },
};
const ACTIVE = new Set(['generating', 'researching', 'writing', 'finalizing', 'approved', 'queued', 'voiceover', 'footage', 'rendering', 'uploading']);
const isActive = (v) => ACTIVE.has(v.status);

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { label: status, color: '#6b7280', bg: '#f9fafb' };
  return (
    <span className={ACTIVE.has(status) ? 'at-pulse' : ''} style={{
      background: cfg.bg, color: cfg.color, padding: '4px 12px', borderRadius: 20,
      fontSize: 13, fontWeight: 600, border: `1px solid ${cfg.color}33`, whiteSpace: 'nowrap',
    }}>{cfg.label}</span>
  );
}

function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

function fmtClock(iso) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function useNow(active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

// ─── Live progress panel ──────────────────────────────────────────────────────
function ProgressPanel({ video }) {
  const active = isActive(video);
  const now = useNow(active);
  const logRef = useRef(null);
  const stages = video.stages || [];
  const log = video.log || [];

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log.length]);

  if (!stages.length) {
    return active ? (
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, color: '#6c63ff', fontSize: 13 }}>
        <div className="at-spinner" /> Starting…
      </div>
    ) : null;
  }

  const doneCount = stages.filter(s => s.state === 'done').length;
  const current = stages.find(s => s.state === 'active' || s.state === 'error');
  const frac = current && current.state === 'active' && video.percent != null ? video.percent / 100 : (current ? 0.5 : 0);
  const overall = Math.round(((doneCount + (active ? frac : 0)) / stages.length) * 100);
  const failed = video.status === 'error';
  const barColor = failed ? '#ef4444' : video.phase === 'generate' ? '#6c63ff' : '#3b82f6';
  const started = video.startedAt ? new Date(video.startedAt).getTime() : null;
  const lastUpdate = video.updatedAt ? Math.round((now - new Date(video.updatedAt).getTime()) / 1000) : null;

  return (
    <div style={{ marginTop: 16, background: '#fafbff', border: '1px solid #e8eaf6', borderRadius: 12, padding: 16 }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e' }}>
          {video.phase === 'generate' ? 'Creating script' : 'Producing video'}
          <span style={{ color: '#888', fontWeight: 500 }}> · {active ? `${overall}%` : failed ? 'stopped' : 'complete'}</span>
        </div>
        <div style={{ fontSize: 12, color: '#888', display: 'flex', gap: 12 }}>
          {started && <span>⏱ {fmtElapsed((active ? now : new Date(video.updatedAt).getTime()) - started)}</span>}
          {active && lastUpdate != null && lastUpdate > 60 && <span>last update {lastUpdate}s ago</span>}
          {video.runUrl && (
            <a href={video.runUrl} target="_blank" rel="noreferrer" style={{ color: '#6c63ff', fontWeight: 600, textDecoration: 'none' }}>
              Server log ↗
            </a>
          )}
        </div>
      </div>

      {/* Overall bar */}
      <div style={{ height: 8, background: '#e5e7eb', borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
        <div className={active && video.percent == null ? 'at-bar-indeterminate' : ''} style={{
          width: `${Math.max(active ? 4 : 0, failed ? Math.max(overall, 4) : overall)}%`, height: '100%',
          background: barColor, borderRadius: 6, transition: 'width 0.6s ease',
        }} />
      </div>

      {/* Stage stepper */}
      <div className="at-stepper">
        {stages.map((s, i) => {
          const color = s.state === 'done' ? '#10b981' : s.state === 'active' ? barColor : s.state === 'error' ? '#ef4444' : '#c4c4cc';
          return (
            <div key={s.key} className="at-step" style={{
              background: s.state === 'active' ? '#fff' : 'transparent',
              border: `1px solid ${s.state === 'active' ? barColor + '55' : s.state === 'error' ? '#fecaca' : '#eceef5'}`,
              borderRadius: 10, padding: '8px 10px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                {s.state === 'active' ? <div className="at-spinner" style={{ borderTopColor: barColor }} />
                  : <span style={{
                      width: 16, height: 16, borderRadius: '50%', flexShrink: 0, fontSize: 10, fontWeight: 800,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: s.state === 'pending' ? '#fff' : color, color: s.state === 'pending' ? '#aaa' : '#fff',
                      border: s.state === 'pending' ? '1.5px solid #d4d4dc' : 'none',
                    }}>{s.state === 'done' ? '✓' : s.state === 'error' ? '!' : i + 1}</span>}
                <span style={{ fontSize: 12.5, fontWeight: 600, color: s.state === 'pending' ? '#9ca3af' : '#1f2937' }}>{s.label}</span>
              </div>
              {s.state === 'active' && (
                <div style={{ marginTop: 6 }}>
                  {s.detail && <div style={{ fontSize: 11.5, color: '#6b7280', lineHeight: 1.35 }}>{s.detail}</div>}
                  {video.percent != null && (
                    <div style={{ height: 4, background: '#eef0f6', borderRadius: 3, marginTop: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${video.percent}%`, height: '100%', background: barColor, transition: 'width 0.6s ease' }} />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Activity log */}
      {log.length > 0 && (
        <div ref={logRef} style={{
          marginTop: 12, background: '#0f172a', color: '#cbd5e1', borderRadius: 8,
          padding: '10px 12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 11.5, lineHeight: 1.65, maxHeight: 150, overflowY: 'auto',
        }}>
          {log.map((l, i) => (
            <div key={`${l.t}-${i}`} className={i === log.length - 1 ? 'at-logline' : ''} style={{ display: 'flex', gap: 10 }}>
              <span style={{ color: '#64748b', flexShrink: 0 }}>{fmtClock(l.t)}</span>
              <span style={{ color: l.msg.startsWith('❌') ? '#fca5a5' : l.msg.startsWith('⚠️') ? '#fcd34d' : l.msg.startsWith('🎉') ? '#86efac' : '#e2e8f0', wordBreak: 'break-word' }}>{l.msg}</span>
            </div>
          ))}
          {active && <div className="at-pulse" style={{ color: '#64748b' }}>▍</div>}
        </div>
      )}

      {active && video.phase === 'render' && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: '#9ca3af' }}>
          Rendering runs on a separate server — you can close this tab, it keeps going.
        </div>
      )}
    </div>
  );
}

// ─── Script Modal ──────────────────────────────────────────────────────────────
function ScriptModal({ video, onClose, onApprove, onReject }) {
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [loading, setLoading] = useState(false);

  const script = video.script?.script || 'No script available yet.';
  const sections = video.script?.sections || [];

  async function handleApprove() {
    setLoading(true);
    await onApprove(video.id);
    setLoading(false);
    onClose();
  }

  async function handleReject() {
    setLoading(true);
    await onReject(video.id, rejectReason);
    setLoading(false);
    onClose();
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 800, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', boxShadow: '0 25px 60px rgba(0,0,0,0.3)',
      }}>
        <div style={{ padding: '24px 28px 16px', borderBottom: '1px solid #eee', flexShrink: 0 }} className="at-pad">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 20, color: '#1a1a2e' }}>{video.title}</h2>
              <div style={{ marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <StatusBadge status={video.status} />
                <span style={{ color: '#888', fontSize: 13 }}>
                  📝 {video.script?.wordCount || '?'} words · ⏱ {video.script?.duration || '~9 min'}
                </span>
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#888', lineHeight: 1, padding: '0 4px' }}>×</button>
          </div>
        </div>

        {sections.length > 0 && (
          <div style={{ padding: '12px 28px 0', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }} className="at-pad">
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 12 }}>
              {sections.map(s => (
                <span key={s.name} style={{ background: '#f5f5ff', color: '#6c63ff', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{s.name}</span>
              ))}
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }} className="at-pad">
          <div style={{ fontFamily: 'Georgia, serif', lineHeight: 1.9, fontSize: 15, color: '#2d2d2d' }}>
            {script.split('\n').map((line, i) => {
              const t = line.trim();
              if (!t) return null;
              if (/^\**\[B-ROLL:/i.test(t)) {
                return <div key={i} style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '6px 12px', margin: '10px 0', color: '#0369a1', fontSize: 13, fontStyle: 'italic', fontFamily: 'inherit' }}>🎥 {t.replace(/\*\*/g, '')}</div>;
              }
              if (/^#{1,6}\s/.test(t)) {
                return <h4 key={i} style={{ margin: '18px 0 6px', fontFamily: '-apple-system, sans-serif', color: '#1a1a2e' }}>{t.replace(/^#+\s*/, '')}</h4>;
              }
              if (/^\[PAUSE\]$/i.test(t)) return <div key={i} style={{ textAlign: 'center', color: '#d1d5db', fontSize: 12 }}>— pause —</div>;
              return <p key={i} style={{ margin: '0 0 8px' }}>{t.replace(/\[PAUSE\]/gi, '…')}</p>;
            })}
          </div>

          {video.script?.thumbnailIdeas?.length > 0 && (
            <div style={{ marginTop: 24, padding: 16, background: '#fffbeb', borderRadius: 10 }}>
              <strong style={{ fontSize: 13, color: '#92400e' }}>💡 Thumbnail Ideas</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: '#78350f', fontSize: 13 }}>
                {video.script.thumbnailIdeas.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}
        </div>

        {video.status === 'pending_approval' && (
          <div style={{ padding: '16px 28px 24px', borderTop: '1px solid #eee', flexShrink: 0 }} className="at-pad">
            {!showReject ? (
              <div style={{ display: 'flex', gap: 12 }}>
                <button onClick={handleApprove} disabled={loading} style={{
                  flex: 1, background: 'linear-gradient(135deg, #10b981, #059669)', color: '#fff', border: 'none',
                  borderRadius: 12, padding: '14px 24px', fontSize: 16, fontWeight: 700,
                  cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
                }}>{loading ? '⏳ Starting…' : '✅ Approve & Produce Video'}</button>
                <button onClick={() => setShowReject(true)} style={{
                  background: '#fff', color: '#ef4444', border: '2px solid #ef4444', borderRadius: 12,
                  padding: '14px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}>❌ Reject</button>
              </div>
            ) : (
              <div>
                <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                  placeholder="Why are you rejecting? (optional)"
                  style={{ width: '100%', borderRadius: 10, border: '1px solid #ddd', padding: 12, fontSize: 14, resize: 'vertical', minHeight: 80, fontFamily: 'inherit' }} />
                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  <button onClick={handleReject} disabled={loading} style={{ flex: 1, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 10, padding: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Confirm Reject</button>
                  <button onClick={() => setShowReject(false)} style={{ background: '#f5f5f5', color: '#666', border: 'none', borderRadius: 10, padding: '12px 18px', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Video Card ────────────────────────────────────────────────────────────────
const btn = (bg, color = '#fff') => ({
  background: bg, color, border: 'none', borderRadius: 8, padding: '8px 16px',
  fontSize: 13, fontWeight: 700, cursor: 'pointer', textDecoration: 'none', display: 'inline-block',
});

function VideoCard({ video, onOpenScript, onRetry, onDelete }) {
  const date = new Date(video.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const active = isActive(video);
  const showProgress = active || (video.stages && ['error', 'rendered'].includes(video.status));
  const ytUrl = video.youtubeUrl || (video.youtubeId ? `https://youtu.be/${video.youtubeId}` : null);
  const [busy, setBusy] = useState(false);

  return (
    <div style={{
      background: '#fff', borderRadius: 14, padding: '20px 22px',
      boxShadow: active ? '0 4px 20px rgba(108,99,255,0.12)' : '0 2px 12px rgba(0,0,0,0.07)',
      border: video.status === 'pending_approval' ? '2px solid #f59e0b' : active ? '1px solid #c7d2fe' : '1px solid #eee',
    }} className="at-pad">
      <h3 style={{ margin: '0 0 8px', fontSize: 16, color: '#1a1a2e', lineHeight: 1.4 }}>{video.title}</h3>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <StatusBadge status={video.status} />
        <span style={{ color: '#aaa', fontSize: 12 }}>{date}</span>
        {video.wordCount && <span style={{ color: '#aaa', fontSize: 12 }}>📝 {video.wordCount} words</span>}
        {video.stats && (
          <span style={{ color: '#aaa', fontSize: 12 }}>
            🎬 {Math.floor(video.stats.durationSec / 60)}:{String(video.stats.durationSec % 60).padStart(2, '0')} · {video.stats.shots} shots · {video.stats.sizeMB} MB
          </span>
        )}
      </div>

      {video.scriptPreview && !active && (
        <p style={{
          margin: '10px 0 0', color: '#666', fontSize: 13, lineHeight: 1.5, display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{video.scriptPreview.replace(/\[[^\]]*\]|#+\s|\*\*/g, ' ').replace(/\s+/g, ' ')}</p>
      )}

      {video.status === 'error' && video.error && (
        <div style={{ marginTop: 12, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
          {video.error}
        </div>
      )}
      {video.note && video.status === 'rendered' && (
        <div style={{ marginTop: 12, background: '#f0fdfa', border: '1px solid #99f6e4', color: '#0f766e', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
          {video.note}
        </div>
      )}

      {showProgress && <ProgressPanel video={video} />}

      <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {video.wordCount > 0 && <button onClick={() => onOpenScript(video.id)} style={btn('#f0efff', '#6c63ff')}>📄 Read Script</button>}
        {video.status === 'pending_approval' && (
          <button onClick={() => onOpenScript(video.id)} style={btn('linear-gradient(135deg, #10b981, #059669)')}>✅ Review & Approve</button>
        )}
        {['error', 'rendered'].includes(video.status) && (
          <button disabled={busy} onClick={async () => { setBusy(true); await onRetry(video.id); setBusy(false); }}
            style={btn('linear-gradient(135deg, #f59e0b, #d97706)')}>
            {busy ? '⏳ Retrying…' : video.status === 'rendered' ? '🔁 Render & upload again' : '🔄 Retry'}
          </button>
        )}
        {ytUrl && <a href={ytUrl} target="_blank" rel="noreferrer" style={btn('#ff0000')}>▶ Watch on YouTube</a>}
        {video.status === 'rendered' && video.runUrl && (
          <a href={video.runUrl} target="_blank" rel="noreferrer" style={btn('#0f766e')}>⬇ Download MP4</a>
        )}
        {['error', 'rejected'].includes(video.status) && (
          <button onClick={() => { if (window.confirm('Delete this video from the dashboard?')) onDelete(video.id); }}
            style={btn('#fff', '#9ca3af')}>🗑 Delete</button>
        )}
      </div>
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending_approval', label: '⏳ Needs Your Review' },
  { key: 'active', label: '⚙️ In Progress' },
  { key: 'uploaded', label: '🎉 Live on YouTube' },
  { key: 'problems', label: '⚠️ Errors & Rejected' },
];

function matches(filter, v) {
  if (filter === 'all') return true;
  if (filter === 'active') return isActive(v);
  if (filter === 'problems') return ['error', 'rejected'].includes(v.status);
  return v.status === filter;
}

export default function App() {
  const [videos, setVideos] = useState([]);
  const [health, setHealth] = useState(null);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [filter, setFilter] = useState('all');
  const [apiError, setApiError] = useState(null);
  const [toast, setToast] = useState(() => (window.location.search.includes('youtube=connected') ? '✅ YouTube channel connected' : null));

  const fetchData = useCallback(async () => {
    try {
      const [videosRes, healthRes] = await Promise.all([fetch(`${API}/videos`), fetch(`${API}/health`)]);
      if (!videosRes.ok) throw new Error(`API ${videosRes.status}`);
      setVideos(await videosRes.json());
      setHealth(await healthRes.json());
      setApiError(null);
    } catch (e) {
      setApiError('Can’t reach the AutoTube server — it may be waking up (free tier takes ~30s).');
    } finally {
      setLoading(false);
    }
  }, []);

  const anyActive = videos.some(isActive);

  // Poll fast while something is running, slowly otherwise
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, anyActive ? 3000 : 30000);
    return () => clearInterval(interval);
  }, [fetchData, anyActive]);

  useEffect(() => {
    if (!toast) return undefined;
    if (window.location.search) window.history.replaceState({}, '', window.location.pathname);
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  async function openScript(id) {
    const res = await fetch(`${API}/videos/${id}`);
    setSelectedVideo(await res.json());
  }

  async function post(path, body) {
    const res = await fetch(`${API}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) setToast(`⚠️ ${json.error || 'Request failed'}`);
    await fetchData();
    return json;
  }

  const approveVideo = (id) => post(`/videos/${id}/approve`);
  const retryVideo = (id) => post(`/videos/${id}/retry`);
  const rejectVideo = (id, reason) => post(`/videos/${id}/reject`, { reason });
  async function deleteVideo(id) {
    await fetch(`${API}/videos/${id}`, { method: 'DELETE' });
    await fetchData();
  }

  async function triggerPipeline() {
    setStarting(true);
    setFilter('all');
    await post('/pipeline/run');
    setStarting(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const pendingCount = videos.filter(v => v.status === 'pending_approval').length;
  const activeCount = videos.filter(isActive).length;
  const filtered = videos.filter(v => matches(filter, v));
  const nextRun = health?.nextGenerateAt
    ? new Date(health.nextGenerateAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';
  const generatingNow = videos.some(v => v.phase === 'generate' && isActive(v));

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fc', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)', color: '#fff', padding: '20px 32px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }} className="at-pad">
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>
            🎬 AutoTube
            {pendingCount > 0 && (
              <span style={{ marginLeft: 10, background: '#f59e0b', color: '#1a1a2e', borderRadius: 20, padding: '2px 10px', fontSize: 14, fontWeight: 700 }}>
                {pendingCount} need review
              </span>
            )}
          </h1>
          <p style={{ margin: '4px 0 0', color: '#8899bb', fontSize: 13 }}>
            {health?.settings?.niche ? health.settings.niche.replace(/\b\w/g, c => c.toUpperCase()) : 'Personal Finance'} · Next video: <strong style={{ color: '#a5b4fc' }}>{nextRun}</strong>
          </p>
        </div>
        <button onClick={triggerPipeline} disabled={starting || generatingNow} style={{
          background: starting || generatingNow ? '#4b5563' : 'linear-gradient(135deg, #6c63ff, #4f46e5)',
          color: '#fff', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 700,
          cursor: starting || generatingNow ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {(starting || generatingNow) && <span className="at-spinner" style={{ borderColor: '#9ca3af', borderTopColor: '#fff' }} />}
          {starting ? 'Starting…' : generatingNow ? 'Generating script…' : '⚡ Generate Now'}
        </button>
      </div>

      {toast && (
        <div style={{ margin: '16px 32px 0', background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: 10, padding: '10px 14px', fontSize: 14 }} className="at-pad">{toast}</div>
      )}
      {apiError && (
        <div style={{ margin: '16px 32px 0', background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 10, padding: '10px 14px', fontSize: 14 }} className="at-pad">{apiError}</div>
      )}

      <div style={{ padding: '16px 32px', display: 'flex', gap: 16, flexWrap: 'wrap' }} className="at-pad">
        {[
          { label: 'Total Videos', value: videos.length, icon: '📹' },
          { label: 'Pending Review', value: pendingCount, icon: '⏳', highlight: pendingCount > 0 },
          { label: 'In Progress', value: activeCount, icon: '⚙️', live: activeCount > 0 },
          { label: 'Live on YouTube', value: videos.filter(v => v.status === 'uploaded').length, icon: '🎉' },
        ].map(stat => (
          <div key={stat.label} style={{
            background: '#fff', borderRadius: 12, padding: '14px 20px', minWidth: 130, flex: '1 1 130px', maxWidth: 200,
            border: stat.highlight ? '2px solid #f59e0b' : stat.live ? '2px solid #a5b4fc' : '1px solid #eee',
            boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
          }}>
            <div style={{ fontSize: 22 }}>{stat.icon}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: stat.highlight ? '#d97706' : stat.live ? '#4f46e5' : '#1a1a2e' }}>{stat.value}</div>
            <div style={{ fontSize: 12, color: '#888' }}>{stat.label}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: '0 32px 16px', display: 'flex', gap: 8, flexWrap: 'wrap' }} className="at-pad">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} style={{
            background: filter === f.key ? '#6c63ff' : '#fff', color: filter === f.key ? '#fff' : '#666',
            border: '1px solid ' + (filter === f.key ? '#6c63ff' : '#ddd'), borderRadius: 20,
            padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>{f.label}</button>
        ))}
      </div>

      <div style={{ padding: '0 32px 40px', display: 'grid', gap: 14 }} className="at-pad">
        {loading && <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>Loading…</div>}
        {!loading && filtered.length === 0 && (
          <div style={{ background: '#fff', borderRadius: 14, padding: 40, textAlign: 'center', color: '#888' }}>
            {videos.length === 0
              ? <><div style={{ fontSize: 48 }}>🎬</div><h3 style={{ color: '#1a1a2e' }}>No videos yet</h3><p>Click <strong>⚡ Generate Now</strong> to create your first video.</p></>
              : 'No videos match this filter.'}
          </div>
        )}
        {filtered.map(v => (
          <VideoCard key={v.id} video={v} onOpenScript={openScript} onRetry={retryVideo} onDelete={deleteVideo} />
        ))}
      </div>

      {selectedVideo && (
        <ScriptModal video={selectedVideo} onClose={() => setSelectedVideo(null)} onApprove={approveVideo} onReject={rejectVideo} />
      )}
    </div>
  );
}
