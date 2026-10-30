// Story audio: one voice clip per line (narrator + character voices), laid out on a timeline
// with pauses for questions and scene changes, then mixed with music and sound effects.
const fs = require('fs');
const path = require('path');
const { run, ffmpeg, duration, pool } = require('../proc');

// Kokoro Hindi voices + speed + pitch shift → distinct, child-friendly characters
const PRESETS = {
  narrator: { voice: 'hm_omega', speed: 0.92, pitch: 1.0 },
  child: { voice: 'hf_beta', speed: 1.04, pitch: 1.22 },
  child_m: { voice: 'hm_psi', speed: 1.05, pitch: 1.3 },
  tiny: { voice: 'hf_beta', speed: 1.1, pitch: 1.42 },
  deep: { voice: 'hm_psi', speed: 0.86, pitch: 0.82 },
  deep_soft: { voice: 'hm_omega', speed: 0.88, pitch: 0.86 },
  gentle_big: { voice: 'hm_psi', speed: 0.88, pitch: 0.9 },
  sly: { voice: 'hf_alpha', speed: 0.98, pitch: 1.0 },
  old: { voice: 'hm_omega', speed: 0.8, pitch: 0.94 },
  crow: { voice: 'hm_psi', speed: 1.06, pitch: 1.18 },
  soft_f: { voice: 'hf_alpha', speed: 0.94, pitch: 1.08 },
  female: { voice: 'hf_beta', speed: 1.0, pitch: 1.0 },
  male: { voice: 'hm_psi', speed: 1.0, pitch: 1.0 },
};

const GAP = 0.35, QUESTION_PAUSE = 3.0, SCENE_GAP = 1.0, TITLE_LEN = 4.6;

let rubberband = null;
async function hasRubberband() {
  if (rubberband === null) {
    try { const { stdout } = await run('ffmpeg', ['-hide_banner', '-filters']); rubberband = / rubberband /.test(stdout); } catch { rubberband = false; }
  }
  return rubberband;
}

async function pitchShift(src, dst, pitch) {
  if (Math.abs(pitch - 1) < 0.01) return ffmpeg(['-i', src, '-ar', '48000', '-ac', '1', dst]);
  if (await hasRubberband()) return ffmpeg(['-i', src, '-af', `rubberband=pitch=${pitch}:formant=shifted`, '-ar', '48000', '-ac', '1', dst]);
  // fallback: resample trick (changes formants too — fine for cartoon voices)
  return ffmpeg(['-i', src, '-af', `asetrate=24000*${pitch},aresample=48000,atempo=${(1 / pitch).toFixed(4)}`, '-ac', '1', dst]);
}

// Flatten the story into spoken lines (title intro, scenes, moral, goodbye)
function spokenLines(story) {
  const voiceOf = id => (story.cast.find(c => c.id === id) || {}).voice || 'male';
  const lines = [{ kind: 'title', who: 'narrator', preset: 'narrator', text: `आज की कहानी है... ${story.title}!` }];
  story.scenes.forEach((sc, si) => sc.beats.forEach((b, bi) => lines.push({
    kind: 'beat', scene: si, beat: bi, who: b.speaker, preset: b.speaker === 'narrator' ? 'narrator' : voiceOf(b.speaker), text: b.text, question: b.question,
  })));
  lines.push({ kind: 'moral', who: 'narrator', preset: 'narrator', text: `तो बच्चों, इस कहानी से हमें क्या सीख मिली? ${story.moral}` });
  lines.push({ kind: 'bye', who: 'narrator', preset: 'narrator', text: 'फिर मिलेंगे, एक नई कहानी के साथ। बाय बाय!' });
  return lines;
}

