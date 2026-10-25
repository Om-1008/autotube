import React, { useState, useEffect } from 'react';
import './App.css';

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000';

// ─── Status badge ─────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  pending_approval: { label: '⏳ Needs Your Review', color: '#f59e0b', bg: '#fffbeb' },
  approved:         { label: '✅ Approved',           color: '#10b981', bg: '#ecfdf5' },
  voiceover:        { label: '🎙️ Making Voiceover',  color: '#6c63ff', bg: '#f0efff' },
  rendering:        { label: '🎬 Rendering Video',   color: '#3b82f6', bg: '#eff6ff' },
  uploading:        { label: '📤 Uploading',          color: '#8b5cf6', bg: '#f5f3ff' },
  uploaded:         { label: '🎉 Live on YouTube',   color: '#059669', bg: '#d1fae5' },
  rejected:         { label: '❌ Rejected',           color: '#ef4444', bg: '#fef2f2' },
  error:            { label: '⚠️ Error',              color: '#dc2626', bg: '#fef2f2' },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { label: status, color: '#6b7280', bg: '#f9fafb' };
  return (
    <span style={{
      background: cfg.bg, color: cfg.color,
      padding: '4px 12px', borderRadius: 20,
      fontSize: 13, fontWeight: 600,
      border: `1px solid ${cfg.color}33`,
    }}>{cfg.label}</span>
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
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 800,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 25px 60px rgba(0,0,0,0.3)',
      }}>
        {/* Header */}
        <div style={{ padding: '24px 28px 16px', borderBottom: '1px solid #eee', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 20, color: '#1a1a2e' }}>{video.title}</h2>
              <div style={{ marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <StatusBadge status={video.status} />
                <span style={{ color: '#888', fontSize: 13 }}>
                  📝 {video.wordCount || video.script?.wordCount || '?'} words
                  · ⏱ {video.script?.duration || '~9 min'}
                </span>
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'none', border: 'none', fontSize: 24, cursor: 'pointer',
              color: '#888', lineHeight: 1, padding: '0 4px',
            }}>×</button>
          </div>
        </div>

        {/* Section tabs */}
        {sections.length > 0 && (
          <div style={{ padding: '12px 28px 0', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 12 }}>
              {sections.map(s => (
                <span key={s.name} style={{
                  background: '#f5f5ff', color: '#6c63ff',
                  padding: '4px 12px', borderRadius: 20, fontSize: 12,
                  fontWeight: 600, whiteSpace: 'nowrap',
                }}>{s.name}</span>
              ))}
            </div>
          </div>
        )}

        {/* Script body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
          <div style={{ fontFamily: 'Georgia, serif', lineHeight: 1.9, fontSize: 15, color: '#2d2d2d' }}>
            {script.split('\n').map((line, i) => {
              if (line.startsWith('[B-ROLL:')) {
                return (
                  <div key={i} style={{
                    background: '#f0f9ff', border: '1px solid #bae6fd',
                    borderRadius: 8, padding: '8px 14px', margin: '10px 0',
                    color: '#0369a1', fontSize: 13, fontStyle: 'italic',
                  }}>🎥 {line}</div>
                );
              }
              if (line === '[PAUSE]') {
                return <div key={i} style={{ textAlign: 'center', color: '#d1d5db', fontSize: 12, margin: '4px 0' }}>— pause —</div>;
              }
              return <p key={i} style={{ margin: '0 0 8px' }}>{line}</p>;
            })}
          </div>

          {/* Thumbnail ideas */}
          {video.thumbnailIdeas?.length > 0 && (
            <div style={{ marginTop: 24, padding: 16, background: '#fffbeb', borderRadius: 10 }}>
              <strong style={{ fontSize: 13, color: '#92400e' }}>💡 Thumbnail Ideas</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: '#78350f', fontSize: 13 }}>
                {video.thumbnailIdeas.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}
        </div>

        {/* Approve / Reject buttons */}
        {(video.status === 'pending_approval' || video.status === 'error') && (
          <div style={{ padding: '16px 28px 24px', borderTop: '1px solid #eee', flexShrink: 0 }}>
            {!showReject ? (
              <div style={{ display: 'flex', gap: 12 }}>
                <button onClick={handleApprove} disabled={loading} style={{
                  flex: 1, background: 'linear-gradient(135deg, #10b981, #059669)',
                  color: '#fff', border: 'none', borderRadius: 12,
                  padding: '14px 24px', fontSize: 16, fontWeight: 700,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                }}>
                  {loading ? '⏳ Processing...' : '✅ Approve & Generate Video'}
                </button>
                <button onClick={() => setShowReject(true)} style={{
                  background: '#fff', color: '#ef4444',
                  border: '2px solid #ef4444', borderRadius: 12,
                  padding: '14px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}>
                  ❌ Reject
                </button>
              </div>
            ) : (
              <div>
                <textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="Why are you rejecting? (optional — helps Claude improve)"
                  style={{
                    width: '100%', borderRadius: 10, border: '1px solid #ddd',
                    padding: 12, fontSize: 14, resize: 'vertical', minHeight: 80,
                    boxSizing: 'border-box', fontFamily: 'inherit',
                  }}
                />
                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  <button onClick={handleReject} disabled={loading} style={{
                    flex: 1, background: '#ef4444', color: '#fff',
                    border: 'none', borderRadius: 10, padding: '12px',
                    fontSize: 15, fontWeight: 700, cursor: 'pointer',
                  }}>Confirm Reject</button>
                  <button onClick={() => setShowReject(false)} style={{
                    background: '#f5f5f5', color: '#666',
                    border: 'none', borderRadius: 10, padding: '12px 18px',
                    fontSize: 14, cursor: 'pointer',
                  }}>Cancel</button>
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
function VideoCard({ video, onOpenScript, onQuickApprove }) {
  const date = new Date(video.createdAt).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  return (
    <div style={{
      background: '#fff', borderRadius: 14, padding: '20px 22px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
      border: video.status === 'pending_approval' ? '2px solid #f59e0b' : '1px solid #eee',
      transition: 'box-shadow 0.2s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 16, color: '#1a1a2e', lineHeight: 1.4 }}>
            {video.title}
          </h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusBadge status={video.status} />
            <span style={{ color: '#aaa', fontSize: 12 }}>{date}</span>
            {video.wordCount && (
              <span style={{ color: '#aaa', fontSize: 12 }}>📝 {video.wordCount} words</span>
            )}
          </div>
          {video.scriptPreview && (
            <p style={{
              margin: '10px 0 0', color: '#666', fontSize: 13,
              lineHeight: 1.5, display: '-webkit-box',
              WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>{video.scriptPreview}</p>
          )}
        </div>
      </div>

      <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
        <button onClick={() => onOpenScript(video.id)} style={{
          background: '#f0efff', color: '#6c63ff', border: 'none',
          borderRadius: 8, padding: '8px 16px', fontSize: 13,
          fontWeight: 600, cursor: 'pointer',
        }}>📄 Read Script</button>

        {(video.status === 'pending_approval' || video.status === 'error') && (
          <button onClick={() => onOpenScript(video.id)} style={{
            background: video.status === 'error' ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'linear-gradient(135deg, #10b981, #059669)',
            color: '#fff', border: 'none', borderRadius: 8,
            padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>{video.status === 'error' ? '🔄 Retry' : '✅ Review & Approve'}</button>
        )}

        {video.status === 'uploaded' && video.youtubeId && (
          <a href={`https://youtu.be/${video.youtubeId}`} target="_blank" rel="noreferrer" style={{
            background: '#ff0000', color: '#fff', border: 'none',
            borderRadius: 8, padding: '8px 16px', fontSize: 13,
            fontWeight: 600, textDecoration: 'none',
          }}>▶ Watch on YouTube</a>
        )}
      </div>
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [videos, setVideos] = useState([]);
  const [health, setHealth] = useState(null);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState('all');

  async function fetchData() {
    try {
      const [videosRes, healthRes] = await Promise.all([
        fetch(`${API}/videos`),
        fetch(`${API}/health`),
      ]);
      setVideos(await videosRes.json());
      setHealth(await healthRes.json());
    } catch (e) {
      console.error('API error:', e);
    } finally {
      setLoading(false);
    }
  }

  async function openScript(id) {
    const res = await fetch(`${API}/videos/${id}`);
    const video = await res.json();
    setSelectedVideo(video);
  }

  async function approveVideo(id) {
    await fetch(`${API}/videos/${id}/approve`, { method: 'POST' });
    await fetchData();
  }

  async function rejectVideo(id, reason) {
    await fetch(`${API}/videos/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    await fetchData();
  }

  async function triggerPipeline() {
    setRunning(true);
    await fetch(`${API}/pipeline/run`, { method: 'POST' });
    setTimeout(() => { fetchData(); setRunning(false); }, 5000);
  }

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);  // auto-refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const pendingCount = videos.filter(v => v.status === 'pending_approval').length;
  const filtered = filter === 'all' ? videos : videos.filter(v => v.status === filter);

  const nextRun = health?.nextGenerateAt
    ? new Date(health.nextGenerateAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fc', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        color: '#fff', padding: '20px 32px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>
            🎬 AutoTube
            {pendingCount > 0 && (
              <span style={{
                marginLeft: 10, background: '#f59e0b', color: '#1a1a2e',
                borderRadius: 20, padding: '2px 10px', fontSize: 14, fontWeight: 700,
              }}>{pendingCount} need review</span>
            )}
          </h1>
          <p style={{ margin: '4px 0 0', color: '#8899bb', fontSize: 13 }}>
            Personal Finance · Global English ·
            Next video: <strong style={{ color: '#a5b4fc' }}>{nextRun}</strong>
          </p>
        </div>
        <button onClick={triggerPipeline} disabled={running} style={{
          background: running ? '#555' : 'linear-gradient(135deg, #6c63ff, #4f46e5)',
          color: '#fff', border: 'none', borderRadius: 10,
          padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: running ? 'wait' : 'pointer',
        }}>
          {running ? '⏳ Generating...' : '⚡ Generate Now'}
        </button>
      </div>

      {/* Stats row */}
      <div style={{ padding: '16px 32px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Videos', value: videos.length, icon: '📹' },
          { label: 'Pending Review', value: pendingCount, icon: '⏳', highlight: pendingCount > 0 },
          { label: 'Live on YouTube', value: videos.filter(v => v.status === 'uploaded').length, icon: '🎉' },
          { label: 'Approved', value: videos.filter(v => ['approved','voiceover','rendering','uploading'].includes(v.status)).length, icon: '✅' },
        ].map(stat => (
          <div key={stat.label} style={{
            background: '#fff', borderRadius: 12,
            padding: '14px 20px', minWidth: 130,
            border: stat.highlight ? '2px solid #f59e0b' : '1px solid #eee',
            boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
          }}>
            <div style={{ fontSize: 22 }}>{stat.icon}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: stat.highlight ? '#d97706' : '#1a1a2e' }}>{stat.value}</div>
            <div style={{ fontSize: 12, color: '#888' }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ padding: '0 32px 16px', display: 'flex', gap: 8 }}>
        {['all', 'pending_approval', 'approved', 'uploaded', 'rejected'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            background: filter === f ? '#6c63ff' : '#fff',
            color: filter === f ? '#fff' : '#666',
            border: '1px solid ' + (filter === f ? '#6c63ff' : '#ddd'),
            borderRadius: 20, padding: '6px 16px', fontSize: 12,
            fontWeight: 600, cursor: 'pointer',
          }}>
            {f === 'all' ? 'All' : (STATUS_CONFIG[f]?.label || f)}
          </button>
        ))}
      </div>

      {/* Video list */}
      <div style={{ padding: '0 32px 40px', display: 'grid', gap: 14 }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>
            Loading...
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{
            background: '#fff', borderRadius: 14, padding: 40,
            textAlign: 'center', color: '#888',
          }}>
            {videos.length === 0
              ? <>
                  <div style={{ fontSize: 48 }}>🎬</div>
                  <h3 style={{ color: '#1a1a2e' }}>No videos yet</h3>
                  <p>Click <strong>⚡ Generate Now</strong> to create your first video script!</p>
                </>
              : 'No videos match this filter.'
            }
          </div>
        )}
        {filtered.map(v => (
          <VideoCard
            key={v.id}
            video={v}
            onOpenScript={openScript}
            onQuickApprove={approveVideo}
          />
        ))}
      </div>

      {/* Script modal */}
      {selectedVideo && (
        <ScriptModal
          video={selectedVideo}
          onClose={() => setSelectedVideo(null)}
          onApprove={approveVideo}
          onReject={rejectVideo}
        />
      )}
    </div>
  );
}
