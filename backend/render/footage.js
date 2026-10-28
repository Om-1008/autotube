// Stock footage: plan search queries per scene (Claude, with a heuristic fallback),
// search Pixabay videos, and download distinct clips.
// FOOTAGE=test generates synthetic clips (for offline testing).
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { ffmpeg, pool } = require('./proc');

const STOP = new Set('a an the of on in at to for with and or but is are was were be being been this that these those some any each very quick quickly cuts cut shot shots footage close closeup close-up up showing shows show person people someone screen b-roll broll montage scene camera slow motion view various different multiple text overlay animation animated graphic graphics'.split(' '));

function heuristicQueries(scene, niche) {
  const src = scene.broll || scene.text.slice(0, 160);
  const phrases = src.split(/[,;.]|\band\b|\bor\b/i)
    .map(p => p.toLowerCase().replace(/[^a-z0-9\s$-]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w)).slice(0, 3).join(' '))
    .filter(p => p.length > 2);
  const out = [...new Set(phrases)].slice(0, 3);
  if (!out.length) out.push(niche.split(' ')[0] || 'money');
  return out;
}

async function planScenes(scenes, { title, niche, reporter }) {
  const fallback = () => ({
    thumbnailText: title.replace(/\(.*?\)/g, '').replace(/^how to\s+/i, '').split(/\s+/).slice(0, 5).join(' ').toUpperCase(),
    scenes: scenes.map(s => ({ queries: heuristicQueries(s, niche), heading: '' })),
  });
  if (!process.env.ANTHROPIC_API_KEY) {
    reporter.log('No ANTHROPIC_API_KEY on render server — using keyword search for footage');
    return fallback();
  }
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const input = scenes.map(s => ({ i: s.index, broll: s.broll, narration: s.text.slice(0, 260) }));
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `You are a video editor choosing stock footage for a ${niche} YouTube video titled "${title}".

For EACH scene below, give 3 stock-video search queries for Pixabay. Rules:
- 1 to 3 words each, concrete and visual (objects, people doing things, places): e.g. "credit card payment", "stressed woman bills", "piggy bank coins", "city traffic"
- No abstract ideas, no brand names, no on-screen text, no numbers
- Vary them across scenes so the video doesn't repeat the same shots
Also give "heading": a short on-screen section title (max 5 words, e.g. "Step 1: Know Your Number") ONLY if that scene begins a new step/section; otherwise "".

Finally give "thumbnailText": 2-4 punchy words for the thumbnail, ALL CAPS (e.g. "$1,000 IN 90 DAYS").

Scenes:
${JSON.stringify(input)}

Respond with ONLY valid JSON: {"thumbnailText":"...","scenes":[{"i":0,"queries":["..","..",".."],"heading":""}, ...]}`,
      }],
    });
    const raw = msg.content[0].text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const fb = fallback();
    return {
      thumbnailText: String(parsed.thumbnailText || fb.thumbnailText).slice(0, 40),
      scenes: scenes.map((s, k) => {
        const p = (parsed.scenes || []).find(x => x.i === s.index) || {};
        const q = (Array.isArray(p.queries) ? p.queries : []).map(String).filter(Boolean).slice(0, 3);
        return { queries: q.length ? q : fb.scenes[k].queries, heading: String(p.heading || '').slice(0, 60) };
      }),
    };
  } catch (e) {
    reporter.log(`Footage planning with Claude failed (${e.message}) — using keyword search`);
    return fallback();
  }
}

const searchCache = new Map();
let lastSearch = 0;

