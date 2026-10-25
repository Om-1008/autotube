require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');
const db = require('./db');
const { generateVoiceover, getVoices, checkCredits } = require('./voiceover');
const { renderVideo } = require('./video');
const {
  getAuthUrl, exchangeCodeForTokens,
  uploadToYouTube, isYouTubeConnected, getChannelInfo,
} = require('./youtube');

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Email helper ────────────────────────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  // Using nodemailer with Gmail SMTP (free) – or swap for SendGrid later
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log('[Email] No email creds set — skipping email');
    return;
  }
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  await transporter.sendMail({ from: process.env.EMAIL_USER, to, subject, html });
  console.log('[Email] Sent:', subject);
}

// ─── Claude API helpers ──────────────────────────────────────────────────────
async function researchTopic(niche, audience, pastTitles = []) {
  console.log('[Claude] Researching topic...');
  const pastList = pastTitles.length
    ? `\nAlready covered (avoid repeating):\n${pastTitles.slice(-20).join('\n')}`
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

  const raw = msg.content[0].text.trim();
  const cleaned = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(cleaned);
}

async function generateScript(topic, niche, audience) {
  console.log('[Claude] Generating script for:', topic.title);

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `You are a professional YouTube scriptwriter for a ${niche} channel targeting ${audience} viewers.

Write a complete, engaging script for this video:
Title: ${topic.title}
Hook concept: ${topic.hook}
Affiliate angle: ${topic.affiliateAngle}

Script requirements:
- Total length: 8-10 minutes when read at 130 words/minute (~1040-1300 words)
- Conversational tone, no jargon, teach like explaining to a friend
- Structure: Hook (30s) → Problem (1min) → Main content (6-7min) → Affiliate mention (natural, 45s) → Call to action (30s)
- Include [PAUSE] markers where voiceover should pause for effect
- Include [B-ROLL: description] markers for the video editor to insert footage
- End with a strong subscribe/comment CTA

Respond with valid JSON only:
{
  "title": "${topic.title}",
  "duration": "estimated X minutes",
  "wordCount": 0,
  "script": "Full script text here with [PAUSE] and [B-ROLL: ...] markers",
  "sections": [
    {"name": "Hook", "startWord": 0, "endWord": 65},
    {"name": "Problem Setup", "startWord": 65, "endWord": 195},
    {"name": "Main Content", "startWord": 195, "endWord": 1100},
    {"name": "Affiliate", "startWord": 1100, "endWord": 1200},
    {"name": "CTA", "startWord": 1200, "endWord": 1300}
  ],
  "thumbnailIdeas": ["idea 1", "idea 2", "idea 3"],
  "description": "YouTube video description (under 200 words, includes keywords)",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}`,
    }],
  });

  const raw = msg.content[0].text.trim();
  // Strip markdown code fences if Claude adds them
  const cleaned = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
  const result = JSON.parse(cleaned);
  result.wordCount = result.script.split(' ').length;
  return result;
}

