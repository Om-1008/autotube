// Full render pipeline for one approved job:
// voiceover → visuals (2D animation by default, or stock footage) → thumbnail → YouTube.
const fs = require('fs');
const path = require('path');
const { parseScript } = require('./scenes');
const { synthesize } = require('./tts');
const { ffmpeg, ffmpegWithProgress, pool } = require('./proc');

const FPS = 30;
const STYLE = () => (process.env.VISUAL_STYLE || 'animated').toLowerCase();

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

  // ── 2–4. Visuals ──────────────────────────────────────────────────────────
  const ctx = { job, title, niche, scenes, tts, workDir, reporter };
  const r = STYLE() === 'footage' ? await footageVideo(ctx) : await animatedVideo(ctx);
  const { outPath, thumbPath, chapters } = r;
  const sizeMB = +(fs.statSync(outPath).size / 1048576).toFixed(1);
  reporter.log(`Video rendered: ${(tts.totalDuration / 60).toFixed(1)} min, ${sizeMB} MB`);
  if (chapters.length) reporter.log(`Chapters: ${chapters.map(c => c.title).join(' · ')}`);
  const stats = { durationSec: Math.round(tts.totalDuration), sizeMB, shots: r.shots, voice: tts.engine, style: STYLE() };

  // ── 5. Upload ─────────────────────────────────────────────────────────────
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

// ═════════════════════ 2D animated explainer (default) ═════════════════════
async function animatedVideo({ job, title, scenes, tts, workDir, reporter }) {
  const { buildStoryboard } = require('./animated/storyboard');
  const { renderAnimated } = require('./animated');

  const sentences = tts.timeline.map((s, i) => ({ i, text: s.text, start: s.start, end: s.end, dur: s.end - s.start, scene: s.scene }));
  const sectionStarts = new Map();
  scenes.forEach((s, si) => {
    if (!s.heading) return;
    const first = sentences.find(x => x.scene === si);
    if (first && first.i > 0) sectionStarts.set(first.i, s.heading);
  });

  await reporter.stage('visuals', `Storyboarding ${sentences.length} sentences`);
  const storyboard = await buildStoryboard({ title, sentences, sectionStarts, reporter });

  await reporter.stage('rendering', `Animating ${storyboard.beats.length} beats`);
  // 1440p: YouTube streams 1440p+ uploads with VP9/AV1 at a much higher bitrate, so text and
  // flat graphics stay crisp even for 1080p viewers (1080p uploads get soft H.264 streams)
  const H = parseInt(process.env.OUTPUT_HEIGHT_ANIMATED || '1440', 10);
  const brand = process.env.CHANNEL_NAME || 'WealthSutra';
  const { videoPath, thumbPath, beats } = await renderAnimated({
    storyboard, sentences, totalDuration: tts.totalDuration, brand, workDir, reporter,
    width: Math.round((H * 16) / 9), height: H,
  });

  reporter.log('Adding the voiceover');
  const outPath = path.join(workDir, 'final.mp4');
  await ffmpeg([
    '-i', videoPath, '-i', path.join(workDir, 'voiceover.wav'),
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
    '-af', 'loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000',
    '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', outPath,
  ]);
  reporter.progress(100, 'Done');

  // Chapters from heading beats
  const chapters = [{ t: 0, title: 'Intro' }];
  for (const b of beats) {
    if (b.template !== 'heading') continue;
    const t = Math.floor(b.start);
    const name = [b.params.kicker, b.params.title].filter(Boolean).join(': ').slice(0, 60);
    if (t - chapters[chapters.length - 1].t >= 10 && tts.totalDuration - t >= 10) chapters.push({ t, title: name });
  }
  return { outPath, thumbPath, chapters: chapters.length >= 3 ? chapters : [], shots: beats.length };
}

