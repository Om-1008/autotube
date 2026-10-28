require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');
const db = require('./db');
const jobstate = require('./jobstate');
const yt = require('./youtube');

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://autotube-zeta.vercel.app';
const GH_REPO = process.env.GH_REPO || 'Om-1008/autotube';
const GH_REF = process.env.GH_REF || 'main';

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Email helper ────────────────────────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !to) return;
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    await transporter.sendMail({ from: process.env.EMAIL_USER, to, subject, html });
    console.log('[Email] Sent:', subject);
  } catch (e) {
    console.error('[Email] Failed:', e.message);
  }
}

// ─── Claude helpers ──────────────────────────────────────────────────────────
function parseJSON(raw) {
  const t = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}

async function researchTopic(niche, audience, pastTitles = []) {
  const pastList = pastTitles.length
    ? `\nAlready covered (avoid repeating):\n${pastTitles.slice(0, 30).join('\n')}`
    : '';
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `You are a YouTube channel strategist specialising in ${niche} for a ${audience} audience.

Pick ONE specific, highly searchable video topic right now. It must be:
- Trending or evergreen (high search volume)
- Actionable and beginner-friendly
- Between 8-12 minutes runtime
- Not just a list (no generic "10 tips" — be specific)
${pastList}

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "title": "YouTube video title (under 70 chars, includes year 2026)",
  "hook": "First 30 seconds hook sentence — the problem the viewer has",
  "searchKeywords": ["keyword1", "keyword2", "keyword3"],
  "whyNow": "One sentence why this topic is relevant right now",
  "affiliateAngle": "Which affiliate product fits (e.g. Groww for stock investing topics)"
}`,
    }],
  });
  return parseJSON(msg.content[0].text);
}

async function writeScript(topic, niche, audience) {
  const scriptMsg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `You are a professional YouTube scriptwriter for a ${niche} channel targeting ${audience} viewers.

Write a complete, engaging voiceover script for this video:
Title: ${topic.title}
Hook concept: ${topic.hook}
Affiliate angle: ${topic.affiliateAngle}

Requirements:
- 1150-1350 words of narration (8-10 minutes at 135 words/minute)
- Conversational, no jargon, like explaining to a friend; short punchy sentences
- Structure: Hook → Problem → 3-5 concrete steps → natural affiliate mention → call to action
- Begin each step/section with an on-screen heading line in this exact form: "## Step N: <short step title>" (max 5 words after the colon, specific to this video). Don't add a heading for the hook.
- Before every 2-4 sentences of narration, add a footage cue in this exact form: [B-ROLL: concrete visual description] (e.g. [B-ROLL: woman checking banking app on phone])
- Write numbers the way they should be spoken on screen ($1,000, 50%)
- No title line, no timestamps, no speaker labels, no stage directions other than [B-ROLL: ...]
- End with a strong subscribe/comment call to action

Output ONLY the script.`,
    }],
  });
  const scriptText = scriptMsg.content[0].text.trim();
  return { scriptText, wordCount: scriptText.replace(/\[[^\]]*\]/g, '').split(/\s+/).filter(Boolean).length };
}

async function writeMetadata(topic, niche, audience) {
  const metaMsg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 700,
    messages: [{
      role: 'user',
      content: `For a YouTube video titled: "${topic.title}"
About: ${niche} for ${audience} audience.

Respond with ONLY valid JSON (no markdown):
{
  "duration": "9 minutes",
  "thumbnailIdeas": ["idea 1", "idea 2", "idea 3"],
  "description": "YouTube description under 150 words with keywords",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8"]
}`,
    }],
  });
  try { return parseJSON(metaMsg.content[0].text); }
  catch { return { duration: '9 minutes', thumbnailIdeas: [], description: topic.title, tags: [niche] }; }
}