// ─── Core pipeline ────────────────────────────────────────────────────────────
async function runPipeline() {
  console.log('\n[Pipeline] Starting video generation pipeline...');
  const data = db.get();
  const { niche, audience } = data.settings;

  const pastTitles = data.videos.map(v => v.title).filter(Boolean);

  let jobId;
  try {
    // 1. Research topic
    const topic = await researchTopic(niche, audience, pastTitles);
    console.log('[Pipeline] Topic selected:', topic.title);

    // 2. Generate script
    const scriptData = await generateScript(topic, niche, audience);
    console.log('[Pipeline] Script generated:', scriptData.wordCount, 'words');

    // 3. Save video job to DB
    jobId = uuidv4();
    const job = {
      id: jobId,
      status: 'pending_approval',   // → approved → voiceover → video → uploaded
      createdAt: new Date().toISOString(),
      title: scriptData.title,
      topic,
      script: scriptData,
      voiceoverUrl: null,
      videoUrl: null,
      youtubeId: null,
      approvedAt: null,
      uploadedAt: null,
    };

    db.update(d => {
      d.videos.unshift(job);
      d.nextGenerateAt = getNextRunTime(d.settings.frequencyDays);
    });

    console.log('[Pipeline] Job saved:', jobId);

    // 4. Send email notification
    const dashboardUrl = process.env.DASHBOARD_URL || `http://localhost:3000`;
    await sendEmail({
      to: process.env.NOTIFY_EMAIL,
      subject: `✅ New video ready for your approval: "${scriptData.title}"`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:auto">
          <h2 style="color:#1a1a2e">🎬 AutoTube — Video Ready for Review</h2>
          <p>Your new video script is ready! It took about 3 minutes to research and write.</p>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px;font-weight:bold">Title</td><td style="padding:8px">${scriptData.title}</td></tr>
            <tr style="background:#f5f5f5"><td style="padding:8px;font-weight:bold">Duration</td><td style="padding:8px">${scriptData.duration}</td></tr>
            <tr><td style="padding:8px;font-weight:bold">Words</td><td style="padding:8px">${scriptData.wordCount}</td></tr>
            <tr style="background:#f5f5f5"><td style="padding:8px;font-weight:bold">Affiliate angle</td><td style="padding:8px">${topic.affiliateAngle}</td></tr>
          </table>
          <p style="margin-top:24px">
            <a href="${dashboardUrl}/review/${jobId}"
               style="background:#6c63ff;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold">
              👀 Review &amp; Approve (takes ~10 min)
            </a>
          </p>
          <p style="color:#888;font-size:13px;margin-top:24px">
            You can also open the dashboard at <a href="${dashboardUrl}">${dashboardUrl}</a>
          </p>
        </div>
      `,
    });

    console.log('[Pipeline] ✅ Done. Job ID:', jobId, '| Status: pending_approval');
    return { success: true, jobId, title: scriptData.title };

  } catch (err) {
    console.error('[Pipeline] ❌ Error:', err.message);
    if (jobId) {
      db.update(d => {
        const job = d.videos.find(v => v.id === jobId);
        if (job) { job.status = 'error'; job.error = err.message; }
      });
    }
    return { success: false, error: err.message };
  }
}

function getNextRunTime(frequencyDays) {
  const next = new Date();
  next.setDate(next.getDate() + frequencyDays);
  next.setHours(18, 0, 0, 0);  // 6 PM
  return next.toISOString();
}

// ─── API Routes ───────────────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  const data = db.get();
  res.json({
    status: 'ok',
    videoCount: data.videos.length,
    nextGenerateAt: data.nextGenerateAt,
    settings: data.settings,
  });
});

// Get all videos (dashboard list)
app.get('/videos', (req, res) => {
  const data = db.get();
  // Don't send full script text in list view — just metadata
  const list = data.videos.map(({ script, ...rest }) => ({
    ...rest,
    scriptPreview: script?.script?.slice(0, 300) + '...',
    wordCount: script?.wordCount,
    thumbnailIdeas: script?.thumbnailIdeas,
  }));
  res.json(list);
});

// Get single video with full script
app.get('/videos/:id', (req, res) => {
  const data = db.get();
  const video = data.videos.find(v => v.id === req.params.id);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  res.json(video);
});

// Approve a video → triggers voiceover generation (Session 2 will fill this)
app.post('/videos/:id/approve', async (req, res) => {
  const data = db.get();
  const video = data.videos.find(v => v.id === req.params.id);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  if (!['pending_approval', 'error'].includes(video.status)) {
    return res.status(400).json({ error: `Cannot approve video in status: ${video.status}` });
  }

  db.update(d => {
    const v = d.videos.find(x => x.id === req.params.id);
    v.status = 'approved';
    v.approvedAt = new Date().toISOString();
  });

  console.log('[Approve] Video approved:', req.params.id, '| Triggering voiceover...');
  res.json({ success: true, status: 'approved', message: 'Approved! Voiceover is generating now — takes 2-3 minutes.' });

  // Trigger voiceover generation in background (non-blocking)
  setImmediate(async () => {
    try {
      db.update(d => {
        const v = d.videos.find(x => x.id === req.params.id);
        if (v) v.status = 'voiceover';
      });

      const videoData = db.get().videos.find(v => v.id === req.params.id);
      const scriptText = videoData.script?.script;

      if (!scriptText) throw new Error('No script found on video job');

      const result = await generateVoiceover(req.params.id, scriptText);

      db.update(d => {
        const v = d.videos.find(x => x.id === req.params.id);
        if (v) {
          v.status = 'rendering';   // → Session 3 picks up here
          v.voiceoverPath = result.path;
          v.voiceoverSizeMB = result.sizeMB;
          v.voiceoverAt = new Date().toISOString();
        }
      });

      console.log('[Voiceover] ✅ Done for job:', req.params.id, '| Triggering Pictory render...');

      // ── Session 3: Trigger Pictory video render ──
      if (!process.env.PICTORY_CLIENT_ID) {
        console.log('[Render] PICTORY keys not set — skipping render (Session 3 pending)');
        return;
      }

      try {
        const freshData = db.get().videos.find(v => v.id === req.params.id);
        const renderResult = await renderVideo(req.params.id, freshData.script, result.path);

        db.update(d => {
          const v = d.videos.find(x => x.id === req.params.id);
          if (v) {
            v.status = 'uploading';   // → Session 4 picks up here
            v.videoPath = renderResult.path;
            v.videoSizeMB = renderResult.sizeMB;
            v.renderedAt = new Date().toISOString();
          }
        });
        console.log('[Render] ✅ Video ready:', req.params.id, '| Triggering YouTube upload...');

        // ── Session 4: Auto-upload to YouTube ──
        if (!isYouTubeConnected() || !process.env.YOUTUBE_CLIENT_ID) {
          console.log('[Upload] YouTube not connected — skipping upload (Session 4 pending)');
          return;
        }

        try {
          const readyData = db.get().videos.find(v => v.id === req.params.id);
          const { videoId, videoUrl } = await uploadToYouTube(
            req.params.id, renderResult.path, readyData.script
          );

          // Send "video is live!" email
          await sendEmail({
            to: process.env.NOTIFY_EMAIL,
            subject: `🎉 Your video is LIVE on YouTube!`,
            html: `
              <div style="font-family:sans-serif;max-width:600px;margin:auto">
                <h2 style="color:#10b981">🎉 Video Published Successfully!</h2>
                <p><strong>${readyData.title}</strong> is now live on YouTube.</p>
                <p>
                  <a href="${videoUrl}" style="background:#ff0000;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">
                    ▶ Watch on YouTube
                  </a>
                </p>
                <p style="color:#888;font-size:13px">
                  Next video will be ready in ${readyData.settings?.frequencyDays || 2} days.<br>
                  Check your dashboard: <a href="${process.env.DASHBOARD_URL}">${process.env.DASHBOARD_URL}</a>
                </p>
              </div>
            `,
          });

          console.log('[Upload] ✅ Video live:', videoUrl);
        } catch (uploadErr) {
          console.error('[Upload] ❌ Error:', uploadErr.message);
          db.update(d => {
            const v = d.videos.find(x => x.id === req.params.id);
            if (v) { v.status = 'error'; v.error = 'Upload failed: ' + uploadErr.message; }
          });
        }

      } catch (renderErr) {
        console.error('[Render] ❌ Error:', renderErr.message);
        db.update(d => {
          const v = d.videos.find(x => x.id === req.params.id);
          if (v) { v.status = 'error'; v.error = 'Render failed: ' + renderErr.message; }
        });
      }

    } catch (err) {
      console.error('[Voiceover] ❌ Error:', err.message);
      db.update(d => {
        const v = d.videos.find(x => x.id === req.params.id);
        if (v) { v.status = 'error'; v.error = 'Voiceover failed: ' + err.message; }
      });
    }
  });
});

// Reject a video
app.post('/videos/:id/reject', (req, res) => {
  const { reason } = req.body;
  db.update(d => {
    const v = d.videos.find(x => x.id === req.params.id);
    if (v) { v.status = 'rejected'; v.rejectedReason = reason || ''; }
  });
  res.json({ success: true, status: 'rejected' });
});

// Manually trigger pipeline (for testing, or if user wants a video now)
app.post('/pipeline/run', async (req, res) => {
  res.json({ message: 'Pipeline started in background. Check /videos in ~60 seconds.' });
  runPipeline();  // async, runs in background
});

// ─── YouTube OAuth routes ────────────────────────────────────────────────────
// Step 1: Redirect user to Google consent screen
app.get('/auth/youtube', (req, res) => {
  if (!process.env.YOUTUBE_CLIENT_ID) {
    return res.status(400).send('YouTube credentials not configured in .env');
  }
  const url = getAuthUrl();
  res.redirect(url);
});

// Step 2: Google redirects back here with ?code=...
app.get('/auth/youtube/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code received from Google');
  try {
    await exchangeCodeForTokens(code);
    // Redirect to dashboard with success message
    res.redirect((process.env.DASHBOARD_URL || 'http://localhost:3000') + '?youtube=connected');
  } catch (e) {
    res.status(500).send('OAuth error: ' + e.message);
  }
});

// YouTube connection status
app.get('/auth/youtube/status', async (req, res) => {
  const connected = isYouTubeConnected();
  if (!connected) return res.json({ connected: false });
  try {
    const channel = await getChannelInfo();
    res.json({ connected: true, channel });
  } catch (e) {
    res.json({ connected: true, channel: null, error: e.message });
  }
});

// ElevenLabs voices list (for settings UI to pick voice)
app.get('/voices', async (req, res) => {
  try {
    const voices = await getVoices();
    res.json(voices);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ElevenLabs credit check
app.get('/credits/elevenlabs', async (req, res) => {
  try {
    const credits = await checkCredits();
    res.json(credits);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// YouTube channel stats (for dashboard header)
app.get('/channel/stats', async (req, res) => {
  try {
    if (!isYouTubeConnected()) return res.json({ connected: false });
    const info = await getChannelInfo();
    res.json({ connected: true, ...info });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get/update settings
app.get('/settings', (req, res) => {
  res.json(db.get().settings);
});

app.patch('/settings', (req, res) => {
  db.update(d => { Object.assign(d.settings, req.body); });
  res.json(db.get().settings);
});

// ─── Cron scheduler ──────────────────────────────────────────────────────────
// Runs every day at 6 AM to check if it's time to generate a new video
cron.schedule('0 6 * * *', async () => {
  const data = db.get();
  if (!data.settings.isRunning) {
    console.log('[Cron] Scheduler paused — skipping');
    return;
  }

  const nextRun = data.nextGenerateAt ? new Date(data.nextGenerateAt) : null;
  const now = new Date();

  if (!nextRun || now >= nextRun) {
    console.log('[Cron] Time to generate a new video!');
    await runPipeline();
  } else {
    const hoursLeft = Math.round((nextRun - now) / 3600000);
    console.log(`[Cron] Next video in ~${hoursLeft}h`);
  }
});

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`\n🚀 AutoTube backend running on port ${PORT}`);
  console.log(`   Health:   http://localhost:${PORT}/health`);
  console.log(`   Videos:   http://localhost:${PORT}/videos`);
  console.log(`   Run now:  POST http://localhost:${PORT}/pipeline/run`);

  // Set next run time on first start if not set
  const data = db.get();
  if (!data.nextGenerateAt) {
    db.update(d => { d.nextGenerateAt = getNextRunTime(d.settings.frequencyDays); });
    console.log(`   First video scheduled for: ${db.get().nextGenerateAt}`);
  }
});
