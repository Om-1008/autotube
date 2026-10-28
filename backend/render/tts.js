// Voiceover: one audio file per sentence so caption timing is exact.
// Engine order: edge-tts (Microsoft neural voices, free) → Google Translate TTS.
// TTS_ENGINE=test generates silent placeholder audio (for offline testing).
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { run, ffmpeg, duration, pool, has } = require('./proc');

const VOICE = process.env.TTS_VOICE || 'en-US-AndrewNeural';
const RATE = process.env.TTS_RATE || '+4%';
const SAMPLE_RATE = 24000;

async function edgeTTS(text, mp3Path) {
  const txt = mp3Path.replace(/\.mp3$/, '.txt');
  fs.writeFileSync(txt, text);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await run('edge-tts', ['--voice', VOICE, `--rate=${RATE}`, '--file', txt, '--write-media', mp3Path], { timeoutMs: 60000 });
      if (fs.existsSync(mp3Path) && fs.statSync(mp3Path).size > 500) return;
      throw new Error('empty audio');
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
}

function splitForGoogle(text, max = 190) {
  const words = text.split(/\s+/);
  const out = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).length > max && cur) { out.push(cur); cur = w; }
    else cur += (cur ? ' ' : '') + w;
  }
  if (cur) out.push(cur);
  return out;
}

async function googleTTS(text, mp3Path) {
  const parts = splitForGoogle(text);
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(parts[i])}&tl=en&client=tw-ob`;
    let data;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await axios.get(url, {
          responseType: 'arraybuffer', timeout: 30000,
          headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://translate.google.com/' },
        });
        data = res.data; break;
      } catch (e) {
        if (attempt === 3) throw e;
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    const f = `${mp3Path}.${i}.mp3`;
    fs.writeFileSync(f, Buffer.from(data));
    files.push(f);
    await new Promise(r => setTimeout(r, 400));
  }
  const list = `${mp3Path}.list.txt`;
  fs.writeFileSync(list, files.map(f => `file '${f}'`).join('\n'));
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'libmp3lame', '-q:a', '3', mp3Path]);
}

async function placeholderTTS(text, mp3Path) {
  const secs = Math.max(1, text.split(/\s+/).length / 2.6).toFixed(2);
  await ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=220:sample_rate=${SAMPLE_RATE}`, '-af', 'volume=0.05', '-t', secs, '-c:a', 'libmp3lame', mp3Path]);
}

// scenes: [{ sentences: [] }] → { wavPath, totalDuration, timeline: [{scene, sentence, text, start, end}] }
async function synthesize(scenes, workDir, reporter) {
  const dir = path.join(workDir, 'tts');
  fs.mkdirSync(dir, { recursive: true });

  let engine = process.env.TTS_ENGINE || '';
  if (!engine) engine = (await has('edge-tts', ['--help'])) ? 'edge' : 'google';
  reporter.log(`Voice engine: ${engine === 'edge' ? `Microsoft neural voice (${VOICE})` : engine === 'google' ? 'Google TTS (fallback)' : 'placeholder'}`);

  const items = [];
  scenes.forEach((s, si) => s.sentences.forEach((text, ti) => items.push({ si, ti, text })));

  let done = 0;
  let fellBack = 0;
  const results = await pool(items, engine === 'google' ? 1 : 6, async (it, i) => {
    const mp3 = path.join(dir, `s${String(i).padStart(4, '0')}.mp3`);
    const wav = mp3.replace(/\.mp3$/, '.wav');
    if (engine === 'edge') {
      try { await edgeTTS(it.text, mp3); }
      catch (e) { fellBack++; await googleTTS(it.text, mp3); }
    } else if (engine === 'google') {
      await googleTTS(it.text, mp3);
    } else {
      await placeholderTTS(it.text, mp3);
    }
    // Decode to PCM so durations are sample-exact (MP3 padding would drift captions)
    await ffmpeg(['-i', mp3, '-ar', String(SAMPLE_RATE), '-ac', '1', '-c:a', 'pcm_s16le', wav]);
    const d = await duration(wav);
    done++;
    reporter.progress((done / items.length) * 100, `Sentence ${done} of ${items.length}`);
    return { ...it, wav, d };
  });
  if (fellBack) reporter.log(`⚠️ ${fellBack} sentences used the Google TTS fallback`);

  // Short pause between scenes for natural pacing
  const gapSecs = 0.35;
  const gap = path.join(dir, 'gap.wav');
  await ffmpeg(['-f', 'lavfi', '-i', `anullsrc=r=${SAMPLE_RATE}:cl=mono`, '-t', String(gapSecs), '-c:a', 'pcm_s16le', gap]);

  const order = [];
  const timeline = [];
  let t = 0;
  results.forEach((r, i) => {
    if (i > 0 && r.si !== results[i - 1].si) { order.push(gap); t += gapSecs; }
    order.push(r.wav);
    timeline.push({ scene: r.si, sentence: r.ti, text: r.text, start: t, end: t + r.d });
    t += r.d;
  });

  const list = path.join(dir, 'concat.txt');
  fs.writeFileSync(list, order.map(f => `file '${f}'`).join('\n'));
  const wavPath = path.join(workDir, 'voiceover.wav');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'pcm_s16le', wavPath]);
  const totalDuration = await duration(wavPath);

  return { wavPath, totalDuration, timeline, engine };
}

module.exports = { synthesize };
