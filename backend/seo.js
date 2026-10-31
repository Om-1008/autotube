// Discoverability helpers used at upload time (both channels):
//  - researchTags: looks up the most-viewed recent videos for our topic through the YouTube
//    Data API, collects the tags they use, and has Claude keep only the ones that honestly
//    describe our video (no other channels' names, no misleading terms).
//  - mergeTags: our own + researched + defaults, within YouTube's 500-character tag limit.
//  - toSrt / cuesFromLines: subtitle files from the exact narration timings.
let Anthropic = null;
try { Anthropic = require('@anthropic-ai/sdk'); } catch { /* optional */ }

const norm = t => String(t || '').toLowerCase().replace(/^#/, '').replace(/\s+/g, ' ').trim();

async function researchTags(youtube, { queries, lang = 'en', region, context, max = 15, log = () => {} }) {
  const ids = new Set();
  const since = new Date(Date.now() - 2 * 365 * 86400000).toISOString();   // "currently running" = last 2 years
  for (const q of (queries || []).filter(Boolean).slice(0, 2)) {
    const r = await youtube.search.list({
      part: ['id'], q, type: ['video'], order: 'viewCount', maxResults: 20,
      relevanceLanguage: lang, ...(region ? { regionCode: region } : {}), publishedAfter: since, safeSearch: 'strict',
    });
    (r.data.items || []).forEach(i => i.id && i.id.videoId && ids.add(i.id.videoId));
  }
  if (!ids.size) return [];
  const v = await youtube.videos.list({ part: ['snippet', 'statistics'], id: [...ids].slice(0, 50) });
  const stats = new Map();
  for (const item of v.data.items || []) {
    const views = +(item.statistics && item.statistics.viewCount) || 0;
    const channel = norm(item.snippet.channelTitle);
    for (const raw of item.snippet.tags || []) {
      const t = norm(raw);
      if (!t || t.length > 40 || t === channel) continue;
      const s = stats.get(t) || { tag: raw.trim(), docs: 0, score: 0 };
      s.docs += 1; s.score += Math.log10(views + 10);
      stats.set(t, s);
    }
  }
  const candidates = [...stats.values()].sort((a, b) => b.docs - a.docs || b.score - a.score).slice(0, 70);
  log(`Tag research: ${v.data.items.length} top videos, ${stats.size} distinct tags`);
  if (!candidates.length) return [];
  return pickRelevant(candidates, context, max);
}

// Claude keeps only tags that truthfully describe our video
async function pickRelevant(candidates, context, max) {
  const fallback = candidates.filter(c => c.docs >= 2).slice(0, max).map(c => c.tag);
  if (!Anthropic || !process.env.ANTHROPIC_API_KEY) return fallback;
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: process.env.SEO_MODEL || 'claude-haiku-4-5',
      max_tokens: 600,
      messages: [{ role: 'user', content: `Our YouTube video: ${context}

Below are tags used by the most-viewed recent videos on this topic, as "tag (number of top videos using it)".
Choose up to ${max} tags that honestly describe OUR video and that viewers search for.
Exclude: other channels' or brand names, people's names, characters/stories/topics that are not in our video, clickbait, unrelated languages.
Copy tags exactly. Respond with ONLY a JSON array of strings.

${candidates.map(c => `${c.tag} (${c.docs})`).join('\n')}` }],
    });
    const text = msg.content[0].text;
    const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
    const allowed = new Map(candidates.map(c => [norm(c.tag), c.tag]));
    return arr.map(t => allowed.get(norm(t))).filter(Boolean).slice(0, max);
  } catch {
    return fallback;
  }
}

// YouTube allows 500 characters of tags (a tag containing spaces counts its quotes too)
function mergeTags(...lists) {
  const out = []; const seen = new Set(); let len = 0;
  for (const t of lists.flat()) {
    const tag = String(t || '').replace(/[<>,]/g, '').trim().slice(0, 60);
    const k = norm(tag);
    if (!k || seen.has(k)) continue;
    const cost = tag.length + (/\s/.test(tag) ? 2 : 0) + 1;
    if (len + cost > 490) continue;
    seen.add(k); out.push(tag); len += cost;
  }
  return out;
}

// ── subtitles ──
const ts = s => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};

// Split long lines into readable cues (≤ ~84 chars, two subtitle rows), timed by length
function cuesFromLines(lines, maxLen = 84) {
  const cues = [];
  for (const l of lines) {
    const text = String(l.text || '').replace(/\s+/g, ' ').trim();
    if (!text || !(l.end > l.start)) continue;
    const parts = []; let cur = '';
    for (const w of text.split(' ')) {
      if ((cur + ' ' + w).trim().length > maxLen && cur) { parts.push(cur); cur = w; } else cur = (cur ? cur + ' ' : '') + w;
    }
    if (cur) parts.push(cur);
    const total = parts.reduce((a, p) => a + p.length, 0);
    let t = l.start;
    parts.forEach(p => { const d = (l.end - l.start) * (p.length / total); cues.push({ start: t, end: t + d, text: p }); t += d; });
  }
  return cues;
}

function toSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');
}

// Translate subtitle lines (keeps the same count/order); returns null on failure
async function translateLines(texts, target = 'English', note = '') {
  if (!Anthropic || !process.env.ANTHROPIC_API_KEY || !texts.length) return null;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const out = [];
  for (let i = 0; i < texts.length; i += 60) {
    const batch = texts.slice(i, i + 60);
    const msg = await anthropic.messages.create({
      model: process.env.SEO_MODEL || 'claude-haiku-4-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content: `Translate each line into simple, natural ${target} subtitles. ${note}
Keep names as they are (transliterated). Return ONLY a JSON array with exactly ${batch.length} strings, same order.

${JSON.stringify(batch)}` }],
    });
    const t = msg.content[0].text;
    const arr = JSON.parse(t.slice(t.indexOf('['), t.lastIndexOf(']') + 1));
    if (!Array.isArray(arr) || arr.length !== batch.length) return null;
    out.push(...arr.map(String));
  }
  return out;
}

module.exports = { researchTags, mergeTags, cuesFromLines, toSrt, translateLines, norm };
