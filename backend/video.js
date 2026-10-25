// Video Assembly: static title card + voiceover audio → MP4
// Uses a single PNG thumbnail as background — renders in ~5 seconds for any length
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const PERSIST_BASE = process.env.RENDER
  ? '/opt/render/project/src/backend/data'
  : __dirname;
const VIDEO_DIR = path.join(PERSIST_BASE, 'videos');
const TEMP_DIR = path.join(__dirname, 'temp');

[VIDEO_DIR, TEMP_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ─── Get audio duration ───────────────────────────────────────────────────────
async function getAudioDuration(audioPath) {
  const { stdout } = await execAsync(
    `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${audioPath}"`
  );
  return parseFloat(stdout.trim());
}

// ─── Generate a title card PNG using ffmpeg lavfi ────────────────────────────
async function generateTitleCard(jobId, title, outputPng) {
  const safeTitle = title
    .replace(/['"\\:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 60);

  // Split into two lines if long
  const words = safeTitle.split(' ');
  const mid = Math.ceil(words.length / 2);
  const line1 = words.slice(0, mid).join(' ');
  const line2 = words.slice(mid).join(' ');

  const drawtext = line2
    ? `drawtext=text='${line1}':fontsize=56:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-40:box=1:boxcolor=black@0.4:boxborderw=10,drawtext=text='${line2}':fontsize=56:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2+40:box=1:boxcolor=black@0.4:boxborderw=10`
    : `drawtext=text='${line1}':fontsize=56:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.4:boxborderw=10`;

  const cmd = `ffmpeg -y -f lavfi -i "color=c=0f3460:size=1280x720:duration=1" -vf "${drawtext}" -frames:v 1 "${outputPng}" 2>/dev/null`;
  await execAsync(cmd, { timeout: 30000 });
}

// ─── Main render: static image + audio → MP4 (fast, ~5 sec for any length) ──
async function buildVideo(jobId, scriptData, voiceoverPath) {
  const title = scriptData.title || 'Personal Finance Tips';
  console.log(`[Video] Starting render for job: ${jobId}`);

  const totalDuration = voiceoverPath && fs.existsSync(voiceoverPath)
    ? await getAudioDuration(voiceoverPath)
    : 540;
  console.log(`[Video] Duration: ${(totalDuration / 60).toFixed(1)} min`);

  const outputPath = path.join(VIDEO_DIR, `${jobId}_final.mp4`);
  const titleCardPath = path.join(TEMP_DIR, `${jobId}_title.png`);

  // Generate title card PNG
  console.log('[Video] Generating title card...');
  await generateTitleCard(jobId, title, titleCardPath);

  // Build MP4: loop the static image for the full audio duration
  const voiceArg = voiceoverPath && fs.existsSync(voiceoverPath)
    ? `-i "${voiceoverPath}"`
    : '';
  const audioMap = voiceoverPath && fs.existsSync(voiceoverPath)
    ? '-map 0:v -map 1:a -shortest'
    : '-map 0:v -an';

  const cmd = [
    'ffmpeg -y',
    `-loop 1 -i "${titleCardPath}"`,
    voiceArg,
    audioMap,
    `-c:v libx264 -preset ultrafast -tune stillimage -crf 28`,
    `-c:a aac -b:a 128k`,
    `-t ${totalDuration}`,
    `-pix_fmt yuv420p`,
    `"${outputPath}"`,
  ].filter(Boolean).join(' ');

  console.log('[Video] Rendering (static image + audio)...');
  await execAsync(cmd, { timeout: 120000 }); // 2 min max — should finish in ~5-10 sec

  // Cleanup
  try { fs.unlinkSync(titleCardPath); } catch (_) {}

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
