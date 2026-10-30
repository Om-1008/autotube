// Films story/runtime.html: the timeline is split into chunks rendered by parallel headless
// pages (render(t) is a pure function of time), each chunk → MP4, joined with -c copy,
// then the mixed soundtrack is added.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ffmpeg } = require('../proc');

const RUNTIME = path.join(__dirname, 'runtime.html');
const FPS = 30;
const CHUNK = 8; // seconds

function loadPlaywright() {
  try { return require('playwright'); } catch { /* fall through */ }
  return require('playwright-core');
}

async function renderStory({ story, audio, brand, workDir, reporter, width = 2560 }) {
  const { chromium } = loadPlaywright();
  const segDir = path.join(workDir, 'chunks');
  fs.mkdirSync(segDir, { recursive: true });
  const totalFrames = Math.ceil(audio.total * FPS);
  const chunks = [];
  for (let f = 0; f < totalFrames; f += CHUNK * FPS) chunks.push({ f0: f, f1: Math.min(totalFrames, f + CHUNK * FPS), i: chunks.length });
  const pages = Math.max(1, Math.min(parseInt(process.env.RENDER_PAGES || '0', 10) || (os.cpus().length - 1), 4));
  reporter.log(`Animating ${Math.round(audio.total)}s story (${totalFrames.toLocaleString()} frames) on ${pages} parallel renderers`);
  const data = { story, lines: audio.lines.map(({ file, ...l }) => l), env: audio.env, total: audio.total, brand };

  const browser = await chromium.launch({ args: ['--disable-gpu', '--font-render-hinting=none'] });
  const pageErrors = [];
  let framesDone = 0;
  const started = Date.now();
  const openPage = async (vw, vh, scale) => {
    const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: scale });
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.goto('file://' + RUNTIME);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(d => window.setData(d), data);
    return page;
  };
  try {
    const queue = [...chunks];
    await Promise.all(Array.from({ length: pages }, async () => {
      const page = await openPage(1920, 1080, width / 1920);
      while (queue.length) {
        const c = queue.shift();
        const file = path.join(segDir, `c${String(c.i).padStart(4, '0')}.mp4`);
        const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
          '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
          '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'animation', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2), '-threads', '2', file],
        { stdio: ['pipe', 'ignore', 'pipe'] });
        let ffErr = '';
        ff.stderr.on('data', d => { ffErr = (ffErr + d).slice(-2000); });
        const closed = new Promise((res, rej) => ff.on('close', code => (code === 0 ? res() : rej(new Error('ffmpeg: ' + ffErr.trim().slice(-300))))));
        for (let f = c.f0; f < c.f1; f++) {
          await page.evaluate(t => window.render(t), f / FPS);
          const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
          if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
          framesDone++;
          if (framesDone % 30 === 0) {
            const rate = framesDone / ((Date.now() - started) / 1000);
            const eta = Math.round((totalFrames - framesDone) / Math.max(rate, 0.1));
            reporter.progress((framesDone / totalFrames) * 92, `Animated ${Math.round((framesDone / totalFrames) * 100)}% · ~${eta >= 60 ? Math.round(eta / 60) + ' min' : eta + 's'} left`);
          }
        }
        ff.stdin.end();
        await closed;
        c.file = file;
      }
      await page.close();
    }));

    // Thumbnail 1280×720
    const tp = await openPage(1920, 1080, 2 / 3);
    await tp.evaluate(() => window.renderThumbnail());
    const thumbPath = path.join(workDir, 'thumbnail.jpg');
    await tp.screenshot({ path: thumbPath, type: 'jpeg', quality: 92 });
    await tp.close();
    if (pageErrors.length) reporter.log(`⚠️ ${pageErrors.length} animation warning(s): ${pageErrors[0]}`);

    const list = path.join(workDir, 'chunks.txt');
    fs.writeFileSync(list, chunks.map(c => `file '${c.file}'`).join('\n'));
    const silent = path.join(workDir, 'video_only.mp4');
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);
    const videoPath = path.join(workDir, 'story.mp4');
    await ffmpeg(['-i', silent, '-i', audio.mixPath, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', videoPath]);
    reporter.log(`Animation done: ${framesDone.toLocaleString()} frames at ${(framesDone / ((Date.now() - started) / 1000)).toFixed(1)} fps`);
    return { videoPath, thumbPath };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { renderStory };
