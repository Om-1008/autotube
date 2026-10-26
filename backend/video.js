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

// ─── Generate a title card PNG using Node.js canvas (no ffmpeg font issues) ──
async function generateTitleCard(jobId, title, outputPng) {
  // Use Python + PIL to draw the title card — avoids ffmpeg drawtext escaping issues
  const safeTitle = title
    .replace(/[^\w\s$.,!?()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 80);

  const script = `
import sys, textwrap
try:
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new('RGB', (1280, 720), color=(15, 52, 96))
    draw = ImageDraw.Draw(img)
    title = ${JSON.stringify(safeTitle)}
    # Try to use a system font, fall back to default
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 54)
        small_font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 32)
    except:
        font = ImageFont.load_default()
        small_font = font
    # Word wrap title
    lines = textwrap.wrap(title, width=28)
    total_h = len(lines) * 70
    y = (720 - total_h) // 2 - 20
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        w = bbox[2] - bbox[0]
        draw.text(((1280 - w) // 2, y), line, font=font, fill='white')
        y += 70
    # Subtitle
    sub = 'WealthSutra · Personal Finance'
    bbox = draw.textbbox((0, 0), sub, font=small_font)
    draw.text(((1280 - (bbox[2]-bbox[0])) // 2, 640), sub, font=small_font, fill=(150, 200, 255))
    img.save(${JSON.stringify(outputPng)})
    print('ok')
except Exception as e:
    print('err:' + str(e), file=sys.stderr)
    sys.exit(1)
`;

  const scriptPath = path.join(TEMP_DIR, `${jobId}_card.py`);
  fs.writeFileSync(scriptPath, script);
  try {
    await execAsync(`python3 -m pip install Pillow -q --break-system-packages 2>/dev/null || true`, { timeout: 30000 });
    await execAsync(`python3 "${scriptPath}"`, { timeout: 15000 });
  } catch (pilErr) {
    console.log('[Video] PIL failed, falling back to ffmpeg lavfi title card:', pilErr.message);
    // Fallback: plain colored box, no text (safe, always works)
    await execAsync(
      `ffmpeg -y -f lavfi -i "color=c=0f3460:size=1280x720:duration=1" -frames:v 1 "${outputPng}"`,
      { timeout: 15000 }
    );
  } finally {
    try { fs.unlinkSync(scriptPath); } catch (_) {}
  }

  // Verify PNG was created
  if (!fs.existsSync(outputPng)) {
    throw new Error(`Title card PNG not created: ${outputPng}`);
  }
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
    `-loop 1 -r 1 -i "${titleCardPath}"`,
    voiceArg,
    audioMap,
    `-c:v libx264 -preset ultrafast -tune stillimage -crf 28`,
    `-c:a aac -b:a 128k`,
    `-t ${totalDuration}`,
    `-pix_fmt yuv420p`,
    `"${outputPath}"`,
  ].filter(Boolean).join(' ');

  console.log('[Video] Rendering (static image + audio)...');
  await execAsync(cmd, { timeout: 60000 }); // 1 min max — at 1fps should finish in ~5-10 sec

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
