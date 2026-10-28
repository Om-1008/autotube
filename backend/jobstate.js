// Per-job live progress, stored at autotube:job:<id> (separate from the main DB blob).
// The API server writes it while generating a script; the render worker writes it
// while rendering. The dashboard reads it merged over the job record.
const fs = require('fs');
const path = require('path');
const redis = require('./redis');

const LOCAL_DIR = path.join(__dirname, 'jobstate');
const key = (id) => `autotube:job:${id}`;

const STAGES = {
  generate: [
    { key: 'researching', label: 'Researching a topic' },
    { key: 'writing', label: 'Writing the script' },
    { key: 'finalizing', label: 'Title, tags & description' },
  ],
  render: [
    { key: 'queued', label: 'Starting render server' },
    { key: 'voiceover', label: 'Recording voiceover' },
    { key: 'footage', label: 'Finding stock footage' },
    { key: 'rendering', label: 'Editing video & captions' },
    { key: 'uploading', label: 'Uploading to YouTube' },
  ],
};

// Local fallback (no Redis) so dev mode still shows progress
async function write(id, state) {
  if (redis.enabled) return redis.setJSON(key(id), state);
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  fs.writeFileSync(path.join(LOCAL_DIR, `${id}.json`), JSON.stringify(state));
}

async function read(id) {
  if (redis.enabled) return redis.getJSON(key(id));
  try { return JSON.parse(fs.readFileSync(path.join(LOCAL_DIR, `${id}.json`), 'utf8')); } catch { return null; }
}

async function readMany(ids) {
  if (!ids.length) return [];
  if (redis.enabled) return redis.mgetJSON(ids.map(key));
  return Promise.all(ids.map(read));
}

async function remove(id) {
  if (redis.enabled) return redis.del(key(id));
  try { fs.unlinkSync(path.join(LOCAL_DIR, `${id}.json`)); } catch {}
}

function createReporter(jobId, phase, extra = {}) {
  const state = {
    phase,
    status: STAGES[phase][0].key,
    stages: STAGES[phase].map(s => ({ ...s, state: 'pending', detail: '' })),
    percent: null,
    log: [],
    error: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...extra,
  };

  let lastWrite = 0;
  let pending = null;
  let chain = Promise.resolve();

  function flush() {
    if (pending) { clearTimeout(pending); pending = null; }
    lastWrite = Date.now();
    state.updatedAt = new Date().toISOString();
    const snapshot = JSON.parse(JSON.stringify(state));
    chain = chain.then(() => write(jobId, snapshot)).catch(e => console.error('[JobState] write failed:', e.message));
    return chain;
  }

  // Throttle chatty updates (progress %) to one write every 2.5s
  function schedule() {
    const wait = 2500 - (Date.now() - lastWrite);
    if (wait <= 0) return flush();
    if (!pending) pending = setTimeout(flush, wait);
    return chain;
  }

  const current = () => state.stages.find(s => s.state === 'active');

  return {
    state,
    log(msg, { quiet } = {}) {
      if (!quiet) console.log(`[${jobId.slice(0, 8)}] ${msg}`);
      state.log.push({ t: new Date().toISOString(), msg });
      if (state.log.length > 80) state.log = state.log.slice(-80);
      return schedule();
    },
    stage(stageKey, detail = '') {
      for (const s of state.stages) {
        if (s.key === stageKey) break;
        if (s.state !== 'done') s.state = 'done';
      }
      const s = state.stages.find(x => x.key === stageKey);
      if (s) { s.state = 'active'; s.detail = detail; }
      state.status = stageKey;
      state.percent = null;
      if (detail) state.log.push({ t: new Date().toISOString(), msg: detail });
      console.log(`[${jobId.slice(0, 8)}] ▶ ${s ? s.label : stageKey}${detail ? ' — ' + detail : ''}`);
      return flush();
    },
    progress(percent, detail) {
      state.percent = Math.max(0, Math.min(100, Math.round(percent)));
      const s = current();
      if (s && detail) s.detail = detail;
      return schedule();
    },
    set(fields) { Object.assign(state, fields); return flush(); },
    done(finalStatus, fields = {}) {
      state.stages.forEach(s => { s.state = 'done'; });
      state.status = finalStatus;
      state.percent = 100;
      Object.assign(state, fields, { finishedAt: new Date().toISOString() });
      return flush();
    },
    fail(err) {
      const s = current();
      if (s) s.state = 'error';
      state.status = 'error';
      state.error = (err && err.message) || String(err);
      state.log.push({ t: new Date().toISOString(), msg: '❌ ' + state.error });
      console.error(`[${jobId.slice(0, 8)}] ❌ ${state.error}`);
      return flush();
    },
    flush,
  };
}

module.exports = { STAGES, createReporter, read, readMany, write, remove };
