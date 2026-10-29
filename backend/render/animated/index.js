// Animated renderer: films runtime.html beat by beat in parallel headless-browser pages.
// Each beat becomes its own MP4 (identical encoder settings), joined with the concat
// demuxer and -c copy; the voiceover is added last with -c:v copy.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ffmpeg, pool } = require('../proc');
const { chunkSentence } = require('../captions');

const RUNTIME = path.join(__dirname, 'runtime.html');
const FPS = 30;

function loadPlaywright() {
  try { return require('playwright'); } catch { /* fall through */ }
  return require('playwright-core');
}

const norm = w => w.toLowerCase().replace(/[^a-z0-9$%]/g, '');
const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const highlight = s => escapeHtml(s).replace(/(\$?\d[\d,]*(?:\.\d+)?\s?(?:%|k\b|percent)?)/gi, '<b>$1</b>');

// sentences: [{i, text, start, end}] in global seconds
function captionChunks(sentences) {
  const out = [];
  for (const s of sentences) {
    const chunks = chunkSentence(s.text, 6, 34);
    const total = chunks.reduce((a, c) => a + c.length + 6, 0);
    let t = s.start;
    for (const c of chunks) {
      const d = (s.end - s.start) * ((c.length + 6) / total);
      out.push({ a: t, b: t + d, html: highlight(c.toUpperCase()) });
      t += d;
    }
  }
  return out;
}

function wordTimes(sentences, from, to, beatStart) {
  const words = [];
  for (let i = from; i <= to; i++) {
    const s = sentences[i];
    const parts = s.text.split(/\s+/);
    const total = s.text.length || 1;
    let offset = 0;
    for (const w of parts) {
      words.push({ w: norm(w), t: s.start + (s.end - s.start) * (offset / total) - beatStart });
      offset += w.length + 1;
    }
  }
  return words;
}

function layoutBeats(storyboard, sentences, totalDuration, brand) {
  const caps = captionChunks(sentences);
  const beats = storyboard.beats.map((b, k) => ({ ...b, start: k === 0 ? 0 : sentences[b.from].start }));
  beats.forEach((b, k) => {
    b.end = k + 1 < beats.length ? beats[k + 1].start : totalDuration;
    b.T = Math.max(0.2, b.end - b.start);
    b.f0 = Math.round(b.start * FPS);
    b.f1 = Math.round(b.end * FPS);
    b.words = wordTimes(sentences, b.from, b.to, b.start);
    b.captions = caps.filter(c => c.b > b.start && c.a < b.end);
    b.brand = brand;
    b.kickerColor = undefined;
    b.wipeIn = b.template === 'heading' && k > 0;
    b.wipeOut = k + 1 < beats.length && beats[k + 1].template === 'heading';
    b.fallbackText = sentences[b.from].text.split(/\s+/).slice(0, 5).join(' ');
  });
  return beats.filter(b => b.f1 > b.f0);
}

async function renderAnimated({ storyboard, sentences, totalDuration, brand = 'WealthSutra', workDir, reporter, width = 1920, height = 1080 }) {
  const { chromium } = loadPlaywright();
  const segDir = path.join(workDir, 'beats');
  fs.mkdirSync(segDir, { recursive: true });
  const beats = layoutBeats(storyboard, sentences, totalDuration, brand);
  const totalFrames = beats.reduce((a, b) => a + (b.f1 - b.f0), 0);
  const pages = Math.max(1, Math.min(parseInt(process.env.RENDER_PAGES || '0', 10) || (os.cpus().length - 1), 4));
  reporter.log(`Animating ${beats.length} beats (${totalFrames.toLocaleString()} frames) on ${pages} parallel renderers`);

  const browser = await chromium.launch({ args: ['--disable-gpu', '--font-render-hinting=none'] });
  const pageErrors = [];
  let framesDone = 0;
  const started = Date.now();
  try {
    // Longest beats first so parallel renderers finish together
    const order = beats.map((b, i) => i).sort((a, b) => (beats[b].f1 - beats[b].f0) - (beats[a].f1 - beats[a].f0));
    const queue = [...order];
    await Promise.all(Array.from({ length: pages }, async () => {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: width / 1920 });
      page.on('pageerror', e => pageErrors.push(e.message));
      await page.goto('file://' + RUNTIME);
      await page.evaluate(() => document.fonts.ready);
      while (queue.length) {
        const bi = queue.shift();
        const b = beats[bi];
        const file = path.join(segDir, `beat${String(bi).padStart(4, '0')}.mp4`);
        const tmp = file.replace(/\.mp4$/, '.part.mp4');
        const { words, captions, ...rest } = b;
        await page.evaluate(beat => window.setBeat(beat), { ...rest, words, captions });
        const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
          '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2), '-threads', '2', tmp],
        { stdio: ['pipe', 'ignore', 'pipe'] });
        let ffErr = '';
        ff.stderr.on('data', d => { ffErr = (ffErr + d).slice(-2000); });
        const closed = new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg: ' + ffErr.trim().slice(-300))))));
        for (let f = b.f0; f < b.f1; f++) {
          await page.evaluate(t => window.render(t), f / FPS - b.start);
          const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
          if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
          framesDone++;
          if (framesDone % 30 === 0) {
            const rate = framesDone / ((Date.now() - started) / 1000);
            const eta = Math.round((totalFrames - framesDone) / Math.max(rate, 0.1));
            reporter.progress((framesDone / totalFrames) * 90, `Animated ${Math.round((framesDone / totalFrames) * 100)}% · ~${eta >= 60 ? Math.round(eta / 60) + ' min' : eta + 's'} left`);
          }
        }
        ff.stdin.end();
        await closed;
        fs.renameSync(tmp, file);
        b.file = file;
      }
      await page.close();
    }));

    // Thumbnail (1280×720)
    const tp = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await tp.goto('file://' + RUNTIME);
    await tp.evaluate(() => document.fonts.ready);
    await tp.evaluate(o => window.renderThumbnail(o), { ...storyboard.thumbnail, brand });
    const thumbPath = path.join(workDir, 'thumbnail.jpg');
    await tp.screenshot({ path: thumbPath, type: 'jpeg', quality: 92 });
    await tp.close();

    if (pageErrors.length) reporter.log(`⚠️ ${pageErrors.length} animation warning(s): ${pageErrors[0]}`);

    const list = path.join(workDir, 'beats.txt');
    fs.writeFileSync(list, beats.map(b => `file '${b.file}'`).join('\n'));
    const videoPath = path.join(workDir, 'video_only.mp4');
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', videoPath]);

    const fps = framesDone / ((Date.now() - started) / 1000);
    reporter.log(`Animation done: ${framesDone.toLocaleString()} frames at ${fps.toFixed(1)} fps`);
    return { videoPath, thumbPath, beats };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { renderAnimated, layoutBeats };
