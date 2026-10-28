// Minimal Upstash Redis REST client.
// Uses the command-array format (["SET", key, value]) so values are stored as raw
// strings — the older "/set/key" + {value} body stored a wrapper object instead.
const REDIS_URL = process.env.UPSTASH_REDIS_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_TOKEN;

const enabled = !!(REDIS_URL && REDIS_TOKEN);

async function cmd(args) {
  if (!enabled) throw new Error('Redis not configured (UPSTASH_REDIS_URL / UPSTASH_REDIS_TOKEN)');
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const json = await res.json();
  if (json.error) throw new Error('Redis: ' + json.error);
  return json.result;
}

// Parse a stored value, unwrapping the legacy { value: "<json>" } wrapper (possibly nested)
function parseStored(raw) {
  if (raw == null) return null;
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return v; }
  }
  return v;
}

async function getJSON(key) {
  return parseStored(await cmd(['GET', key]));
}

async function setJSON(key, obj) {
  return cmd(['SET', key, JSON.stringify(obj)]);
}

async function mgetJSON(keys) {
  if (!keys.length) return [];
  const results = await cmd(['MGET', ...keys]);
  return (results || []).map(parseStored);
}

async function del(key) {
  return cmd(['DEL', key]);
}

module.exports = { enabled, cmd, getJSON, setJSON, mgetJSON, del, parseStored };
