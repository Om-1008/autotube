// Session 4: YouTube Data API v3 - auto-upload rendered videos
// Tokens stored in Upstash Redis so they survive Render restarts/redeploys
const { google } = require('googleapis');

const REDIS_URL = process.env.UPSTASH_REDIS_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_TOKEN;
const TOKENS_KEY = 'autotube:youtube_tokens';

// OAuth2 client setup
function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI || 'https://autotube-227z.onrender.com/auth/youtube/callback'
  );
}

// Save tokens to Redis (survives restarts + redeploys)
async function saveTokens(tokens) {
  try {
    await fetch(`${REDIS_URL}/set/${TOKENS_KEY}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: JSON.stringify(tokens) }),
    });
    console.log('[YouTube] Tokens saved to Redis');
  } catch (e) {
    console.error('[YouTube] Failed to save tokens to Redis:', e.message);
  }
}

// Load tokens from Redis
async function loadTokens() {
  try {
    const res = await fetch(`${REDIS_URL}/get/${TOKENS_KEY}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    const json = await res.json();
    if (!json.result) return null;
    return typeof json.result === 'string' ? JSON.parse(json.result) : json.result;
  } catch (e) {
    console.error('[YouTube] Failed to load tokens from Redis:', e.message);
    return null;
  }
}

// Get authenticated YouTube client
async function getAuthenticatedClient() {
  const oauth2Client = getOAuthClient();
  const tokens = await loadTokens();

  if (!tokens) {
    throw new Error('YouTube not connected. Visit /auth/youtube to connect your channel.');
  }

  // Debug: log which token fields we have
  const tokenKeys = Object.keys(tokens);
  console.log('[YouTube] Token fields in Redis:', tokenKeys.join(', '));

  if (!tokens.refresh_token) {
    console.error('[YouTube] Missing refresh_token! Need to re-auth. Go to /auth/youtube/revoke then /auth/youtube');
    throw new Error('YouTube refresh_token missing. Visit /auth/youtube/revoke to reset, then re-authorize at /auth/youtube');
  }

  oauth2Client.setCredentials(tokens);

  // Auto-refresh expired tokens and save back to Redis
  oauth2Client.on('tokens', async (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    await saveTokens(merged);
    console.log('[YouTube] Token auto-refreshed and saved to Redis');
  });

  return oauth2Client;
}

// Generate OAuth URL - user visits this once to connect their channel
function getAuthUrl() {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube',
    ],
    prompt: 'consent',
  });
}

// Exchange auth code for tokens (called by OAuth callback)
async function exchangeCodeForTokens(code) {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  await saveTokens(tokens);
  return tokens;
}

// Check if YouTube is connected (checks Redis)
async function isYouTubeConnected() {
  const tokens = await loadTokens();
  return !!tokens;
}

// Build video metadata for YouTube upload
function getVideoMetadata(scriptData) {
  const tags = scriptData.tags || [];
  const allTags = [
    ...tags,
    'personal finance', 'money', 'investing', 'financial freedom',
    'save money', 'make money', 'finance tips', '2026',
  ].slice(0, 50);

  return {
    title: scriptData.title,
    description: [
      scriptData.description || '',
      '',
      '---------------------------------',
      'CHAPTERS',
      ...(scriptData.sections || []).map((s, i) => `${i === 0 ? '0:00' : ''} ${s.name}`),
      '',
      '---------------------------------',
      'DISCLOSURE: This video was created with AI assistance.',
      'Information is for educational purposes only. Not financial advice.',
      'Always consult a qualified financial advisor before investing.',
      '',
      '#personalfinance #money #investing #financialfreedom',
    ].join('\n'),
    tags: allTags,
    categoryId: '27',
    defaultLanguage: 'en',
    defaultAudioLanguage: 'en',
  };
}

// Upload video to YouTube
async function uploadToYouTube(jobId, videoPath, scriptData) {
  const fs = require('fs');
  const db = require('./db');

  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
    throw new Error('YouTube OAuth credentials not set');
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
        containsSyntheticMedia: true,
      },
    },
    media: {
      mimeType: 'video/mp4',
      body: fs.createReadStream(videoPath),
    },
  }, {
    onUploadProgress: (evt) => {
      const pct = Math.round((evt.bytesRead / fs.statSync(videoPath).size) * 100);
      if (pct % 10 === 0) console.log(`[YouTube] Upload progress: ${pct}%`);
    },
  });

  const videoId = res.data.id;
  const videoUrl = `https://youtu.be/${videoId}`;
  console.log(`[YouTube] Uploaded! URL: ${videoUrl}`);

  await db.update(d => {
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

// Get channel info
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
