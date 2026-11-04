// Apna Motivation job: approved script → Hinglish voice (Kokoro) → long video (16:9) + Shorts (9:16)
// → YouTube: long video public now, Shorts scheduled one per day (or the configured gap).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { run, ffmpeg, duration, pool } = require('../proc');
const { longPhrases, shortPhrases } = require('./writer');

const RUNTIME = path.join(__dirname, 'runtime.html');
const FPS = 30;
const VOICE = process.env.MOTIVATION_VOICE || 'hm_psi';
const SPEED = parseFloat(process.env.MOTIVATION_SPEED || '1.0');

function loadPlaywright() { try { return require('playwright'); } catch { return require('playwright-core'); } }

// phrase list → timeline + segments (same layout logic used for the approved samples)
function layout(phrases, piece, v, person, total0) {
  const short = piece.mode === 'short';
  let t = short ? 0.4 : 0.8, prev = null;
  const lines = phrases.map(p => {
    const key = p.seg + ':' + (p.lesson ?? '');
    if (prev && key !== prev) t += short ? 0.35 : 0.8;
    const l = { ...p, start: t, end: t + p.dur };
    t = l.end + (p.seg === 'shloka' ? 0.5 : 0.22); prev = key; return l;
  });
  const total = t + (short ? 1.2 : 2.0);
  lines.forEach(l => {
    const ws = l.show.split(/\s+/).filter(Boolean); const tot = ws.reduce((a, w) => a + w.length + 1, 0) || 1; let c = 0;
    l.words = ws.map(w => { const t0 = l.start + (l.end - l.start) * (c / tot); c += w.length + 1; return { w, t0, t1: l.start + (l.end - l.start) * (c / tot) }; });
  });
  const groups = [];
  lines.forEach(l => { const g = groups[groups.length - 1]; const key = l.seg + ':' + (l.lesson ?? ''); if (g && g.key === key) g.lines.push(l); else groups.push({ key, seg: l.seg, lesson: l.lesson, lines: [l] }); });
  const isChanakya = /chanakya|चाणक्य|kautilya/i.test(person);
  const kicker = isChanakya ? 'CHANAKYA NITI' : person.toUpperCase();
  const segs = [];
  groups.forEach((g, gi) => {
    const start = g.lines[0].start - 0.3, end = gi + 1 < groups.length ? groups[gi + 1].lines[0].start - 0.35 : total;
    const L = g.lesson != null ? v.lessons[g.lesson] : null;
    if (g.seg === 'title') segs.push({ type: 'title', start, end, kicker, title: v.title.split('|')[0].trim() });
    if (g.seg === 'lesson') segs.push({ type: 'lesson', start, end, n: g.lesson + 1, label: 'LESSON', title: L.title });
    if (g.seg === 'shloka') segs.push({ type: 'shloka', start, end, source: L.ref, label: isChanakya ? '॥ श्लोक ॥' : '॥ विचार ॥', lines: g.lines.map(l => ({ text: l.show, at: l.start })) });
    if (g.seg === 'points' && L && L.points.length) {
      const items = L.points.map((p, i) => { const hit = g.lines.find(l => l.point === i); return { ...p, at: hit ? hit.start : null }; });
      const span = (g.lines[g.lines.length - 1].end - g.lines[0].start) / Math.max(1, items.length);
      items.forEach((it, i) => { if (it.at == null) it.at = g.lines[0].start + span * i; });
      items.sort((a, b) => a.at - b.at);
      segs.push({ type: 'points', start, end, items: short ? items.slice(0, 3) : items });
    }
    if (g.seg === 'stat' && L && L.stat) { const a = g.lines.find(l => l.stat) || g.lines[0]; segs.push({ type: 'stat', start, end, ...L.stat, at: a.start + 0.4 }); }
    if (g.seg === 'cta') {
      const all = g.lines.flatMap(l => l.words);
      const m = k => (all.find(w => w.w.toLowerCase().startsWith(k)) || { t0: start + 1 }).t0;
      const marks = [m('like'), m('share'), m('subscrib')].map((x, i, arr) => (i && x <= arr[i - 1] ? arr[i - 1] + 0.6 : x));
      segs.push({ type: 'cta', start, end, marks, head: short ? 'AISI AUR BAATEIN?' : 'BAAT ACHHI LAGI?' });
    }
  });
  if (short) segs.push({ type: 'hook', start: 0, end: total, text: piece.hook });
  const highlight = [...new Set(v.lessons.flatMap(l => l.points.map(p => p.key.toLowerCase().replace(/[^a-z0-9]/g, ''))).concat(['like', 'share', 'subscribe', person.toLowerCase().split(/\s+/)[0]]))];
  return { lines, total, segs, kicker, highlight };
}

