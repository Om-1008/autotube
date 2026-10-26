// Video Assembly: static title card + voiceover audio → MP4
// Uses a single PNG thumbnail as background — renders in ~5 seconds for any length
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const PERSIST_BASE = process.env.RENDER
  ? '/opt/render/project/src/backend/data'
  : __dirname;
const VIDEO_DIR = path.join(PERSIST_BASE, 'videos');

if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });

// ─── Get audio duration ───────────────────────────────────────────────────────
async function getAudioDuration(audioPath) {
  const { stdout } = await execAsync(
    `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${audioPath}"`
  );
  return parseFloat(stdout.trim());
}

// ─── Main render: lavfi color source + audio → MP4 (no PNG file needed) ──────
async function buildVideo(jobId, scriptData, voiceoverPath) {
  const title = scriptData.title || 'Personal Finance Tips';
  console.log(`[Video] Starting render for job: ${jobId}`);

  const totalDuration = voiceoverPath && fs.existsSync(voiceoverPath)
    ? await getAudioDuration(voiceoverPath)
    : 540;
  console.log(`[Video] Duration: ${(totalDuration / 60).toFixed(1)} min`);

  const outputPath = path.join(VIDEO_DIR, `${jobId}_final.mp4`);

  // Use ffmpeg lavfi color source directly — no PNG file, no font, no drawtext
  // Just a solid navy background for the full duration of the audio
  const voiceArg = voiceoverPath && fs.existsSync(voiceoverPath)
    ? `-i "${voiceoverPath}"`
    : '';
  const audioMap = voiceoverPath && fs.existsSync(voiceoverPath)
    ? '-map 0:v -map 1:a -shortest'
    : '-map 0:v -an';

  const cmd = [
    'ffmpeg -y',
    `-f lavfi -r 1 -i "color=c=0x0f3460:size=1280x720:rate=1"`,
    voiceArg,
    audioMap,
    `-c:v libx264 -preset ultrafast -tune stillimage -crf 28`,
    `-c:a aac -b:a 128k`,
    `-t ${totalDuration}`,
    `-pix_fmt yuv420p`,
    `"${outputPath}"`,
  ].filter(Boolean).join(' ');

  console.log('[Video] Rendering (lavfi color + audio, no PNG)...');
  await execAsync(cmd, { timeout: 180000 }); // 3 min — 9-min video at 1fps takes ~85 sec

  const stats = fs.statSync(outputPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
  console.log(`[Video] ✅ Done: ${outputPath} (${sizeMB} MB)`);
  return { path: outputPath, sizeMB: parseFloat(sizeMB) };
}

async function renderVideo(jobId, scriptData, voiceoverPath) {
  try {
    return await buildVideo(jobId, scriptData, voiceoverPath);
  } catch (err) {
    console.error('[Video] ❌ Error:', err.message);
    throw err;
  }
}

module.exports = { renderVideo };
