// DB: Upstash Redis (free, persistent) in production, JSON file locally
// API is kept synchronous-compatible via an in-memory cache.
// Redis is read on startup and written on every update.
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data.json');
const REDIS_URL = process.env.UPSTASH_REDIS_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_TOKEN;
const DB_KEY = 'autotube:data';

const DEFAULT = () => ({
  videos: [],
  settings: {
    niche: process.env.CHANNEL_NICHE || 'personal finance',
    audience: process.env.CHANNEL_AUDIENCE || 'global English',
    frequencyDays: parseInt(process.env.VIDEO_FREQUENCY_DAYS || '2'),
    voiceId: '',
    publishHour: 18,
    isRunning: true,
  },
  nextGenerateAt: null,
});

const useRedis = !!(REDIS_URL && REDIS_TOKEN);

// In-memory cache — always up to date after init
let _cache = null;

// ── Redis REST helpers ────────────────────────────────────────────────────────
async function redisGet() {
  try {
    const res = await fetch(`${REDIS_URL}/get/${DB_KEY}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    const json = await res.json();
    if (!json.result) return null;
    return JSON.parse(json.result);
  } catch (e) {
    console.error('[DB] Redis GET error:', e.message);
    return null;
  }
}

async function redisSet(data) {
  try {
    await fetch(`${REDIS_URL}/set/${DB_KEY}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ value: JSON.stringify(data) }),
    });
  } catch (e) {
    console.error('[DB] Redis SET error:', e.message);
  }
}

// ── File helpers ──────────────────────────────────────────────────────────────
function fileLoad() {
  if (!fs.existsSync(DB_FILE)) {
    const d = DEFAULT();
    fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2));
    return d;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return DEFAULT();
  }
}

function fileSave(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ── Init: load from Redis or file into cache ──────────────────────────────────
async function init() {
  if (useRedis) {
    console.log('[DB] Connecting to Upstash Redis...');
    const data = await redisGet();
    _cache = data || DEFAULT();
    console.log(`[DB] Loaded from Redis: ${_cache.videos.length} videos`);
    // Also write to local file as backup
    fileSave(_cache);
  } else {
    console.log('[DB] Using local file (data.json)');
    _cache = fileLoad();
  }
}

// ── Public API (sync-safe after init) ────────────────────────────────────────
function get() {
  if (!_cache) _cache = fileLoad(); // fallback if init not awaited
  return _cache;
}

async function update(fn) {
  if (!_cache) _cache = fileLoad();
  fn(_cache);
  fileSave(_cache); // always write locally
  if (useRedis) await redisSet(_cache);
  return _cache;
}

module.exports = { get, update, init };