async function renderPiece({ data, workDir, name, reporter, browser, frameCounter, totalFrames, started }) {
  const short = data.mode === 'short';
  const H = parseInt(process.env.OUTPUT_HEIGHT_ANIMATED || '1440', 10);
  const scale = H / 1080;                       // 1440p long, 1440x2560 Shorts
  const vp = short ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  const frames = Math.ceil(data.total * FPS);
  const CHUNK = 8 * FPS;
  const chunks = []; for (let f = 0; f < frames; f += CHUNK) chunks.push({ f0: f, f1: Math.min(frames, f + CHUNK), i: chunks.length });
  const dir = path.join(workDir, name); fs.mkdirSync(dir, { recursive: true });
  const pages = Math.max(1, Math.min(parseInt(process.env.RENDER_PAGES || '0', 10) || (os.cpus().length - 1), 4));
  const errors = [];
  const open = async () => {
    const p = await browser.newPage({ viewport: vp, deviceScaleFactor: scale });
    p.on('pageerror', e => errors.push(e.message));
    await p.goto('file://' + RUNTIME); await p.evaluate(() => document.fonts.ready);
    await p.evaluate(d => window.setData(d), data);
    return p;
  };
  const queue = [...chunks];
  await Promise.all(Array.from({ length: pages }, async () => {
    const page = await open();
    while (queue.length) {
      const c = queue.shift();
      c.file = path.join(dir, `c${String(c.i).padStart(4, '0')}.mp4`);
      const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
        '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'animation', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2), '-threads', '2', c.file], { stdio: ['pipe', 'ignore', 'pipe'] });
      let err = ''; ff.stderr.on('data', d => { err = (err + d).slice(-1500); });
      const closed = new Promise((res, rej) => ff.on('close', code => (code === 0 ? res() : rej(new Error('ffmpeg: ' + err.slice(-300))))));
      for (let f = c.f0; f < c.f1; f++) {
        await page.evaluate(t => window.render(t), f / FPS);
        const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
        if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
        frameCounter.n++;
        if (frameCounter.n % 60 === 0) {
          const rate = frameCounter.n / ((Date.now() - started) / 1000);
          const eta = Math.round((totalFrames - frameCounter.n) / Math.max(rate, 0.1));
          reporter.progress((frameCounter.n / totalFrames) * 92, `Animated ${Math.round((frameCounter.n / totalFrames) * 100)}% · ~${eta >= 60 ? Math.round(eta / 60) + ' min' : eta + 's'} left`);
        }
      }
      ff.stdin.end(); await closed;
    }
    await page.close();
  }));
  // thumbnail
  const tp = await browser.newPage({ viewport: vp, deviceScaleFactor: short ? 720 / 1080 : 1280 / 1920 });
  await tp.goto('file://' + RUNTIME); await tp.evaluate(() => document.fonts.ready);
  await tp.evaluate(d => window.setData(d), data);
  await tp.evaluate(text => window.renderThumbnail(text), data.thumbText);
  const thumbPath = path.join(dir, 'thumb.jpg');
  await tp.screenshot({ path: thumbPath, type: 'jpeg', quality: 92 }); await tp.close();
  if (errors.length) reporter.log(`⚠️ ${name}: ${errors.length} animation warning(s): ${errors[0]}`);
  const list = path.join(dir, 'list.txt'); fs.writeFileSync(list, chunks.map(c => `file '${c.file}'`).join('\n'));
  const silent = path.join(dir, 'video.mp4');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);
  const out = path.join(workDir, `${name}.mp4`);
  await ffmpeg(['-i', silent, '-i', path.join(dir, 'mix.wav'), '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]);
  return { videoPath: out, thumbPath };
}

async function processMotivationJob(job, reporter, { workDir, upload = true } = {}) {
  const v = job.motivation;
  if (!v || !v.lessons) throw new Error('Job has no motivation script');
  const person = job.person || (job.settings && job.settings.person) || 'Chanakya';
  const brand = (job.settings && job.settings.channelName) || 'Apna Motivation';
  const look = /chanakya|चाणक्य|kautilya/i.test(person) ? 'chanakya' : 'mentor';
  fs.mkdirSync(workDir, { recursive: true });

  // 1. Voice: every phrase of the long video and all Shorts in one Kokoro batch
  const pieces = [{ name: 'long', mode: 'long', phrases: longPhrases(v, person) }]
    .concat(v.shorts.map((s, i) => ({ name: `short${i + 1}`, mode: 'short', hook: s.hook, title: s.title, lesson: s.lesson, phrases: shortPhrases(v, s) })));
  const nPhr = pieces.reduce((a, p) => a + p.phrases.length, 0);
  await reporter.stage('voiceover', `${nPhr} lines · long video + ${v.shorts.length} Shorts`);
  const vdir = path.join(workDir, 'voice'); fs.mkdirSync(vdir, { recursive: true });
  const jobs = [];
  pieces.forEach(pc => pc.phrases.forEach((p, i) => { p.file = path.join(vdir, `${pc.name}_${i}.wav`); jobs.push({ text: p.speak, out: p.file, voice: VOICE, speed: p.seg === 'shloka' ? SPEED * 0.86 : SPEED, lang: 'hi' }); }));
  fs.writeFileSync(path.join(vdir, 'jobs.json'), JSON.stringify(jobs));
  await run('python3', [path.join(__dirname, '..', 'kokoro_tts.py'), path.join(vdir, 'jobs.json')], {
    timeoutMs: 40 * 60 * 1000,
    onStdout: out => { const m = out.match(/PROGRESS (\d+) (\d+)\s*$/m); if (m) reporter.progress((+m[1] / +m[2]) * 90, `Line ${m[1]} of ${m[2]}`); },
  });
  await pool(pieces.flatMap(pc => pc.phrases), 4, async p => { p.dur = await duration(p.file); });

  // 2. Timelines + soundtrack per piece
  for (const pc of pieces) {
    const lay = layout(pc.phrases, pc, v, person);
    const dir = path.join(workDir, pc.name); fs.mkdirSync(dir, { recursive: true });
    const chimes = lay.segs.filter(s => ['title', 'lesson', 'shloka'].includes(s.type)).map(s => s.start + 0.2);
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({ total: lay.total, lines: lay.lines.map(l => ({ file: l.file, start: l.start })), chimes }));
    await run('python3', [path.join(__dirname, 'mix.py'), path.join(dir, 'plan.json'), dir], { timeoutMs: 10 * 60 * 1000 });
    const env = JSON.parse(fs.readFileSync(path.join(dir, 'env.json'), 'utf8'));
    pc.lay = lay;
    pc.data = { mode: pc.mode, brand, look, kicker: lay.kicker, total: lay.total, segs: lay.segs, env, highlight: lay.highlight,
      thumbText: pc.mode === 'short' ? pc.hook : v.thumbnailText,
      phrases: lay.lines.map(({ file, dur, ...l }) => l) };
    fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(pc.data));   // for debugging / re-renders
  }
  reporter.log(`Voice ready: long ${(pieces[0].lay.total / 60).toFixed(1)} min + ${pieces.length - 1} Shorts (${pieces.slice(1).map(p => Math.round(p.lay.total) + 's').join(', ')})`);

  // 3. Animation
  await reporter.stage('rendering', `Animating the video and ${pieces.length - 1} Shorts`);
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ args: ['--disable-gpu', '--font-render-hinting=none'] });
  const totalFrames = pieces.reduce((a, p) => a + Math.ceil(p.lay.total * FPS), 0);
  const counter = { n: 0 }, started = Date.now();
  try {
    for (const pc of pieces) Object.assign(pc, await renderPiece({ data: pc.data, workDir, name: pc.name, reporter, browser, frameCounter: counter, totalFrames, started }));
  } finally { await browser.close().catch(() => {}); }
  const long = pieces[0];
  const sizeMB = +(fs.statSync(long.videoPath).size / 1048576).toFixed(1);
  const stats = { durationSec: Math.round(long.lay.total), sizeMB, shots: v.lessons.length, voice: 'kokoro', style: 'motivation', shorts: pieces.length - 1 };
  reporter.log(`Rendered: ${(long.lay.total / 60).toFixed(1)} min video (${sizeMB} MB) + ${pieces.length - 1} Shorts`);

  if (!upload) { await reporter.done('rendered', { stats }); return { outPath: long.videoPath, thumbPath: long.thumbPath, stats, pieces }; }
  const yt = require('../../youtube');
  if (!(await yt.isYouTubeConnected('motivation'))) {
    await reporter.done('rendered', { stats, note: 'Apna Motivation YouTube is not connected — download the MP4s from the render run.' });
    return { outPath: long.videoPath, thumbPath: long.thumbPath, stats, pieces };
  }

  // 4. Upload: long video now, Shorts scheduled
  await reporter.stage('uploading', `${sizeMB} MB + ${pieces.length - 1} Shorts`);
  const seo = require('../../seo');
  const isChanakya = look === 'chanakya';
  const tagHash = isChanakya ? ['#ChanakyaNiti', '#Motivation', '#HindiMotivation'] : ['#Motivation', '#HindiMotivation', '#LifeLessons'];
  const srt = pc => seo.toSrt(seo.cuesFromLines(pc.lay.lines.filter(l => !l.noCaption).map(l => ({ text: l.show, start: l.start, end: l.end }))));
  const refs = v.lessons.map((l, i) => `${i + 1}. ${l.title} — ${l.ref}`).join('\n');
  const playlist = { title: isChanakya ? 'Chanakya Niti | Apna Motivation' : `${person} | Apna Motivation`, description: `Genuine teachings of ${person}, explained for today's life.` };
  const longRes = await yt.uploadVideo(long.videoPath, {
    motivation: true, title: v.title, description: `${v.description}\n\n📜 Sources:\n${refs}`, tags: v.tags,
    searchQueries: v.searchQueries.length ? v.searchQueries : [`${person} motivation`],
    seoContext: `Hinglish motivation video explaining genuine teachings of ${person}: ${v.lessons.map(l => l.title).join('; ')}`,
    hashtags: tagHash, captions: [{ lang: 'hi-Latn', name: 'Hinglish', srt: srt(long) }], playlist,
  }, { channel: 'motivation', thumbnailPath: long.thumbPath, onProgress: p => reporter.progress(p * 0.6, `Uploading video ${p}%`), log: m => reporter.log(m) });
  reporter.log(`🎉 Video live: ${longRes.videoUrl}`);

  const gapH = Math.max(1, (job.settings && job.settings.shortsGapHours) || 24);
  const shortsOut = [];
  for (let i = 1; i < pieces.length; i++) {
    const pc = pieces[i];
    const publishAt = new Date(Date.now() + gapH * i * 3600000).toISOString();
    const L = v.lessons[pc.lesson];
    try {
      const r = await yt.uploadVideo(pc.videoPath, {
        motivation: true, title: (pc.title && /#shorts/i.test(pc.title) ? pc.title : `${pc.title || pc.hook} #Shorts`).slice(0, 100),
        description: `${pc.hook}\n\n📜 ${L.ref}\n\nFull video 👉 ${longRes.videoUrl}`, tags: (longRes.tags || v.tags).slice(0, 20),
        skipTagResearch: true, hashtags: ['#Shorts', ...tagHash.slice(0, 2)], playlist,
      }, { channel: 'motivation', thumbnailPath: null, publishAt, onProgress: p => reporter.progress(60 + (i - 1) * (40 / (pieces.length - 1)) + p * 0.4 / (pieces.length - 1), `Uploading Short ${i} ${p}%`), log: m => reporter.log(m) });
      shortsOut.push({ youtubeId: r.videoId, youtubeUrl: r.videoUrl, publishAt, title: pc.title });
      reporter.log(`📅 Short ${i} scheduled for ${new Date(publishAt).toUTCString()}: ${r.videoUrl}`);
    } catch (e) {
      reporter.log(`⚠️ Short ${i} upload failed: ${e.message.slice(0, 150)}`);
    }
  }
  await reporter.done('uploaded', { stats, youtubeId: longRes.videoId, youtubeUrl: longRes.videoUrl, uploadedAt: new Date().toISOString(), shorts: shortsOut });
  return { outPath: long.videoPath, thumbPath: long.thumbPath, stats, videoId: longRes.videoId, videoUrl: longRes.videoUrl };
}

module.exports = { processMotivationJob, layout };
