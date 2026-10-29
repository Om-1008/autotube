// Full render pipeline for one approved job:
// voiceover → footage → cut shots → captions + final encode → thumbnail → YouTube.
const fs = require('fs');
const path = require('path');
const { parseScript } = require('./scenes');
const { synthesize } = require('./tts');
const { planScenes, gatherFootage } = require('./footage');
const { buildASS, buildThumbASS } = require('./captions');
const { ffmpeg, ffmpegWithProgress, pool } = require('./proc');

// 1440p output: YouTube serves 1440p+ uploads with its higher-quality codec (VP9/AV1),
// which looks noticeably sharper than a 1080p upload even for 1080p viewers.
const H = parseInt(process.env.OUTPUT_HEIGHT || '1440', 10);
const W = Math.round((H * 16) / 9);
const FPS = 30;
const SHOT_SECONDS = 5.5;

// YouTube chapters from the real heading times: first at 0:00, at least 3, each >= 10s
function buildChapters(scenes, plan, starts, total) {
  const list = [{ t: 0, title: 'Intro' }];
  scenes.forEach((s, i) => {
    const heading = s.heading || (plan.scenes[i] && plan.scenes[i].heading) || '';
    if (!heading || i === 0) return;
    const t = Math.floor(starts[i]);
    if (t - list[list.length - 1].t >= 10 && total - t >= 10) list.push({ t, title: heading.slice(0, 60) });
  });
  return list.length >= 3 ? list : [];
}

