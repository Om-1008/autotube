// YouTube Data API v3 — OAuth + upload.
// OAuth tokens live in Upstash Redis so they survive restarts, redeploys, and are
// readable by the GitHub Actions render worker.
const fs = require('fs');
const { google } = require('googleapis');
const { Readable } = require('stream');
const redis = require('./redis');
const seo = require('./seo');

// youtube.force-ssl is needed for uploading subtitle tracks
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl',
];

// One YouTube login per channel (finance keeps its original key)
const TOKEN_KEYS = { finance: 'autotube:youtube_tokens', kids: 'autotube:kids:youtube_tokens' };
const keyOf = (channel = 'finance') => TOKEN_KEYS[channel] || TOKEN_KEYS.finance;

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI || 'https://autotube-227z.onrender.com/auth/youtube/callback'
  );
}

async function saveTokens(tokens, channel) {
  await redis.setJSON(keyOf(channel), tokens);
  console.log(`[YouTube:${channel || 'finance'}] Tokens saved to Redis`);
}

async function loadTokens(channel) {
  try {
    let t = await redis.getJSON(keyOf(channel));
    // Legacy wrapper from the earlier save format
    if (t && t.value && !t.access_token && !t.refresh_token) t = redis.parseStored(t.value);
    return t || null;
  } catch (e) {
    console.error('[YouTube] Failed to load tokens from Redis:', e.message);
    return null;
  }
}

async function clearTokens(channel) {
  await redis.del(keyOf(channel));
}

async function getAuthenticatedClient(channel) {
  const oauth2Client = getOAuthClient();
  const tokens = await loadTokens(channel);
  if (!tokens) throw new Error('YouTube not connected. Visit /auth/youtube to connect your channel.');
  if (!tokens.refresh_token) {
    throw new Error('YouTube refresh_token missing. Visit /auth/youtube/revoke, then re-authorize at /auth/youtube');
  }
  oauth2Client.setCredentials(tokens);
  oauth2Client.on('tokens', async (newTokens) => {
    try { await saveTokens({ ...tokens, ...newTokens }, channel); } catch (e) { /* non-fatal */ }
  });
  return oauth2Client;
}

function getAuthUrl(channel = 'finance') {
  return getOAuthClient().generateAuthUrl({
    state: channel,
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

async function exchangeCodeForTokens(code, channel) {
  const { tokens } = await getOAuthClient().getToken(code);
  await saveTokens(tokens, channel);
  return tokens;
}

async function isYouTubeConnected(channel) {
  return !!(await loadTokens(channel));
}

// Logins made before subtitles were added lack the captions scope → ask to reconnect
async function missingScopes(channel) {
  const t = await loadTokens(channel);
  if (!t || !t.scope) return [];
  return SCOPES.filter(sc => !t.scope.split(' ').includes(sc)).map(sc => sc.split('/').pop());
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
    parts.push('', 'हिंदी और English subtitles उपलब्ध हैं (CC).');
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
  const hashtags = (scriptData.hashtags || []).slice(0, 5);
  const body2 = parts.join('\n').slice(0, 4800);
  return hashtags.length ? `${body2}\n\n${hashtags.join(' ')}` : body2;
}

// Upload a rendered MP4. Does not touch the DB — caller records the result.
async function uploadVideo(videoPath, scriptData, { onProgress, thumbnailPath, channel, log = () => {} } = {}) {
  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
    throw new Error('YouTube OAuth credentials not set (YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET)');
  }
  const auth = await getAuthenticatedClient(channel || (scriptData.kids ? 'kids' : 'finance'));
  const youtube = google.youtube({ version: 'v3', auth });
  const fileSize = fs.statSync(videoPath).size;
  const kids = !!scriptData.kids;
  const lang = kids ? 'hi' : 'en';

  // Tags: ours first, then the relevant tags of the top-viewed recent videos on this topic
  let researched = [];
  try {
    researched = await seo.researchTags(youtube, {
      queries: scriptData.searchQueries && scriptData.searchQueries.length ? scriptData.searchQueries : [scriptData.title],
      lang, region: kids ? 'IN' : undefined, context: scriptData.seoContext || scriptData.title, log,
    });
    if (researched.length) log(`Added ${researched.length} tags used by top videos: ${researched.slice(0, 8).join(', ')}${researched.length > 8 ? '…' : ''}`);
  } catch (e) {
    log(`Tag research skipped (${e.message.slice(0, 120)})`);
  }
  const defaults = kids
    ? ['hindi kahani', 'hindi kahaniya', 'bachon ki kahani', 'panchatantra ki kahaniyan', 'moral stories in hindi', 'हिंदी कहानियाँ', 'kids stories in hindi', 'cartoon kahani']
    : ['personal finance', 'money tips', 'investing for beginners', 'financial freedom', 'how to save money', String(new Date().getFullYear())];
  const tags = seo.mergeTags(scriptData.tags || [], researched, defaults);

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: String(scriptData.title || 'Personal finance').replace(/[<>]/g, '').slice(0, 100),
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

  // Subtitles (searchable text + accessibility)
  for (const c of scriptData.captions || []) {
    try {
      await youtube.captions.insert({
        part: ['snippet'],
        requestBody: { snippet: { videoId, language: c.lang, name: c.name, isDraft: false } },
        media: { mimeType: 'application/octet-stream', body: Readable.from([c.srt]) },
      });
      log(`Subtitles added: ${c.name}`);
    } catch (e) {
      log(`⚠️ Subtitles (${c.name}) not added: ${/insufficient|scope|permission/i.test(e.message) ? 'reconnect YouTube from the dashboard to allow subtitles' : e.message.slice(0, 120)}`);
    }
  }

  // Playlist (keeps viewers watching the next video)
  if (scriptData.playlist && scriptData.playlist.title) {
    try {
      const playlistId = await ensurePlaylist(youtube, scriptData.playlist, lang);
      await youtube.playlistItems.insert({ part: ['snippet'], requestBody: { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } } });
      log(`Added to playlist “${scriptData.playlist.title}”`);
    } catch (e) {
      log(`⚠️ Playlist not updated: ${e.message.slice(0, 120)}`);
    }
  }

  return { videoId, videoUrl: `https://youtu.be/${videoId}`, thumbnailSet, tags };
}

async function ensurePlaylist(youtube, { title, description }, lang) {
  let pageToken;
  do {
    const r = await youtube.playlists.list({ part: ['snippet'], mine: true, maxResults: 50, pageToken });
    const hit = (r.data.items || []).find(p => p.snippet.title === title);
    if (hit) return hit.id;
    pageToken = r.data.nextPageToken;
  } while (pageToken);
  const created = await youtube.playlists.insert({
    part: ['snippet', 'status'],
    requestBody: { snippet: { title, description: description || '', defaultLanguage: lang }, status: { privacyStatus: 'public' } },
  });
  return created.data.id;
}

// Read-only API client for a channel's login (null if not connected)
async function getYouTubeClient(channel) {
  if (!(await loadTokens(channel))) return null;
  return google.youtube({ version: 'v3', auth: await getAuthenticatedClient(channel) });
}

async function getChannelInfo(channelId) {
  const auth = await getAuthenticatedClient(channelId);
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
  isYouTubeConnected, getChannelInfo, clearTokens, missingScopes, buildDescription, getYouTubeClient,
};
