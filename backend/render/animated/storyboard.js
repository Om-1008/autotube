// Storyboard: Claude maps the narration (sentence by sentence) onto animated beats,
// each using one template from runtime.html. Everything Claude returns is validated and
// sanitised here; anything unusable falls back to a simple "keyword" beat.

const ICONS = ['house', 'food', 'bolt', 'bag', 'piggy', 'card', 'bank', 'phone', 'chart', 'coin', 'calendar', 'shield', 'car', 'health', 'plane', 'education', 'cart', 'gift', 'gear', 'target', 'clock', 'warning', 'check', 'cross', 'wallet', 'cash', 'growth', 'decline', 'umbrella', 'family', 'laptop', 'briefcase', 'receipt', 'lock', 'idea', 'percent', 'rocket'];
const MOODS = ['neutral', 'happy', 'worried', 'thinking', 'surprised', 'celebrate', 'pointing', 'explaining', 'waving'];

const SPEC = `Templates (params):
- title {title, subtitle?, icon?}  — ONLY the first beat
- heading {kicker, title, icon?}  — opens a section, e.g. kicker "Step 1", title "Know your number" (≤5 words)
- keyword {text, icon, sub?}  — one key idea or punchline, text ≤6 words
- counter {label, from, to, prefix?, suffix?, note?}  — a number going up or down
- stat {percent, label}  — "X% of people …" (percent 0–100)
- bars {title, bars:[{label, value}], prefix?, suffix?, highlight?}  — 2–12 amounts to compare or growth over time
- flow {source:{label, amount?, icon}, items:[{label, amount?, icon}], counterLabel?, prefix?}  — money going out to 2–4 places
- split {total:{label, amount?}, parts:[{label, percent, icon}], highlight?}  — dividing money by percentages (2–4 parts)
- compare {left:{title, value?, points:[{text, good}]}, right:{…}, winner:"left"|"right"|"none"}  — two options, ≤3 points each, points ≤6 words
- checklist {title, items:[string]}  — 2–5 short actions (≤8 words each)
- timeline {title?, points:[{label, value?}], prefix?}  — 3–5 points in time
- icons {title?, items:[{label, icon}]}  — 2–4 things in a group
- outro {text}  — ONLY the last beat (subscribe call to action)
Every beat also has: from, to (sentence numbers, inclusive), template, mood (${MOODS.join('|')}), kicker? (optional 1–3 word label shown at the top, e.g. "THE PROBLEM").
Icons (use only these): ${ICONS.join(', ')}.`;

// ── number / string sanitisers ──
function num(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  let n = parseFloat(m[0]);
  if (/\d\s*k\b/i.test(v)) n *= 1000;
  if (/\d\s*(m|million)\b/i.test(v)) n *= 1e6;
  return n;
}
function str(v, max = 60) {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  const t = String(v).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[,;:\-–—]+$/, '');
}
const icon = v => (ICONS.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : 'coin');
const prefix = v => (typeof v === 'string' && v.length <= 3 ? v : undefined);

