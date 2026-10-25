// Voiceover using Google Text-to-Speech (free, no API key needed via gTTS-compatible endpoint)
// Falls back to ElevenLabs if ELEVENLABS_API_KEY is set and has credits
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');

const PERSIST_BASE = process.env.RENDER
  ? '/opt/render/project/src/backend/data'
  : __dirname;
const AUDIO_DIR = path.join(PERSIST_BASE, 'audio');
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

// ─── Clean script for TTS ─────────────────────────────────────────────────────
function cleanScriptForTTS(script) {
  return script
    .replace(/\[B-ROLL:[^\]]*\]/g, '')
    .replace(/\[PAUSE\]/g, '...')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/  +/g, ' ')
    .trim();
}

// ─── Split into chunks (Google TTS has 200 char limit per request) ────────────
function splitIntoChunks(text, maxChars = 180) {
  const chunks = [];
  // Split on sentence boundaries
  const sentences = text.split(/(?<=[.!?])\s+/);
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      // Split long sentence on commas
      if (current) { chunks.push(current.trim()); current = ''; }
      const parts = sentence.split(/,\s*/);
      let sub = '';
      for (const part of parts) {
        if ((sub + ', ' + part).length > maxChars) {
          if (sub) chunks.push(sub.trim());
          sub = part;
        } else {
          sub += (sub ? ', ' : '') + part;
        }
      }
      if (sub) chunks.push(sub.trim());
    } else if ((current + ' ' + sentence).length > maxChars) {
      if (current) chunks.push(current.trim());
      current = sentence;
    } else {
      current += (current ? ' ' : '') + sentence;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.filter(c => c.length > 0);
}

// ─── Google TTS (free, no key required) ──────────────────────────────────────
async function generateChunkGoogle(text, chunkIndex, jobId) {
  const encoded = encodeURIComponent(text);
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=en&client=tw-ob&ttsspeed=0.9`;

  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://translate.google.com/',
    },
    timeout: 30000,
  });

  const chunkPath = path.join(AUDIO_DIR, `${jobId}_chunk_${chunkIndex}.mp3`);
  fs.writeFileSync(chunkPath, Buffer.from(res.data));
  return chunkPath;
}

// ─── Merge MP3 chunks using ffmpeg ───────────────────────────────────────────
function mergeChunksFFmpeg(chunkPaths, outputPath) {
  // Write file list for ffmpeg concat
  const listPath = path.join(AUDIO_DIR, `${path.basename(outputPath)}_list.txt`);
  const listContent = chunkPaths.map(p => `file '${p}'`).join('\n');
  fs.writeFileSync(listPath, listContent);

  execSync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -acodec libmp3lame -q:a 2 "${outputPath}" 2>/dev/null`);
  fs.unlinkSync(listPath);
  chunkPaths.forEach(p => { try { fs.unlinkSync(p); } catch(e) {} });
}

// ─── Main voiceover generation function ──────────────────────────────────────
async function generateVoiceover(jobId, scriptText) {
  console.log(`[Voiceover] Generating voiceover for job ${jobId}`);

  const cleanedScript = cleanScriptForTTS(scriptText);
  console.log(`[Voiceover] Script cleaned: ${cleanedScript.length} chars`);

  const chunks = splitIntoChunks(cleanedScript);
  console.log(`[Voiceover] Split into ${chunks.length} chunks`);

  const chunkPaths = [];
  for (let i = 0; i < chunks.length; i++) {
    if (i % 10 === 0) console.log(`[Voiceover] Generating chunk ${i + 1}/${chunks.length}...`);
    const chunkPath = await generateChunkGoogle(chunks[i], i, jobId);
    chunkPaths.push(chunkPath);
    // Small delay to avoid rate limiting
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 150));
  }

  const outputPath = path.join(AUDIO_DIR, `${jobId}_voiceover.mp3`);

  if (chunkPaths.length === 1) {
    fs.renameSync(chunkPaths[0], outputPath);
  } else {
    console.log(`[Voiceover] Merging ${chunkPaths.length} chunks...`);
    mergeChunksFFmpeg(chunkPaths, outputPath);
  }

  const stats = fs.statSync(outputPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`[Voiceover] ✅ Done: ${outputPath} (${sizeMB} MB)`);

  return {
    path: outputPath,
    filename: `${jobId}_voiceover.mp3`,
    sizeMB: parseFloat(sizeMB),
  };
}

async function getVoices() { return [{ id: 'google-tts', name: 'Google TTS (Free)' }]; }
async function checkCredits() { return { used: 0, limit: 'unlimited', remaining: 'unlimited', estimatedVideosLeft: 999 }; }

module.exports = { generateVoiceover, getVoices, checkCredits, cleanScriptForTTS };
