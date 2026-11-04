// DB: Upstash Redis (persistent) in production, JSON file locally.
// The API is synchronous-friendly via an in-memory cache: Redis is read once on
// startup and written on every update. Only the API server writes this blob —
// render workers write per-job progress keys instead (see jobstate.js).
const fs = require('fs');
const path = require('path');
const redis = require('./redis');

// Each channel is fully separate: its own history, settings and schedule.
// The finance channel keeps its original key so existing history is untouched.
const CHANNELS = {
  finance: {
    key: 'autotube:data', file: 'data.json',
    defaults: () => ({
      niche: process.env.CHANNEL_NICHE || 'personal finance',
      audience: process.env.CHANNEL_AUDIENCE || 'global English',
      frequencyDays: parseInt(process.env.VIDEO_FREQUENCY_DAYS || '2'),
      voiceId: '',
      publishHour: 18,
      isRunning: true,
    }),
  },
  kids: {
    key: 'autotube:kids:data', file: 'data-kids.json',
    defaults: () => ({
      channelName: process.env.KIDS_CHANNEL_NAME || 'कहानी पिटारा',
      frequencyDays: parseInt(process.env.KIDS_FREQUENCY_DAYS || '2'),
      storyHint: '',
      publishHour: 18,
      isRunning: true,
    }),
  },
  motivation: {
    key: 'autotube:motivation:data', file: 'data-motivation.json',
    defaults: () => ({
      channelName: process.env.MOTIVATION_CHANNEL_NAME || 'Apna Motivation',
      person: 'Chanakya',
      topicHint: '',
      frequencyDays: 2,
      publishHour: 18,
      isRunning: true,
      scheduledTrending: false,
      autoApprove: false,
      shortsPerVideo: 2,
      shortsGapHours: 24,
      usedRefs: {},
    }),
  },
};
const CHANNEL_IDS = Object.keys(CHANNELS);

function createStore(channel) {
const cfg = CHANNELS[channel];
if (!cfg) throw new Error(`Unknown channel: ${channel}`);
const DB_FILE = path.join(__dirname, cfg.file);
const DB_KEY = cfg.key;
const DEFAULT = () => ({ videos: [], settings: cfg.defaults(), nextGenerateAt: null });

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
    console.log(`[DB:${channel}] Connecting to Upstash Redis...`);
    let raw = null;
    try { raw = await redis.getJSON(DB_KEY); }
    catch (e) { console.error('[DB] Redis GET error:', e.message); }

    const { data, nestedLevels } = recover(raw || {});
    _cache = data;
    console.log(`[DB:${channel}] Loaded from Redis: ${_cache.videos.length} videos`);
    if (nestedLevels > 1) {
      console.log(`[DB] Recovered history from ${nestedLevels} legacy-wrapped levels — rewriting clean copy`);
      await redis.setJSON(DB_KEY, _cache);
    }
    fileSave(_cache);
  } else {
    console.log(`[DB:${channel}] Using local file (${cfg.file})`);
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

return { channel, get, update, init, loadFresh, recover };
}

const stores = Object.fromEntries(CHANNEL_IDS.map(c => [c, createStore(c)]));
const of = (channel) => stores[channel] || stores.finance;

module.exports = {
  ...stores.finance,                 // backwards compatible: db.get() etc. = finance
  of, CHANNEL_IDS,
  initAll: () => Promise.all(Object.values(stores).map(s => s.init())),
  // Find a job in any channel (render worker only gets the job id)
  async findJob(jobId) {
    for (const c of CHANNEL_IDS) {
      const data = await stores[c].loadFresh();
      const job = data.videos.find(v => v.id === jobId);
      if (job) return { channel: c, job, settings: data.settings };
    }
    return null;
  },
};
