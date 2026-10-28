// YouTube Data API v3 — OAuth + upload.
// OAuth tokens live in Upstash Redis so they survive restarts, redeploys, and are
// readable by the GitHub Actions render worker.
const fs = require('fs');
const { google } = require('googleapis');
const redis = require('./redis');

const TOKENS_KEY = 'autotube:youtube_tokens';

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI || 'https://autotube-227z.onrender.com/auth/youtube/callback'
  );
}

async function saveTokens(tokens) {
  await redis.setJSON(TOKENS_KEY, tokens);
  console.log('[YouTube] Tokens saved to Redis');
}

async function loadTokens() {
  try {
    let t = await redis.getJSON(TOKENS_KEY);
    // Legacy wrapper from the earlier save format
    if (t && t.value && !t.access_token && !t.refresh_token) t = redis.parseStored(t.value);
    return t || null;
  } catch (e) {
    console.error('[YouTube] Failed to load tokens from Redis:', e.message);
    return null;
  }
}

async function clearTokens() {
  await redis.del(TOKENS_KEY);
}

async function getAuthenticatedClient() {
  const oauth2Client = getOAuthClient();
  const tokens = await loadTokens();
  if (!tokens) throw new Error('YouTube not connected. Visit /auth/youtube to connect your channel.');
  if (!tokens.refresh_token) {
    throw new Error('YouTube refresh_token missing. Visit /auth/youtube/revoke, then re-authorize at /auth/youtube');
  }
  oauth2Client.setCredentials(tokens);
  oauth2Client.on('tokens', async (newTokens) => {
    try { await saveTokens({ ...tokens, ...newTokens }); } catch (e) { /* non-fatal */ }
  });
  return oauth2Client;
}

function getAuthUrl() {
  return getOAuthClient().generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube',
    ],
    prompt: 'consent',
  });
}

async function exchangeCodeForTokens(code) {
  const { tokens } = await getOAuthClient().getToken(code);
  await saveTokens(tokens);
  return tokens;
}

async function isYouTubeConnected() {
  return !!(await loadTokens());
}

function buildDescription(scriptData) {
  return [
    scriptData.description || '',
    '',
    '---------------------------------',
    'DISCLOSURE: This video was created with AI assistance.',
    'Information is for educational purposes only. Not financial advice.',
    'Always consult a qualified financial advisor before investing.',
    '',
    '#personalfinance #money #investing #financialfreedom',
  ].join('\n');
}

// Upload a rendered MP4. Does not touch the DB — caller records the result.
async function uploadVideo(videoPath, scriptData, { onProgress, thumbnailPath } = {}) {
  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
    throw new Error('YouTube OAuth credentials not set (YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET)');
  }
  const auth = await getAuthenticatedClient();
  const youtube = google.youtube({ version: 'v3', auth });
  const fileSize = fs.statSync(videoPath).size;
  const tags = [...(scriptData.tags || []),
    'personal finance', 'money', 'investing', 'financial freedom', 'finance tips', '2026']
    .filter((t, i, a) => t && a.indexOf(t) === i).slice(0, 30);

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: (scriptData.title || 'Personal finance').slice(0, 100),
        description: buildDescription(scriptData),
        tags,
        categoryId: '27',
        defaultLanguage: 'en',
        defaultAudioLanguage: 'en',
      },
      status: {
        privacyStatus: process.env.YOUTUBE_PRIVACY || 'public',
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: true,
      },
    },
    media: { mimeType: 'video/mp4', body: fs.createReadStream(videoPath) },
  }, {
    onUploadProgress: (evt) => onProgress && onProgress(Math.min(100, Math.round((evt.bytesRead / fileSize) * 100))),
  });

  const videoId = res.data.id;

  let thumbnailSet = false;
  if (thumbnailPath && fs.existsSync(thumbnailPath)) {
    try {
      await youtube.thumbnails.set({
        videoId,
        media: { mimeType: 'image/jpeg', body: fs.createReadStream(thumbnailPath) },
      });
      thumbnailSet = true;
    } catch (e) {
      // Custom thumbnails need a phone-verified channel — not fatal
      console.warn('[YouTube] Thumbnail not set:', e.message);
    }
  }

  return { videoId, videoUrl: `https://youtu.be/${videoId}`, thumbnailSet };
}

async function getChannelInfo() {
  const auth = await getAuthenticatedClient();
  const youtube = google.youtube({ version: 'v3', auth });
  const res = await youtube.channels.list({ part: ['snippet', 'statistics'], mine: true });
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
  getAuthUrl, exchangeCodeForTokens, uploadVideo,
  isYouTubeConnected, getChannelInfo, clearTokens,
};
