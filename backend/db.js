// DB: Upstash Redis (persistent) in production, JSON file locally.
// The API is synchronous-friendly via an in-memory cache: Redis is read once on
// startup and written on every update. Only the API server writes this blob —
// render workers write per-job progress keys instead (see jobstate.js).
const fs = require('fs');
const path = require('path');
const redis = require('./redis');

const DB_FILE = path.join(__dirname, 'data.json');
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

let _cache = null;

// Earlier versions saved the blob wrapped as { value: "<json>" }, and each restart
// spread that wrapper into the cache and re-wrapped it — so older history sits in a
// nested chain of `value` strings. Walk the chain and merge every video found.
function recover(raw) {
  const levels = [];
  let cur = raw;
  for (let i = 0; cur && typeof cur === 'object' && i < 100; i++) {
    levels.push(cur);
    cur = typeof cur.value === 'string' ? redis.parseStored(cur.value)
      : (cur.value && typeof cur.value === 'object' ? cur.value : null);
  }

  const def = DEFAULT();
  const seen = new Set();
  const videos = [];
  let settings = null;
  let nextGenerateAt = null;

  for (const lvl of levels) {            // outermost (newest) first
    if (Array.isArray(lvl.videos)) {
      for (const v of lvl.videos) {
        if (v && v.id && !seen.has(v.id)) { seen.add(v.id); videos.push(v); }
      }
    }
    if (!settings && lvl.settings) settings = lvl.settings;
    if (!nextGenerateAt && lvl.nextGenerateAt) nextGenerateAt = lvl.nextGenerateAt;
  }

  videos.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return {
    data: { videos, settings: { ...def.settings, ...(settings || {}) }, nextGenerateAt },
    nestedLevels: levels.length,
  };
}

function fileLoad() {
  if (!fs.existsSync(DB_FILE)) return DEFAULT();
  try { return recover(JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))).data; }
  catch { return DEFAULT(); }
}

function fileSave(data) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); } catch { /* read-only FS is fine */ }
}

async function init() {
  if (redis.enabled) {
    console.log('[DB] Connecting to Upstash Redis...');
    let raw = null;
    try { raw = await redis.getJSON(DB_KEY); }
    catch (e) { console.error('[DB] Redis GET error:', e.message); }

    const { data, nestedLevels } = recover(raw || {});
    _cache = data;
    console.log(`[DB] Loaded from Redis: ${_cache.videos.length} videos`);
    if (nestedLevels > 1) {
      console.log(`[DB] Recovered history from ${nestedLevels} legacy-wrapped levels — rewriting clean copy`);
      await redis.setJSON(DB_KEY, _cache);
    }
    fileSave(_cache);
  } else {
    console.log('[DB] Using local file (data.json)');
    _cache = fileLoad();
  }
}

// Read-only snapshot for workers (no cache, no writes)
async function loadFresh() {
  if (!redis.enabled) return fileLoad();
  return recover((await redis.getJSON(DB_KEY)) || {}).data;
}

function get() {
  if (!_cache) _cache = fileLoad();
  return _cache;
}

async function update(fn) {
  if (!_cache) _cache = fileLoad();
  fn(_cache);
  fileSave(_cache);
  if (redis.enabled) {
    try { await redis.setJSON(DB_KEY, _cache); }
    catch (e) { console.error('[DB] Redis SET error:', e.message); }
  }
  return _cache;
}

module.exports = { get, update, init, loadFresh, recover };
