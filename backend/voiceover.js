// Session 2: ElevenLabs Text-to-Speech
// Converts approved script → MP3 voiceover file
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';
const AUDIO_DIR = path.join(__dirname, 'audio');

// Ensure audio directory exists
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

// ─── Clean script for TTS ─────────────────────────────────────────────────────
// Remove [B-ROLL: ...] markers and [PAUSE] markers — ElevenLabs reads them literally
function cleanScriptForTTS(script) {
  return script
    .replace(/\[B-ROLL:[^\]]*\]/g, '')   // remove b-roll markers
    .replace(/\[PAUSE\]/g, '...')         // convert [PAUSE] to natural pause
    .replace(/\n{3,}/g, '\n\n')           // collapse excess newlines
    .replace(/  +/g, ' ')                 // collapse extra spaces
    .trim();
}

// ─── Split long scripts into chunks (ElevenLabs has 5000 char limit per call) ─
function splitIntoChunks(text, maxChars = 4500) {
  const chunks = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).length > maxChars) {
      if (current) chunks.push(current.trim());
      current = sentence;
    } else {
      current += (current ? ' ' : '') + sentence;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

// ─── Get available voices ─────────────────────────────────────────────────────
async function getVoices() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');

  const res = await axios.get(`${ELEVENLABS_BASE}/voices`, {
    headers: { 'xi-api-key': apiKey },
  });

  return res.data.voices.map(v => ({
    id: v.voice_id,
    name: v.name,
    category: v.category,
    description: v.labels,
  }));
}

// ─── Generate voiceover for one chunk ────────────────────────────────────────
async function generateChunk(text, voiceId, chunkIndex, jobId) {
  const apiKey = process.env.ELEVENLABS_API_KEY;

  const res = await axios.post(
    `${ELEVENLABS_BASE}/text-to-speech/${voiceId}`,
    {
      text,
      model_id: 'eleven_turbo_v2_5',   // fastest + cheapest, great quality
      voice_settings: {
        stability: 0.5,           // balanced — not robotic, not too varied
        similarity_boost: 0.75,   // stay true to the voice
        style: 0.3,               // slight expressiveness for finance content
        use_speaker_boost: true,
      },
    },
    {
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      responseType: 'arraybuffer',
    }
  );

  const chunkPath = path.join(AUDIO_DIR, `${jobId}_chunk_${chunkIndex}.mp3`);
  fs.writeFileSync(chunkPath, Buffer.from(res.data));
  console.log(`[ElevenLabs] Chunk ${chunkIndex + 1} saved: ${chunkPath}`);
  return chunkPath;
}

// ─── Merge MP3 chunks into one file ──────────────────────────────────────────
function mergeChunks(chunkPaths, outputPath) {
  // Simple binary concatenation works for MP3 files
  const buffers = chunkPaths.map(p => fs.readFileSync(p));
  const merged = Buffer.concat(buffers);
  fs.writeFileSync(outputPath, merged);

  // Clean up chunks
  chunkPaths.forEach(p => fs.unlinkSync(p));
  console.log(`[ElevenLabs] Merged ${chunkPaths.length} chunks → ${outputPath}`);
}

// ─── Main voiceover generation function ──────────────────────────────────────
async function generateVoiceover(jobId, scriptText) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set in .env');

  const voiceId = process.env.ELEVENLABS_VOICE_ID || await getDefaultVoiceId();
  console.log(`[ElevenLabs] Generating voiceover for job ${jobId} with voice ${voiceId}`);

  // 1. Clean the script
  const cleanedScript = cleanScriptForTTS(scriptText);
  console.log(`[ElevenLabs] Script cleaned: ${cleanedScript.length} chars`);

  // 2. Split into chunks if needed
  const chunks = splitIntoChunks(cleanedScript);
  console.log(`[ElevenLabs] Split into ${chunks.length} chunk(s)`);

  // 3. Generate each chunk
  const chunkPaths = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(`[ElevenLabs] Generating chunk ${i + 1}/${chunks.length}...`);
    const chunkPath = await generateChunk(chunks[i], voiceId, i, jobId);
    chunkPaths.push(chunkPath);

    // Small delay between chunks to avoid rate limiting
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 500));
  }

  // 4. Merge or just use single chunk
  const outputPath = path.join(AUDIO_DIR, `${jobId}_voiceover.mp3`);
  if (chunkPaths.length === 1) {
    fs.renameSync(chunkPaths[0], outputPath);
  } else {
    mergeChunks(chunkPaths, outputPath);
  }

  const stats = fs.statSync(outputPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`[ElevenLabs] ✅ Voiceover ready: ${outputPath} (${sizeMB} MB)`);

  return {
    path: outputPath,
    filename: `${jobId}_voiceover.mp3`,
    sizeMB: parseFloat(sizeMB),
  };
}

// ─── Pick best default voice for finance content ──────────────────────────────
async function getDefaultVoiceId() {
  try {
    const voices = await getVoices();
    // Prefer "Adam" or "Josh" — deep, authoritative, great for finance
    const preferred = ['Adam', 'Josh', 'Antoni', 'Arnold'];
    for (const name of preferred) {
      const match = voices.find(v => v.name === name);
      if (match) {
        console.log(`[ElevenLabs] Auto-selected voice: ${match.name} (${match.id})`);
        return match.id;
      }
    }
    // Fallback to first available
    console.log(`[ElevenLabs] Using first available voice: ${voices[0]?.name}`);
    return voices[0]?.id;
  } catch (e) {
    throw new Error('Could not fetch voices: ' + e.message);
  }
}

// ─── Check remaining ElevenLabs credits ──────────────────────────────────────
async function checkCredits() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { error: 'No API key' };

  const res = await axios.get(`${ELEVENLABS_BASE}/user/subscription`, {
    headers: { 'xi-api-key': apiKey },
  });

  const { character_count, character_limit } = res.data;
  const remaining = character_limit - character_count;
  const percentUsed = ((character_count / character_limit) * 100).toFixed(1);

  return {
    used: character_count,
    limit: character_limit,
    remaining,
    percentUsed,
    // A 1300-word script ≈ 7500 chars
    estimatedVideosLeft: Math.floor(remaining / 7500),
  };
}

module.exports = { generateVoiceover, getVoices, checkCredits, cleanScriptForTTS };