async function searchPixabay(query) {
  if (searchCache.has(query)) return searchCache.get(query);
  const wait = 650 - (Date.now() - lastSearch);       // stay under 100 req/min
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastSearch = Date.now();
  let hits = [];
  try {
    const res = await axios.get('https://pixabay.com/api/videos/', {
      params: { key: process.env.PIXABAY_API_KEY, q: query.slice(0, 100), per_page: 20, safesearch: true, video_type: 'film' },
      timeout: 20000,
    });
    hits = (res.data.hits || [])
      .filter(h => h.duration >= 4)
      .map(h => {
        const v = h.videos || {};
        const pick = [v.large, v.medium, v.small].find(r => r && r.url && r.width >= 1280 && r.width <= 1920 && (!r.size || r.size < 60e6))
          || [v.medium, v.large, v.small].find(r => r && r.url);
        return pick ? { id: h.id, url: pick.url, width: pick.width, duration: h.duration, tags: h.tags } : null;
      })
      .filter(Boolean);
  } catch (e) {
    if (e.response && e.response.status === 429) await new Promise(r => setTimeout(r, 15000));
    hits = [];
  }
  searchCache.set(query, hits);
  return hits;
}

async function makeTestClip(file, i) {
  const colors = ['0x1e3a8a', '0x065f46', '0x7c2d12', '0x581c87', '0x0f766e', '0x9a3412'];
  await ffmpeg(['-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30,hue=s=0.4,drawbox=c=${colors[i % colors.length]}@0.55:t=fill`, '-t', '12', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file]);
}

// segmentsPerScene: number[] → per scene, a list of { file, clipDuration }
async function gatherFootage(scenes, plan, segmentsPerScene, { workDir, niche, reporter }) {
  const dir = path.join(workDir, 'clips');
  fs.mkdirSync(dir, { recursive: true });
  const test = process.env.FOOTAGE === 'test' || !process.env.PIXABAY_API_KEY;
  if (!process.env.PIXABAY_API_KEY && process.env.FOOTAGE !== 'test') {
    throw new Error('PIXABAY_API_KEY is not set on the render server');
  }

  const used = new Set();
  const generic = [`${niche}`, 'money', 'saving money', 'business city', 'laptop work', 'calculator finance', 'coins', 'shopping'];
  const picks = [];   // per scene: array of hits

  for (let si = 0; si < scenes.length; si++) {
    const need = segmentsPerScene[si];
    const chosen = [];
    if (test) {
      for (let k = 0; k < need; k++) chosen.push({ id: `t${si}_${k}`, test: true, duration: 12 });
    } else {
      const queries = [...plan.scenes[si].queries, ...generic];
      for (const q of queries) {
        if (chosen.length >= need) break;
        const hits = await searchPixabay(q);
        for (const h of hits) {
          if (chosen.length >= need) break;
          if (!used.has(h.id)) { used.add(h.id); chosen.push(h); }
        }
      }
      // Not enough distinct clips: reuse this scene's (different offsets are used later)
      for (let k = 0; chosen.length && chosen.length < need; k++) chosen.push(chosen[k % chosen.length]);
    }
    picks.push(chosen);
    reporter.progress(((si + 1) / scenes.length) * 40, `Searched footage for scene ${si + 1} of ${scenes.length}`);
  }

  // Download unique clips
  const unique = [...new Map(picks.flat().map(h => [h.id, h])).values()];
  if (!unique.length) throw new Error('No stock footage found — check PIXABAY_API_KEY');
  reporter.log(`Downloading ${unique.length} stock clips`);
  let done = 0;
  const files = new Map();
  await pool(unique, 4, async (h, i) => {
    const file = path.join(dir, `${h.id}.mp4`);
    if (h.test) await makeTestClip(file, i);
    else {
      const res = await axios.get(h.url, { responseType: 'stream', timeout: 120000 });
      await new Promise((resolve, reject) => {
        const w = fs.createWriteStream(file);
        res.data.pipe(w); w.on('finish', resolve); w.on('error', reject); res.data.on('error', reject);
      });
    }
    files.set(h.id, file);
    done++;
    reporter.progress(40 + (done / unique.length) * 60, `Downloaded ${done} of ${unique.length} clips`);
  });

  return picks.map(list => list.map(h => ({ file: files.get(h.id), clipDuration: h.duration, id: h.id })));
}

module.exports = { planScenes, gatherFootage };