async function processJob(job, reporter, { workDir, upload = true } = {}) {
  fs.mkdirSync(workDir, { recursive: true });
  fs.cpSync(path.join(__dirname, 'fonts'), path.join(workDir, 'fonts'), { recursive: true });
  const scriptText = job.script && job.script.script;
  if (!scriptText) throw new Error('Job has no script');
  const title = job.title || job.script.title || 'Personal Finance';
  const niche = (job.settings && job.settings.niche) || process.env.CHANNEL_NICHE || 'personal finance';

  // ── 1. Voiceover ──────────────────────────────────────────────────────────
  const scenes = parseScript(scriptText, title);
  if (!scenes.length) throw new Error('Could not find any narration in the script');
  await reporter.stage('voiceover', `${scenes.length} scenes, ${scenes.reduce((a, s) => a + s.sentences.length, 0)} sentences`);
  const tts = await synthesize(scenes, workDir, reporter);
  reporter.log(`Voiceover ready: ${(tts.totalDuration / 60).toFixed(1)} min`);

  // Scene time ranges (pauses belong to the scene before them)
  const starts = scenes.map((_, i) => (i === 0 ? 0 : tts.timeline.find(t => t.scene === i).start));
  const ranges = scenes.map((_, i) => [starts[i], i + 1 < scenes.length ? starts[i + 1] : tts.totalDuration]);
  const shotsPerScene = ranges.map(([a, b]) => Math.max(1, Math.round((b - a) / SHOT_SECONDS)));

  // ── 2. Footage ────────────────────────────────────────────────────────────
  await reporter.stage('footage', `Planning ${shotsPerScene.reduce((a, b) => a + b, 0)} shots`);
  const plan = await planScenes(scenes, { title, niche, reporter });
  const chapters = buildChapters(scenes, plan, starts, tts.totalDuration);
  if (chapters.length) reporter.log(`Chapters: ${chapters.map(c => c.title).join(' · ')}`);
  const footage = await gatherFootage(scenes, plan, shotsPerScene, { workDir, niche, reporter });

  // ── 3. Cut shots ──────────────────────────────────────────────────────────
  await reporter.stage('rendering', 'Cutting shots to the voiceover');
  const shots = [];
  ranges.forEach(([a, b], si) => {
    const f0 = Math.round(a * FPS);
    const f1 = Math.round(b * FPS);
    const n = shotsPerScene[si];
    for (let k = 0; k < n; k++) {
      const s = f0 + Math.round(((f1 - f0) * k) / n);
      const e = f0 + Math.round(((f1 - f0) * (k + 1)) / n);
      if (e > s) shots.push({ si, k, frames: e - s, clip: footage[si][k % footage[si].length] });
    }
  });

  const useCount = new Map();
  const segDir = path.join(workDir, 'segs');
  fs.mkdirSync(segDir, { recursive: true });
  let cut = 0;
  await pool(shots, 3, async (shot, i) => {
    const secs = shot.frames / FPS;
    const n = useCount.get(shot.clip.id) || 0;
    useCount.set(shot.clip.id, n + 1);
    const usable = Math.max(0, (shot.clip.clipDuration || 10) - secs - 0.5);
    const offset = usable > 0 ? (0.3 + n * secs) % usable : 0;
    // Slow pan (alternating direction) keeps static stock shots alive
    const dir = i % 2 === 0 ? `(iw-ow)*min(t/${secs.toFixed(2)},1)` : `(iw-ow)*(1-min(t/${secs.toFixed(2)},1))`;
    shot.file = path.join(segDir, `seg${String(i).padStart(4, '0')}.mp4`);
    await ffmpeg([
      '-ss', offset.toFixed(2), '-stream_loop', '-1', '-i', shot.clip.file,
      '-frames:v', String(shot.frames),
      '-vf', `scale=${Math.round(W * 1.05)}:${Math.round(H * 1.05)}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}:x='${dir}':y='(ih-oh)/2',setsar=1,fps=${FPS},eq=saturation=1.08,format=yuv420p`,
      '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '15', '-r', String(FPS), shot.file,
    ]);
    cut++;
    reporter.progress((cut / shots.length) * 30, `Cut shot ${cut} of ${shots.length}`);
  });

  // ── 4. Captions + final encode ────────────────────────────────────────────
  fs.writeFileSync(path.join(workDir, 'captions.ass'), buildASS({
    timeline: tts.timeline, scenes, plan, title, totalDuration: tts.totalDuration, width: W, height: H,
  }));
  fs.writeFileSync(path.join(workDir, 'segs.txt'), shots.map(s => `file '${s.file}'`).join('\n'));
  reporter.log('Burning captions and mixing audio');
  const outPath = path.join(workDir, 'final.mp4');
  await ffmpegWithProgress([
    '-f', 'concat', '-safe', '0', '-i', 'segs.txt',
    '-i', 'voiceover.wav',
    '-filter_complex', '[0:v]ass=captions.ass:fontsdir=fonts[v];[1:a]loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000[a]',
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2),
    '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart',
    'final.mp4',
  ], tts.totalDuration, p => reporter.progress(30 + p * 0.65, `Encoding video ${Math.round(p)}%`), { cwd: workDir })
    .catch(e => { throw new Error('Final encode failed: ' + e.message); });
  const sizeMB = +(fs.statSync(outPath).size / 1048576).toFixed(1);

  // ── 5. Thumbnail ──────────────────────────────────────────────────────────
  const thumbPath = path.join(workDir, 'thumbnail.jpg');
  try {
    fs.writeFileSync(path.join(workDir, 'thumb.ass'), buildThumbASS(plan.thumbnailText || title));
    const src = shots[Math.min(1, shots.length - 1)].file;
    await ffmpeg([
      '-ss', '1', '-i', src, '-frames:v', '1',
      '-vf', 'scale=1280:720,eq=brightness=-0.08:saturation=1.25:contrast=1.08,drawbox=x=0:y=0:w=iw*0.66:h=ih:color=black@0.45:t=fill,ass=thumb.ass:fontsdir=fonts',
      '-q:v', '2', 'thumbnail.jpg',
    ], { cwd: workDir });
  } catch (e) {
    reporter.log(`Thumbnail failed (${e.message}) — YouTube will auto-pick one`);
  }
  reporter.log(`Video rendered: ${(tts.totalDuration / 60).toFixed(1)} min, ${sizeMB} MB, ${shots.length} shots`);

  const stats = { durationSec: Math.round(tts.totalDuration), sizeMB, shots: shots.length, voice: tts.engine };

  // ── 6. Upload ─────────────────────────────────────────────────────────────
  if (!upload) {
    await reporter.done('rendered', { stats });
    return { outPath, thumbPath, stats };
  }
  const yt = require('../youtube');
  if (!(await yt.isYouTubeConnected())) {
    await reporter.done('rendered', { stats, note: 'YouTube is not connected — download the MP4 from the render run.' });
    return { outPath, thumbPath, stats };
  }
  await reporter.stage('uploading', `${sizeMB} MB`);
  const links = ((job.settings && job.settings.affiliateLinks) || []).filter(l => l && l.name && /^https?:\/\//.test(l.url || ''));
  const { videoId, videoUrl, thumbnailSet } = await yt.uploadVideo(outPath, { ...job.script, title, chapters, links }, {
    thumbnailPath: fs.existsSync(thumbPath) ? thumbPath : null,
    onProgress: p => reporter.progress(p, `Uploaded ${p}%`),
  });
  if (!thumbnailSet) reporter.log('Custom thumbnail not applied (needs a phone-verified YouTube channel)');
  reporter.log(`🎉 Live on YouTube: ${videoUrl}`);
  await reporter.done('uploaded', { stats, youtubeId: videoId, youtubeUrl: videoUrl, uploadedAt: new Date().toISOString() });
  return { outPath, thumbPath, stats, videoId, videoUrl };
}

module.exports = { processJob };