const SANITIZE = {
  title: p => (str(p.title, 120) ? { title: str(p.title, 120), subtitle: str(p.subtitle, 90) || undefined, icon: icon(p.icon) } : null),
  heading: p => (str(p.title, 60) ? { kicker: str(p.kicker, 24), title: str(p.title, 60), icon: p.icon ? icon(p.icon) : undefined } : null),
  keyword: p => (str(p.text, 60) ? { text: str(p.text, 60), icon: icon(p.icon), sub: str(p.sub, 80) || undefined } : null),
  counter: p => { const to = num(p.to); if (to === null) return null; return { label: str(p.label, 50), from: num(p.from) ?? 0, to, prefix: prefix(p.prefix), suffix: str(p.suffix, 8) || undefined, note: str(p.note, 90) || undefined }; },
  stat: p => { const pc = num(p.percent); if (pc === null || pc < 0 || pc > 100 || !str(p.label)) return null; return { percent: pc, label: str(p.label, 90) }; },
  bars: p => { const bars = (Array.isArray(p.bars) ? p.bars : []).map(b => ({ label: str(b && b.label, 14), value: num(b && b.value) })).filter(b => b.label && b.value !== null).slice(0, 12); if (bars.length < 2) return null; return { title: str(p.title, 60) || undefined, bars, prefix: prefix(p.prefix), suffix: str(p.suffix, 8) || undefined, highlight: Number.isInteger(p.highlight) ? p.highlight : undefined }; },
  flow: p => { const items = (Array.isArray(p.items) ? p.items : []).map(i => ({ label: str(i && i.label, 22), amount: num(i && i.amount) ?? undefined, icon: icon(i && i.icon) })).filter(i => i.label).slice(0, 4); if (items.length < 2) return null; const s = p.source || {}; return { source: { label: str(s.label, 24) || 'Paycheck', amount: num(s.amount) ?? undefined, icon: icon(s.icon || 'wallet') }, items, counterLabel: str(p.counterLabel, 24) || undefined, prefix: prefix(p.prefix) ?? '$' }; },
  split: p => { const parts = (Array.isArray(p.parts) ? p.parts : []).map(x => ({ label: str(x && x.label, 22), percent: num(x && x.percent), icon: icon(x && x.icon) })).filter(x => x.label && x.percent !== null && x.percent > 0).slice(0, 4); if (parts.length < 2) return null; const t = p.total || {}; return { total: { label: str(t.label, 24) || 'Total', amount: num(t.amount) ?? undefined }, parts, highlight: Number.isInteger(p.highlight) ? p.highlight : undefined, prefix: prefix(p.prefix) ?? '$' }; },
  compare: p => { const side = s => (s && str(s.title, 24) ? { title: str(s.title, 24), value: s.value === undefined || s.value === null ? undefined : (typeof s.value === 'number' ? s.value : str(s.value, 20)), points: (Array.isArray(s.points) ? s.points : []).map(pt => (typeof pt === 'string' ? { text: str(pt, 44) } : { text: str(pt && pt.text, 44), good: typeof (pt && pt.good) === 'boolean' ? pt.good : undefined })).filter(pt => pt.text).slice(0, 3) } : null); const l = side(p.left), r = side(p.right); if (!l || !r) return null; return { left: l, right: r, winner: ['left', 'right'].includes(p.winner) ? p.winner : 'none', prefix: prefix(p.prefix), suffix: str(p.suffix, 8) || undefined }; },
  checklist: p => { const items = (Array.isArray(p.items) ? p.items : []).map(i => str(i, 70)).filter(Boolean).slice(0, 5); if (items.length < 2) return null; return { title: str(p.title, 40), items }; },
  timeline: p => { const points = (Array.isArray(p.points) ? p.points : []).map(x => ({ label: str(x && x.label, 18), value: x && x.value !== undefined && x.value !== null ? (num(x.value) ?? str(x.value, 12)) : undefined })).filter(x => x.label).slice(0, 5); if (points.length < 3) return null; return { title: str(p.title, 60) || undefined, points, prefix: prefix(p.prefix), suffix: str(p.suffix, 8) || undefined }; },
  icons: p => { const items = (Array.isArray(p.items) ? p.items : []).map(i => ({ label: str(i && i.label, 26), icon: icon(i && i.icon) })).filter(i => i.label).slice(0, 4); if (items.length < 2) return null; return { title: str(p.title, 50) || undefined, items }; },
  outro: p => ({ text: str(p.text, 80) || 'New money tips every week' }),
};