async function buildStoryAudio(story, workDir, reporter) {
  const dir = path.join(workDir, 'voice');
  fs.mkdirSync(dir, { recursive: true });
  const lines = spokenLines(story);

  // 1. Kokoro batch (model loads once)
  const jobs = lines.map((l, i) => ({ text: l.text, out: path.join(dir, `raw${String(i).padStart(3, '0')}.wav`), voice: PRESETS[l.preset].voice, speed: PRESETS[l.preset].speed, lang: 'hi' }));
  fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify(jobs));
  reporter.log(`Recording ${lines.length} lines in ${new Set(lines.map(l => l.preset)).size} voices`);
  await run('python3', [path.join(__dirname, '..', 'kokoro_tts.py'), path.join(dir, 'jobs.json')], {
    timeoutMs: 40 * 60 * 1000,
    onStdout: out => { const m = out.match(/PROGRESS (\d+) (\d+)\s*$/m); if (m) reporter.progress((+m[1] / +m[2]) * 85, `Line ${m[1]} of ${m[2]}`); },
  });

  // 2. Character pitch + durations
  await pool(lines, 4, async (l, i) => {
    l.file = path.join(dir, `l${String(i).padStart(3, '0')}.wav`);
    await pitchShift(jobs[i].out, l.file, PRESETS[l.preset].pitch);
    l.dur = await duration(l.file);
  });

  // 3. Timeline
  let t = 0.8;
  const sfx = [{ type: 'chime', at: 0.3 }];
  const music = [];
  let lastScene = -1, sceneStart = 0;
  for (const l of lines) {
    if (l.kind === 'beat' && l.scene !== lastScene) {
      if (lastScene === -1) t = Math.max(t, TITLE_LEN);
      else { t += SCENE_GAP; sfx.push({ type: 'swoosh', at: t - SCENE_GAP * 0.7 }); }
      if (lastScene >= 0) music.push({ from: sceneStart, to: t, mood: story.scenes[lastScene].background === 'night' ? 'night' : 'day' });
      sceneStart = lastScene === -1 ? 0 : t;
      lastScene = l.scene;
      l.sceneStart = true;
    }
    if (l.kind === 'moral') { t += SCENE_GAP; music.push({ from: sceneStart, to: t, mood: story.scenes[lastScene].background === 'night' ? 'night' : 'day' }); sceneStart = t; sfx.push({ type: 'chime', at: t - 0.4 }); }
    l.start = t;
    l.end = t + l.dur;
    t = l.end + GAP;
    if (l.question) { sfx.push({ type: 'ding', at: l.start - 0.25 }, { type: 'tick', at: l.end + 0.3 }); l.pauseEnd = l.end + QUESTION_PAUSE; t = l.pauseEnd; }
    if (l.kind === 'bye') t = l.end + 2.4;
  }
  const total = t;
  music.push({ from: sceneStart, to: total, mood: 'day' });

  // action sound effects
  for (const l of lines) {
    if (l.kind !== 'beat') continue;
    const beat = story.scenes[l.scene].beats[l.beat];
    for (const a of beat.actions || []) {
      const at = l.start + 0.05;
      const map = { enter: 'pop', exit: 'whoosh', run_to: 'whoosh', jump: 'boing', celebrate: 'sparkle', give: 'boing', fall: 'thud', fly: 'whoosh', laugh: null };
      const type = map[a.do];
      if (type) sfx.push({ type, at });
      if (a.do === 'enter' && (story.cast.find(c => c.id === a.who) || {}).species === 'crocodile') sfx.push({ type: 'splash', at: at + 0.2 });
    }
  }

  // 4. Mix
  const plan = { total, lines: lines.map(l => ({ file: l.file, start: l.start, who: l.who })), sfx, music };
  fs.writeFileSync(path.join(workDir, 'mixplan.json'), JSON.stringify(plan));
  await run('python3', [path.join(__dirname, 'story_mix.py'), path.join(workDir, 'mixplan.json'), workDir], { timeoutMs: 10 * 60 * 1000 });
  const env = JSON.parse(fs.readFileSync(path.join(workDir, 'env.json'), 'utf8'));
  reporter.progress(100, 'Soundtrack mixed');
  return { lines, total, env, mixPath: path.join(workDir, 'mix.wav') };
}

module.exports = { buildStoryAudio, PRESETS, spokenLines };