function sectionsFromScript(scriptText) {
  return (scriptText.match(/^#{1,6}\s+.+$/gm) || []).map(h => ({ name: h.replace(/^#+\s+/, '').trim() }));
}

// ─── Phase 1: generate topic + script (runs on this server) ──────────────────
async function runPipeline(existingJobId = null) {
  const data = db.get();
  const { niche, audience } = data.settings;
  const jobId = existingJobId || uuidv4();

  if (!existingJobId) {
    await db.update(d => {
      d.videos.unshift({
        id: jobId,
        status: 'generating',
        createdAt: new Date().toISOString(),
        title: 'New video — researching topic…',
        topic: null,
        script: null,
      });
      d.nextGenerateAt = getNextRunTime(d.settings.frequencyDays);
    });
  } else {
    await db.update(d => {
      const v = d.videos.find(x => x.id === jobId);
      if (v) { v.status = 'generating'; v.error = null; }
    });
  }

  const r = jobstate.createReporter(jobId, 'generate');
  (async () => {
    try {
      await r.stage('researching', `Finding a fresh ${niche} topic`);
      const pastTitles = data.videos.filter(v => v.id !== jobId && v.topic).map(v => v.title);
      const topic = await researchTopic(niche, audience, pastTitles);
      r.log(`Topic: “${topic.title}”`);
      await db.update(d => { const v = d.videos.find(x => x.id === jobId); if (v) { v.title = topic.title; v.topic = topic; } });

      await r.stage('writing', 'Claude is drafting ~1,300 words');
      const { scriptText, wordCount } = await writeScript(topic, niche, audience);
      r.log(`Script written: ${wordCount.toLocaleString()} words (~${Math.round(wordCount / 135)} min)`);

      await r.stage('finalizing', 'Description, tags and thumbnail ideas');
      const meta = await writeMetadata(topic, niche, audience);

      await db.update(d => {
        const v = d.videos.find(x => x.id === jobId);
        if (!v) return;
        v.status = 'pending_approval';
        v.script = {
          title: topic.title, duration: meta.duration, wordCount, script: scriptText,
          sections: sectionsFromScript(scriptText),
          thumbnailIdeas: meta.thumbnailIdeas, description: meta.description, tags: meta.tags,
        };
      });
      await r.done('pending_approval');
      r.log('Ready for your review');

      await sendEmail({
        to: process.env.NOTIFY_EMAIL,
        subject: `✅ New video ready for your approval: "${topic.title}"`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:auto">
          <h2>🎬 AutoTube — Video Ready for Review</h2>
          <p><strong>${topic.title}</strong> · ${wordCount} words</p>
          <p><a href="${DASHBOARD_URL}" style="background:#6c63ff;color:white;padding:12px 24px;border-radius:8px;text-decoration:none">Review &amp; approve</a></p>
        </div>`,
      });
    } catch (err) {
      console.error('[Pipeline] ❌', err.message);
      await r.fail(err);
      await db.update(d => { const v = d.videos.find(x => x.id === jobId); if (v) { v.status = 'error'; v.error = err.message; } });
    }
  })();

  return jobId;
}

function getNextRunTime(frequencyDays) {
  const next = new Date();
  next.setDate(next.getDate() + frequencyDays);
  next.setHours(18, 0, 0, 0);
  return next.toISOString();
}

// ─── Phase 2: render + upload (GitHub Actions, or in-process fallback) ───────
async function dispatchGitHub(jobId) {
  const res = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/render.yml/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GH_DISPATCH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: GH_REF, inputs: { job_id: jobId } }),
  });
  if (res.status !== 204) {
    const body = await res.text();
    throw new Error(`GitHub dispatch failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

async function startRender(jobId) {
  const r = jobstate.createReporter(jobId, 'render');
  await db.update(d => {
    const v = d.videos.find(x => x.id === jobId);
    if (v) { v.status = 'approved'; v.approvedAt = new Date().toISOString(); v.error = null; }
  });

  if (process.env.GH_DISPATCH_TOKEN) {
    await r.stage('queued', 'Requesting a GitHub Actions render server');
    try {
      await dispatchGitHub(jobId);
      r.log('Render server requested — it usually starts within 30 seconds');
    } catch (e) {
      await r.fail(e);
    }
    return;
  }

  // No GitHub token on a hosted server: don't try (free-tier instances can't render video)
  if (process.env.RENDER && !process.env.ALLOW_LOCAL_RENDER) {
    await r.fail(new Error('Render server not configured: add GH_DISPATCH_TOKEN to the Render environment, then click Retry.'));
    return;
  }

  // Local dev: render in-process
  await r.stage('queued', 'Rendering on this server (GH_DISPATCH_TOKEN not set)');
  const { processJob } = require('./render');
  const job = { ...db.get().videos.find(v => v.id === jobId), settings: db.get().settings };
  const workDir = path.join(__dirname, 'work', jobId);
  processJob(job, r, { workDir }).catch(e => r.fail(e));
}

// ─── Merge live job state over stored records ────────────────────────────────
const TERMINAL = new Set(['pending_approval', 'uploaded', 'rendered', 'rejected', 'error']);
const LEGACY_ACTIVE = new Set(['generating', 'approved', 'voiceover', 'rendering', 'uploading']);

function merge(video, st, { fullLog = false } = {}) {
  const out = { ...video };
  if (st) {
    const stale = !TERMINAL.has(st.status) &&
      Date.now() - new Date(st.updatedAt).getTime() > (st.phase === 'generate' ? 10 : (st.status === 'queued' ? 15 : 45)) * 60000;
    Object.assign(out, {
      phase: st.phase,
      status: stale ? 'error' : st.status,
      stages: st.stages,
      percent: st.percent,
      log: fullLog ? st.log : (st.log || []).slice(-8),
      error: stale ? 'Stopped responding (server restarted or timed out). Click Retry.' : (st.error || video.error),
      runUrl: st.runUrl || null,
      note: st.note || null,
      stats: st.stats || video.stats,
      youtubeId: st.youtubeId || video.youtubeId,
      youtubeUrl: st.youtubeUrl || video.youtubeUrl,
      uploadedAt: st.uploadedAt || video.uploadedAt,
      startedAt: st.startedAt,
      updatedAt: st.updatedAt,
    });
  } else if (LEGACY_ACTIVE.has(video.status) && !video.youtubeId) {
    out.status = 'error';
    out.error = 'This job was interrupted by an older version of the app. Click Retry.';
  }
  return out;
}

async function mergedVideos(opts) {
  const videos = db.get().videos;
  let states = [];
  try { states = await jobstate.readMany(videos.map(v => v.id)); }
  catch (e) { console.error('[JobState] read failed:', e.message); }
  return videos.map((v, i) => merge(v, states[i], opts));
}

// ─── API Routes ───────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const data = db.get();
  res.json({
    status: 'ok',
    videoCount: data.videos.length,
    nextGenerateAt: data.nextGenerateAt,
    settings: data.settings,
    renderer: process.env.GH_DISPATCH_TOKEN ? 'github-actions' : 'local',
  });
});

app.get('/videos', async (req, res) => {
  const list = (await mergedVideos()).map(({ script, ...rest }) => ({
    ...rest,
    scriptPreview: script?.script ? script.script.slice(0, 300) + '…' : null,
    wordCount: script?.wordCount,
    thumbnailIdeas: script?.thumbnailIdeas,
  }));
  res.json(list);
});

app.get('/videos/:id', async (req, res) => {
  const video = db.get().videos.find(v => v.id === req.params.id);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  let st = null;
  try { st = await jobstate.read(video.id); } catch {}
  res.json(merge(video, st, { fullLog: true }));
});

app.post('/videos/:id/approve', async (req, res) => {
  const video = (await mergedVideos()).find(v => v.id === req.params.id);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  if (!['pending_approval', 'error', 'rendered'].includes(video.status)) {
    return res.status(400).json({ error: `Cannot approve video in status: ${video.status}` });
  }
  if (!video.script?.script) return res.status(400).json({ error: 'This job has no script yet — use Retry' });
  await startRender(video.id);
  res.json({ success: true, status: 'queued' });
});

// Retry: regenerate the script if it never got one, otherwise re-render
app.post('/videos/:id/retry', async (req, res) => {
  const video = db.get().videos.find(v => v.id === req.params.id);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  if (!video.script?.script) {
    await runPipeline(video.id);
    return res.json({ success: true, phase: 'generate' });
  }
  await startRender(video.id);
  res.json({ success: true, phase: 'render' });
});

app.post('/videos/:id/reject', async (req, res) => {
  const { reason } = req.body || {};
  await db.update(d => {
    const v = d.videos.find(x => x.id === req.params.id);
    if (v) { v.status = 'rejected'; v.rejectedReason = reason || ''; }
  });
  try { await jobstate.remove(req.params.id); } catch {}
  res.json({ success: true, status: 'rejected' });
});

app.delete('/videos/:id', async (req, res) => {
  await db.update(d => { d.videos = d.videos.filter(v => v.id !== req.params.id); });
  try { await jobstate.remove(req.params.id); } catch {}
  res.json({ success: true });
});

app.post('/pipeline/run', async (req, res) => {
  const jobId = await runPipeline();
  res.json({ success: true, jobId });
});

// ─── YouTube OAuth routes ────────────────────────────────────────────────────
app.get('/auth/youtube', (req, res) => {
  if (!process.env.YOUTUBE_CLIENT_ID) return res.status(400).send('YouTube credentials not configured');
  res.redirect(yt.getAuthUrl());
});

app.get('/auth/youtube/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code received from Google');
  try {
    await yt.exchangeCodeForTokens(code);
    res.redirect(DASHBOARD_URL + '?youtube=connected');
  } catch (e) {
    res.status(500).send('OAuth error: ' + e.message);
  }
});

app.get('/auth/youtube/revoke', async (req, res) => {
  try {
    await yt.clearTokens();
    res.send('YouTube tokens cleared. <a href="/auth/youtube">Click here to re-authorize</a>');
  } catch (e) {
    res.status(500).send('Error clearing tokens: ' + e.message);
  }
});

app.get('/auth/youtube/status', async (req, res) => {
  if (!(await yt.isYouTubeConnected())) return res.json({ connected: false });
  try { res.json({ connected: true, channel: await yt.getChannelInfo() }); }
  catch (e) { res.json({ connected: true, channel: null, error: e.message }); }
});

app.get('/channel/stats', async (req, res) => {
  try {
    if (!(await yt.isYouTubeConnected())) return res.json({ connected: false });
    res.json({ connected: true, ...(await yt.getChannelInfo()) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/settings', (req, res) => res.json(db.get().settings));

app.patch('/settings', async (req, res) => {
  await db.update(d => { Object.assign(d.settings, req.body); });
  res.json(db.get().settings);
});

// ─── Cron scheduler ──────────────────────────────────────────────────────────
cron.schedule('0 6 * * *', async () => {
  const data = db.get();
  if (!data.settings.isRunning) return console.log('[Cron] Scheduler paused — skipping');
  const nextRun = data.nextGenerateAt ? new Date(data.nextGenerateAt) : null;
  if (!nextRun || new Date() >= nextRun) {
    console.log('[Cron] Time to generate a new video!');
    await runPipeline();
  }
});

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 AutoTube backend running on port ${PORT}`);
    console.log(`   Renderer: ${process.env.GH_DISPATCH_TOKEN ? `GitHub Actions (${GH_REPO})` : 'in-process (set GH_DISPATCH_TOKEN to use GitHub Actions)'}`);
    if (!db.get().nextGenerateAt) {
      db.update(d => { d.nextGenerateAt = getNextRunTime(d.settings.frequencyDays); });
    }
  });
});