function keyPhrase(text) {
  const first = text.replace(/["“”]/g, '').split(/(?<=[.!?])\s+/)[0];
  const clause = first.split(/[,;:—–]/)[0].trim();
  const words = (clause.split(/\s+/).length >= 3 ? clause : first).split(/\s+/).filter(Boolean);
  return words.slice(0, 6).join(' ').replace(/[,.;:!?]+$/, '');
}

function fallbackBeat(from, to, sentences, mood = 'explaining') {
  const text = sentences.slice(from, to + 1).map(s => s.text).join(' ');
  const n = text.match(/\$\s?\d[\d,]*(\.\d+)?\s?k?|\d[\d,]*(\.\d+)?\s?%/);
  if (n) {
    const v = num(n[0]);
    if (/%/.test(n[0]) && v <= 100) return { from, to, template: 'stat', mood: 'thinking', params: { percent: v, label: keyPhrase(text.replace(n[0], '').trim()) } };
    if (v) return { from, to, template: 'counter', mood: 'happy', params: { label: '', from: 0, to: v, prefix: /\$/.test(n[0]) ? '$' : undefined } };
  }
  return { from, to, template: 'keyword', mood, params: { text: keyPhrase(text), icon: 'idea' } };
}

// ── "never invent numbers": everything shown must come from the narration ──
const SMALL = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALE = { hundred: 100, thousand: 1000, million: 1e6 };
function numbersIn(text) {
  const out = [];
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(k|m|million|thousand)?\b/gi;
  let m;
  while ((m = re.exec(text))) {
    let n = parseFloat(m[1].replace(/,/g, ''));
    const unit = (m[2] || '').toLowerCase();
    if (unit === 'k' || unit === 'thousand') n *= 1000; else if (unit === 'm' || unit === 'million') n *= 1e6;
    if (isFinite(n)) out.push(n);
  }
  // spelled-out numbers ("five hundred", "twenty percent")
  const words = text.toLowerCase().replace(/-/g, ' ').split(/[^a-z]+/);
  let cur = null, total = 0;
  const flush = () => { if (cur !== null || total) { out.push(total + (cur || 0)); } cur = null; total = 0; };
  for (const w of words) {
    if (w in SMALL) cur = (cur || 0) + SMALL[w];
    else if (w in SCALE && (cur !== null || total)) { const v = (cur || 1) * SCALE[w]; if (SCALE[w] >= 1000) { total += v; cur = null; } else cur = v; }
    else if (w === 'and' && cur !== null) continue;
    else flush();
  }
  flush();
  return out;
}
function allowedSet(text) {
  const base = [...new Set(numbersIn(text))].slice(0, 16);
  const set = new Set([0, ...base]);
  // counts attached to a time unit ("30 years", "six months") can multiply an amount
  const periods = [];
  const re = /(\d+|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|forty|fifty)\b)\s+(years?|months?|weeks?)/gi;
  let m;
  while ((m = re.exec(text))) { const n = /\d/.test(m[1]) ? parseInt(m[1], 10) : SMALL[m[1].toLowerCase()]; if (n) periods.push(n); }
  if (/month/i.test(text)) periods.push(12);
  const money = base.filter(a => a >= 100);
  for (const a of money) { for (const k of periods) { set.add(a * k); set.add(a / k); } }
  for (const a of money) for (const b of money) { set.add(a + b); set.add(Math.abs(a - b)); }
  if (/%|percent/i.test(text)) {
    set.add(100);
    for (const a of base) if (a > 0 && a < 100) set.add(100 - a);                                         // 20% → the other 80%
    for (const a of base) for (const b of base) if (a >= 1 && b >= 1 && a < b) set.add((a / b) * 100);   // "600 of 3,000" → 20%
  }
  return [...set];
}
const okNum = (n, allowed) => allowed.some(a => Math.abs(a - n) <= Math.max(0.5, Math.abs(n) * 0.01));
const harmless = n => (n <= 10 && Number.isInteger(n)) || (n >= 2020 && n <= 2035);
function stringOK(v, allowed) { return numbersIn(String(v || '')).every(n => harmless(n) || okNum(n, allowed)); }

// Returns a cleaned beat, or null if a required number was invented
function checkNumbers(beat, sentences) {
  const lo = Math.max(0, beat.from - 1), hi = Math.min(sentences.length - 1, beat.to + 1);
  const allowed = allowedSet(sentences.slice(lo, hi + 1).map(s => s.text).join(' '));
  const ok = n => n === undefined || n === null || typeof n !== 'number' || okNum(n, allowed);
  const p = beat.params;
  const S = v => stringOK(v, allowed);
  switch (beat.template) {
    case 'stat': if (!ok(p.percent) || !S(p.label)) return null; break;
    case 'counter': if (!ok(p.to) || !S(p.note) || !S(p.label)) return null; if (!ok(p.from)) p.from = 0; break;
    case 'bars': p.bars = p.bars.filter(b => ok(b.value) && S(b.label)); if (p.bars.length < 2) return null; if (!S(p.title)) p.title = undefined; break;
    case 'flow': if (!ok(p.source.amount)) p.source.amount = undefined; p.items.forEach(i => { if (!ok(i.amount)) i.amount = undefined; }); p.items = p.items.filter(i => S(i.label)); if (p.items.length < 2) return null; break;
    case 'split': if (p.parts.some(x => !ok(x.percent))) return null; if (!ok(p.total.amount)) p.total.amount = undefined; break;
    case 'timeline': p.points.forEach(x => { if (typeof x.value === 'number' ? !ok(x.value) : !S(x.value)) x.value = undefined; }); if (!p.points.every(x => S(x.label))) return null; break;
    case 'compare': for (const side of [p.left, p.right]) { if (side.value !== undefined && (typeof side.value === 'number' ? !ok(side.value) : !S(side.value))) side.value = undefined; side.points = side.points.filter(pt => S(pt.text)); } break;
    case 'checklist': p.items = p.items.filter(S); if (p.items.length < 2) return null; break;
    case 'icons': p.items = p.items.filter(i => S(i.label)); if (p.items.length < 2) return null; break;
    case 'keyword': if (!S(p.text)) return null; if (!S(p.sub)) p.sub = undefined; break;
    case 'heading': case 'title': case 'outro': break;
  }
  if (beat.kicker && !S(beat.kicker)) beat.kicker = undefined;
  return beat;
}

function headingParams(h) {
  const m = h.match(/^(step|tip|rule|part|mistake|way|reason)\s*#?\s*(\d+)\s*[:.\-–—]\s*(.+)$/i);
  if (m) return { kicker: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`, title: m[3].trim() };
  return { kicker: '', title: h };
}

function parseJSON(raw) {
  const t = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}

async function askClaude(anthropic, model, { title, sentences, range, sectionStarts, isFirst, isLast }) {
  const lines = sentences.slice(range[0], range[1] + 1).map(s => {
    const sec = sectionStarts.get(s.i);
    return `${s.i} (${s.dur.toFixed(1)}s)${sec ? ` [SECTION START: "${sec}"]` : ''}: ${s.text}`;
  }).join('\n');
  const msg = await anthropic.messages.create({
    model,
    max_tokens: 8000,
    messages: [{
      role: 'user',
      content: `You are the motion designer for "${title}", a 2D animated personal-finance explainer. A friendly cartoon character stands on the left; animated graphics appear on the right while the narrator speaks.

Plan the visuals for narration sentences ${range[0]}–${range[1]}. Group consecutive sentences into beats (usually 1–3 sentences, ideally 5–12 seconds each) and choose the template that best SHOWS what is being said.

${SPEC}

Rules:
- Beats must cover every sentence ${range[0]}–${range[1]} exactly once, in order, with no gaps or overlaps.
${isFirst ? `- The first beat must be "title" (covering sentence ${range[0]} only, or ${range[0]}–${range[0] + 1}).\n` : ''}${isLast ? `- The last beat must be "outro" covering the final call-to-action sentence(s).\n` : ''}- Where a sentence is marked [SECTION START], a "heading" beat must start at that sentence (it may cover just that sentence) using that section title.
- Numbers must come from the narration you are given (or simple arithmetic on them). Never invent statistics, prices or percentages. If there are no numbers, use keyword, checklist, icons, compare or timeline without values.
- Prefer data templates (counter, stat, bars, flow, split, timeline) whenever the narration contains numbers.
- Don't use the same template more than twice in a row. Match the character's mood to the narration.
- Labels are short (1–4 words). Use "$" as prefix for money unless the narration uses another currency.
${isFirst ? '- Also return "thumbnail": {"text": 2–4 punchy words for the thumbnail (numbers welcome), "icon": one icon, "mood": one mood}.\n' : ''}
Narration:
${lines}

Respond with ONLY valid JSON: {${isFirst ? '"thumbnail": {...}, ' : ''}"beats": [{"from": 0, "to": 1, "template": "...", "mood": "...", "kicker": "...", "params": {...}}, ...]}`,
    }],
  });
  return parseJSON(msg.content[0].text);
}

// sentences: [{i, text, dur, scene}], sectionStarts: Map(sentenceIndex → heading text)
async function buildStoryboard({ title, sentences, sectionStarts, reporter }) {
  const N = sentences.length;
  let raw = [];
  let thumbnail = null;
  if (process.env.ANTHROPIC_API_KEY && process.env.STORYBOARD !== 'fallback') {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = process.env.STORYBOARD_MODEL || 'claude-sonnet-4-6';
    const size = 40;
    const ranges = [];
    for (let a = 0; a < N; a += size) ranges.push([a, Math.min(N - 1, a + size - 1)]);
    // Don't leave a tiny final batch
    if (ranges.length > 1 && ranges[ranges.length - 1][1] - ranges[ranges.length - 1][0] < 8) { const last = ranges.pop(); ranges[ranges.length - 1][1] = last[1]; }
    let done = 0;
    const results = await Promise.all(ranges.map(async (range, k) => {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const r = await askClaude(anthropic, model, { title, sentences, range, sectionStarts, isFirst: k === 0, isLast: k === ranges.length - 1 });
          done++;
          reporter.progress((done / ranges.length) * 100, `Planned ${done} of ${ranges.length} parts`);
          return r;
        } catch (e) {
          if (attempt === 2) { reporter.log(`⚠️ Storyboard part ${k + 1} failed (${e.message}) — using simple visuals there`); return { beats: [] }; }
        }
      }
    }));
    results.forEach(r => { if (r && Array.isArray(r.beats)) raw.push(...r.beats); if (r && r.thumbnail && !thumbnail) thumbnail = r.thumbnail; });
  } else {
    reporter.log('No ANTHROPIC_API_KEY — using simple keyword visuals');
  }

  // ── validate & repair ──
  const beats = [];
  let next = 0, rejected = 0;
  raw = raw.filter(b => b && Number.isInteger(b.from) && Number.isInteger(b.to) && b.to >= b.from).sort((a, b) => a.from - b.from);
  for (const b of raw) {
    if (b.to < next) continue;                          // fully overlapped
    const from = Math.max(b.from, next);
    if (from > next) for (let i = next; i < from; i++) beats.push(fallbackBeat(i, i, sentences));   // gap
    const to = Math.min(b.to, N - 1);
    const clean = SANITIZE[b.template] ? SANITIZE[b.template](b.params || {}) : null;
    let beat = clean
      ? checkNumbers({ from, to, template: b.template, mood: MOODS.includes(b.mood) ? b.mood : 'explaining', kicker: str(b.kicker, 22) || undefined, params: clean }, sentences)
      : null;
    if (clean && !beat) rejected++;
    if (!beat) beat = fallbackBeat(from, to, sentences, MOODS.includes(b.mood) ? b.mood : 'explaining');
    beats.push(beat);
    next = to + 1;
    if (next >= N) break;
  }
  for (let i = next; i < N; i++) beats.push(fallbackBeat(i, i, sentences));

  // Section headings must open their section
  for (const [si, heading] of sectionStarts) {
    const k = beats.findIndex(b => b.from <= si && b.to >= si);
    if (k < 0) continue;
    const b = beats[k];
    if (b.from === si && b.template === 'heading') continue;
    const hp = headingParams(heading);
    const head = { from: si, to: si, template: 'heading', mood: 'pointing', params: { ...hp, icon: undefined } };
    const parts = [];
    if (b.from < si) parts.push({ ...b, to: si - 1 });
    parts.push(head);
    if (b.to > si) parts.push({ ...b, from: si + 1, kicker: b.kicker });
    beats.splice(k, 1, ...parts);
  }
  // Title first
  if (beats[0] && beats[0].template !== 'title') {
    const b = beats[0];
    const t = { from: 0, to: 0, template: 'title', mood: 'waving', params: { title, icon: 'coin' } };
    beats.splice(0, 1, t, ...(b.to > 0 ? [{ ...b, from: 1 }] : []));
  }
  // Outro last if the final beat is a call to action
  const last = beats[beats.length - 1];
  if (last && last.template !== 'outro' && /subscribe|comment|like this video|hit the bell|see you/i.test(sentences.slice(last.from, last.to + 1).map(s => s.text).join(' '))) {
    beats[beats.length - 1] = { from: last.from, to: last.to, template: 'outro', mood: 'waving', params: { text: 'New money tips every week' } };
  }
  // Characters wave at the start/end; keep moods sensible
  beats.forEach(b => { if (b.template === 'title' || b.template === 'outro') b.mood = 'waving'; });

  if (rejected) reporter.log(`Replaced ${rejected} beat(s) that showed numbers not in the narration`);
  const counts = {};
  beats.forEach(b => { counts[b.template] = (counts[b.template] || 0) + 1; });
  reporter.log(`Storyboard: ${beats.length} animated beats (${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(', ')})`);

  const th = thumbnail || {};
  return {
    beats,
    thumbnail: { text: str(th.text, 40) || title.replace(/\(.*?\)/g, '').split(/\s+/).slice(0, 4).join(' '), icon: icon(th.icon || 'piggy'), mood: MOODS.includes(th.mood) ? th.mood : 'surprised' },
  };
}

module.exports = { buildStoryboard, SANITIZE, num, numbersIn, checkNumbers };
