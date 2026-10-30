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

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildDescription(scriptData) {
  // Drop any timestamp/chapter lines Claude may have written — real ones are added below
  const body = String(scriptData.description || '')
    .split('\n')
    .filter(l => !/^\s*\W*\s*(timestamps?|chapters?)\s*:?\s*$/i.test(l) && !/^\s*\d{1,2}:\d{2}\b/.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const parts = [body];
  const links = scriptData.links || [];
  if (links.length) {
    parts.push('', '🔗 LINKS', ...links.map(l => `${l.name}: ${l.url}`),
      '(Some of these may be affiliate links — I may earn a small commission at no extra cost to you.)');
  }
  const chapters = scriptData.chapters || [];
  if (chapters.length >= 3) {
    parts.push('', 'CHAPTERS', ...chapters.map(c => `${fmtTime(c.t)} ${c.title}`));
  }
  if (scriptData.kids) {
    if (scriptData.moral) parts.push('', `🌟 सीख: ${scriptData.moral}`);
    parts.push('', '---------------------------------', 'Animated with AI assistance (story and voices).');
  } else {
    parts.push(
      '',
      '---------------------------------',
      'This video was produced with AI assistance (script and narration).',
      'Information is for educational purposes only — not financial advice.',
      'Always consult a qualified financial advisor before investing.',
    );
  }
  return parts.join('\n').slice(0, 4900);
}

// Upload a rendered MP4. Does not touch the DB — caller records the result.
async function uploadVideo(videoPath, scriptData, { onProgress, thumbnailPath } = {}) {
  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
    throw new Error('YouTube OAuth credentials not set (YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET)');
  }
  const auth = await getAuthenticatedClient();
  const youtube = google.youtube({ version: 'v3', auth });
  const fileSize = fs.statSync(videoPath).size;
  const kids = !!scriptData.kids;
  const tags = [...(scriptData.tags || []),
    ...(kids ? ['hindi kahani', 'bachon ki kahani', 'panchatantra', 'moral stories', 'हिंदी कहानियाँ'] : ['personal finance', 'money', 'investing', 'financial freedom', 'finance tips', '2026'])]
    .filter((t, i, a) => t && a.indexOf(t) === i).slice(0, 30);

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: (scriptData.title || 'Personal finance').slice(0, 100),
        description: buildDescription(scriptData),
        tags,
        categoryId: kids ? '1' : '27',
        defaultLanguage: kids ? 'hi' : 'en',
        defaultAudioLanguage: kids ? 'hi' : 'en',
      },
      status: {
        privacyStatus: process.env.YOUTUBE_PRIVACY || 'public',
        // Children's content must be declared "made for kids" (COPPA)
        selfDeclaredMadeForKids: kids,
        // YouTube's "Altered or synthetic content" label. Required for realistic AI depictions of
        // real people/places/events — not for a generic narrator voice over real stock footage.
        // Set YOUTUBE_AI_LABEL=true (GitHub repo variable) to always apply it.
        containsSyntheticMedia: process.env.YOUTUBE_AI_LABEL === 'true',
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
