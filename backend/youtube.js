// Session 4: YouTube Data API v3 — auto-upload rendered videos
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const db = require('./db');

const TOKENS_FILE = path.join(__dirname, 'youtube_tokens.json');

// ─── OAuth2 client setup ──────────────────────────────────────────────────────
function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:4000/auth/youtube/callback'
  );
}

// ─── Save / load tokens from disk ────────────────────────────────────────────
function saveTokens(tokens) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
  console.log('[YouTube] Tokens saved to disk');
}

function loadTokens() {
  if (!fs.existsSync(TOKENS_FILE)) return null;
  return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
}

// ─── Get authenticated YouTube client ────────────────────────────────────────
async function getAuthenticatedClient() {
  const oauth2Client = getOAuthClient();
  const tokens = loadTokens();

  if (!tokens) {
    throw new Error('YouTube not connected. Visit /auth/youtube to connect your channel.');
  }

  oauth2Client.setCredentials(tokens);

  // Auto-refresh if token is expired
  oauth2Client.on('tokens', (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    saveTokens(merged);
    console.log('[YouTube] Token refreshed and saved');
  });

  return oauth2Client;
}

// ─── Generate OAuth URL (user visits this to connect their channel) ───────────
function getAuthUrl() {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',      // gets refresh_token so we never need to re-auth
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube',
    ],
    prompt: 'consent',           // always show consent to ensure refresh_token
  });
}

// ─── Exchange auth code for tokens ───────────────────────────────────────────
async function exchangeCodeForTokens(code) {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  saveTokens(tokens);
  return tokens;
}

// ─── Build category & privacy settings ───────────────────────────────────────
function getVideoMetadata(scriptData) {
  const tags = scriptData.tags || [];
  // Add standard finance channel tags
  const allTags = [
    ...tags,
    'personal finance', 'money', 'investing', 'financial freedom',
    'save money', 'make money', 'finance tips', '2026',
  ].slice(0, 500 / 10);  // YouTube: 500 total chars in tags

  return {
    title: scriptData.title,
    description: [
      scriptData.description || '',
      '',
      '─────────────────────────────────',
      '📌 CHAPTERS',
      ...(scriptData.sections || []).map((s, i) => `${i === 0 ? '0:00' : ''} ${s.name}`),
      '',
      '─────────────────────────────────',
      '⚠️ DISCLOSURE: This video was created with AI assistance.',
      'Information is for educational purposes only. Not financial advice.',
      'Always consult a qualified financial advisor before investing.',
      '',
      '#personalfinance #money #investing #financialfreedom',
    ].join('\n'),
    tags: allTags,
    categoryId: '27',             // "Education" category — highest RPM for finance
    defaultLanguage: 'en',
    defaultAudioLanguage: 'en',
  };
}

// ─── Upload video to YouTube ──────────────────────────────────────────────────
async function uploadToYouTube(jobId, videoPath, scriptData) {
  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
    throw new Error('YouTube OAuth credentials not set in .env');
  }

  const auth = await getAuthenticatedClient();
  const youtube = google.youtube({ version: 'v3', auth });
  const metadata = getVideoMetadata(scriptData);

  console.log(`[YouTube] Starting upload: "${metadata.title}"`);
  console.log(`[YouTube] File: ${videoPath} (${(fs.statSync(videoPath).size / 1024 / 1024).toFixed(1)} MB)`);

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        categoryId: metadata.categoryId,
        defaultLanguage: metadata.defaultLanguage,
        defaultAudioLanguage: metadata.defaultAudioLanguage,
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
        // YouTube 2026 AI content disclosure — REQUIRED for AI-generated content
        containsSyntheticMedia: true,
      },
    },
    media: {
      mimeType: 'video/mp4',
      body: fs.createReadStream(videoPath),
    },
  }, {
    // Track upload progress
    onUploadProgress: (evt) => {
      const pct = Math.round((evt.bytesRead / fs.statSync(videoPath).size) * 100);
      if (pct % 10 === 0) console.log(`[YouTube] Upload progress: ${pct}%`);
    },
  });

  const videoId = res.data.id;
  const videoUrl = `https://youtu.be/${videoId}`;
  console.log(`[YouTube] ✅ Uploaded! URL: ${videoUrl}`);

  // Update DB
  db.update(d => {
    const v = d.videos.find(x => x.id === jobId);
    if (v) {
      v.status = 'uploaded';
      v.youtubeId = videoId;
      v.youtubeUrl = videoUrl;
      v.uploadedAt = new Date().toISOString();
    }
  });

  return { videoId, videoUrl };
}

// ─── Check if YouTube is connected ───────────────────────────────────────────
function isYouTubeConnected() {
  return fs.existsSync(TOKENS_FILE);
}

// ─── Get channel info ─────────────────────────────────────────────────────────
async function getChannelInfo() {
  const auth = await getAuthenticatedClient();
  const youtube = google.youtube({ version: 'v3', auth });

  const res = await youtube.channels.list({
    part: ['snippet', 'statistics'],
    mine: true,
  });

  const channel = res.data.items?.[0];
  if (!channel) return null;

  return {
    id: channel.id,
    name: channel.snippet?.title,
    subscribers: channel.statistics?.subscriberCount,
    videos: channel.statistics?.videoCount,
    views: channel.statistics?.viewCount,
    url: `https://youtube.com/channel/${channel.id}`,
  };
}

module.exports = {
  getAuthUrl,
  exchangeCodeForTokens,
  uploadToYouTube,
  isYouTubeConnected,
  getChannelInfo,
};