// ═════════════════════ Stock footage (VISUAL_STYLE=footage) ═════════════════════
async function footageVideo({ title, niche, scenes, tts, workDir, reporter }) {
  const { planScenes, gatherFootage } = require('./footage');
  const { buildASS, buildThumbASS } = require('./captions');
  const H = parseInt(process.env.OUTPUT_HEIGHT || '1440', 10);
  const W = Math.round((H * 16) / 9);
  const SHOT_SECONDS = 5.5;

  const starts = scenes.map((_, i) => (i === 0 ? 0 : tts.timeline.find(t => t.scene === i).start));
  const ranges = scenes.map((_, i) => [starts[i], i + 1 < scenes.length ? starts[i + 1] : tts.totalDuration]);
  const shotsPerScene = ranges.map(([a, b]) => Math.max(1, Math.round((b - a) / SHOT_SECONDS)));

  await reporter.stage('visuals', `Planning ${shotsPerScene.reduce((a, b) => a + b, 0)} shots`);
  const plan = await planScenes(scenes, { title, niche, reporter });
  const chapters = [{ t: 0, title: 'Intro' }];
  scenes.forEach((s, i) => {
    const heading = s.heading || (plan.scenes[i] && plan.scenes[i].heading) || '';
    const t = Math.floor(starts[i]);
    if (heading && i > 0 && t - chapters[chapters.length - 1].t >= 10 && tts.totalDuration - t >= 10) chapters.push({ t, title: heading.slice(0, 60) });
  });
  const footage = await gatherFootage(scenes, plan, shotsPerScene, { workDir, niche, reporter });

  await reporter.stage('rendering', 'Cutting shots to the voiceover');
  const shots = [];
  ranges.forEach(([a, b], si) => {
    const f0 = Math.round(a * FPS), f1 = Math.round(b * FPS), n = shotsPerScene[si];
    for (let k = 0; k < n; k++) {
      const s = f0 + Math.round(((f1 - f0) * k) / n), e = f0 + Math.round(((f1 - f0) * (k + 1)) / n);
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
    const dir = i % 2 === 0 ? `(iw-ow)*min(t/${secs.toFixed(2)},1)` : `(iw-ow)*(1-min(t/${secs.toFixed(2)},1))`;
    shot.file = path.join(segDir, `seg${String(i).padStart(4, '0')}.mp4`);
    await ffmpeg([
      '-ss', offset.toFixed(2), '-stream_loop', '-1', '-i', shot.clip.file, '-frames:v', String(shot.frames),
      '-vf', `scale=${Math.round(W * 1.05)}:${Math.round(H * 1.05)}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}:x='${dir}':y='(ih-oh)/2',setsar=1,fps=${FPS},eq=saturation=1.08,format=yuv420p`,
      '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '15', '-r', String(FPS), shot.file,
    ]);
    cut++;
    reporter.progress((cut / shots.length) * 30, `Cut shot ${cut} of ${shots.length}`);
  });

  fs.writeFileSync(path.join(workDir, 'captions.ass'), buildASS({ timeline: tts.timeline, scenes, plan, title, totalDuration: tts.totalDuration, width: W, height: H }));
  fs.writeFileSync(path.join(workDir, 'segs.txt'), shots.map(s => `file '${s.file}'`).join('\n'));
  reporter.log('Burning captions and mixing audio');
  const outPath = path.join(workDir, 'final.mp4');
  await ffmpegWithProgress([
    '-f', 'concat', '-safe', '0', '-i', 'segs.txt', '-i', 'voiceover.wav',
    '-filter_complex', '[0:v]ass=captions.ass:fontsdir=fonts[v];[1:a]loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000[a]',
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2),
    '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', 'final.mp4',
  ], tts.totalDuration, p => reporter.progress(30 + p * 0.65, `Encoding video ${Math.round(p)}%`), { cwd: workDir })
    .catch(e => { throw new Error('Final encode failed: ' + e.message); });

  const thumbPath = path.join(workDir, 'thumbnail.jpg');
  try {
    fs.writeFileSync(path.join(workDir, 'thumb.ass'), buildThumbASS(plan.thumbnailText || title));
    await ffmpeg(['-ss', '1', '-i', shots[Math.min(1, shots.length - 1)].file, '-frames:v', '1',
      '-vf', 'scale=1280:720,eq=brightness=-0.08:saturation=1.25:contrast=1.08,drawbox=x=0:y=0:w=iw*0.66:h=ih:color=black@0.45:t=fill,ass=thumb.ass:fontsdir=fonts',
      '-q:v', '2', 'thumbnail.jpg'], { cwd: workDir });
  } catch (e) {
    reporter.log(`Thumbnail failed (${e.message}) — YouTube will auto-pick one`);
  }
  return { outPath, thumbPath, chapters: chapters.length >= 3 ? chapters : [], shots: shots.length };
}

module.exports = { processJob };
