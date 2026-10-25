// Video Assembly: Pexels stock footage + ffmpeg
// Combines voiceover MP3 + stock video clips + text overlays → final 1080p MP4
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const VIDEO_DIR = path.join(__dirname, 'videos');
const TEMP_DIR = path.join(__dirname, 'temp');

[VIDEO_DIR, TEMP_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ─── Pixabay: fetch free stock video clips ───────────────────────────────────
async function fetchStockVideos(keywords, count = 6) {
  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) {
    console.log('[Video] No PIXABAY_API_KEY — using color backgrounds instead');
    return [];
  }

  const query = keywords.slice(0, 2).join(' ');
  console.log(`[Pixabay] Searching for: "${query}"`);

  try {
    const res = await axios.get('https://pixabay.com/api/videos/', {
      params: {
        key: apiKey,
        q: query,
        per_page: count,
        video_type: 'film',
        safesearch: true,
      },
    });

    const clips = (res.data.hits || []).map(v => {
      // Pick medium or large quality
      const file = v.videos?.large?.url || v.videos?.medium?.url;
      return { id: v.id, url: file, duration: v.duration };
    }).filter(c => c.url);

    console.log(`[Pixabay] Found ${clips.length} clips`);
    return clips;
  } catch (e) {
    console.log('[Pixabay] Error:', e.message, '— using color backgrounds');
    return [];
  }
}

// ─── Download a video clip ────────────────────────────────────────────────────
async function downloadClip(url, outputPath) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  fs.writeFileSync(outputPath, Buffer.from(res.data));
}

// ─── Get audio duration ───────────────────────────────────────────────────────
async function getAudioDuration(audioPath) {
  const { stdout } = await execAsync(
    `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${audioPath}"`
  );
  return parseFloat(stdout.trim());
}

// ─── Build video from scenes using ffmpeg ────────────────────────────────────
async function buildVideo(jobId, scriptData, voiceoverPath) {
  const totalDuration = voiceoverPath && fs.existsSync(voiceoverPath)
    ? await getAudioDuration(voiceoverPath)
    : 540; // default 9 minutes

  console.log(`[Video] Total duration: ${(totalDuration / 60).toFixed(1)} min`);

  // Extract scene keywords from script B-ROLL markers
  const brollMatches = [...(scriptData.script || '').matchAll(/\[B-ROLL:\s*([^\]]+)\]/g)];
  const sceneKeywords = brollMatches.map(m => m[1].trim());
  const allKeywords = scriptData.topic?.searchKeywords || ['finance', 'money', 'investment'];

  // Fetch stock clips (or fall back to solid color backgrounds)
  const clips = await fetchStockVideos([...allKeywords, ...sceneKeywords.slice(0, 2)], 8);

  // Generate the video
  const outputPath = path.join(VIDEO_DIR, `${jobId}_final.mp4`);

  if (clips.length > 0) {
    await buildWithStockFootage(jobId, clips, voiceoverPath, outputPath, totalDuration, scriptData);
  } else {
    await buildWithColorBackgrounds(jobId, voiceoverPath, outputPath, totalDuration, scriptData);
  }

  const stats = fs.statSync(outputPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
  console.log(`[Video] ✅ Final video: ${outputPath} (${sizeMB} MB)`);
  return { path: outputPath, sizeMB: parseFloat(sizeMB) };
}

// ─── Build with Pexels stock footage ─────────────────────────────────────────
async function buildWithStockFootage(jobId, clips, voiceoverPath, outputPath, totalDuration, scriptData) {
  console.log('[Video] Downloading stock clips...');
  const clipPaths = [];

  for (let i = 0; i < Math.min(clips.length, 8); i++) {
    const clipPath = path.join(TEMP_DIR, `${jobId}_clip_${i}.mp4`);
    try {
      await downloadClip(clips[i].url, clipPath);
      clipPaths.push(clipPath);
      console.log(`[Video] Downloaded clip ${i + 1}/${Math.min(clips.length, 8)}`);
    } catch (e) {
      console.log(`[Video] Failed to download clip ${i + 1}:`, e.message);
    }
  }

  if (clipPaths.length === 0) {
    return buildWithColorBackgrounds(jobId, voiceoverPath, outputPath, totalDuration, scriptData);
  }

  // Write ffmpeg concat list — loop clips to fill the full audio duration
  const clipDuration = totalDuration / clipPaths.length;
  const concatFile = path.join(TEMP_DIR, `${jobId}_concat.txt`);
  const lines = [];

  // Repeat clips to fill the full duration
  let covered = 0;
  let idx = 0;
  while (covered < totalDuration) {
    lines.push(`file '${clipPaths[idx % clipPaths.length]}'`);
    covered += clipDuration;
    idx++;
    if (idx > 40) break; // safety
  }
  fs.writeFileSync(concatFile, lines.join('\n'));

  const title = scriptData.title || 'Personal Finance Tips';
  const subtitle = scriptData.topic?.whyNow || '';

  // Build the video: concat clips + voiceover + title overlay
  const voiceArg = voiceoverPath && fs.existsSync(voiceoverPath)
    ? `-i "${voiceoverPath}"`
    : '';

  const audioMap = voiceoverPath && fs.existsSync(voiceoverPath)
    ? '-map 0:v -map 1:a -shortest'
    : '-map 0:v -an';

  // Text overlay filter — title card for first 5 seconds
  const titleText = title.replace(/'/g, "\\'").replace(/:/g, '\\:');
  const drawtext = [
    `drawtext=text='${titleText}':fontsize=52:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`,
    `box=1:boxcolor=black@0.6:boxborderw=20`,
    `enable='between(t,0,5)'`,
  ].join(':');

  const ffmpegCmd = [
    'ffmpeg -y',
    `-f concat -safe 0 -i "${concatFile}"`,
    voiceArg,
    `-vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,${drawtext}"`,
    audioMap,
    `-c:v libx264 -preset fast -crf 23`,
    `-c:a aac -b:a 192k`,
    `-t ${totalDuration}`,
    `"${outputPath}"`,
  ].filter(Boolean).join(' ');

  console.log('[Video] Rendering with stock footage...');
  await execAsync(ffmpegCmd, { timeout: 600000 }); // 10 min timeout

  // Cleanup temp files
  clipPaths.forEach(p => { try { fs.unlinkSync(p); } catch (_) {} });
  try { fs.unlinkSync(concatFile); } catch (_) {}
}

// ─── Fallback: gradient color backgrounds + text ──────────────────────────────
async function buildWithColorBackgrounds(jobId, voiceoverPath, outputPath, totalDuration, scriptData) {
  console.log('[Video] Building with animated color backgrounds...');

  const title = (scriptData.title || 'Personal Finance Tips').replace(/'/g, "\\'").replace(/:/g, '\\:');
  const sections = scriptData.sections || [];

  // Build a clean finance-style video: dark gradient + animated text cards
  // Each section gets its own color card
  const colors = ['#1a1a2e', '#16213e', '#0f3460', '#1a1a2e', '#16213e', '#0f3460'];
  const segDuration = totalDuration / Math.max(sections.length, 5);

  const filterParts = [];
  const inputs = [];

  // Generate color segments
  for (let i = 0; i < Math.min(sections.length || 5, 6); i++) {
    const color = colors[i % colors.length].replace('#', '');
    const sectionName = (sections[i]?.name || `Part ${i + 1}`).replace(/'/g, "\\'");
    inputs.push(`-f lavfi -i color=c=${color}:size=1920x1080:rate=30:duration=${segDuration}`);
  }

  const voiceArg = voiceoverPath && fs.existsSync(voiceoverPath)
    ? `-i "${voiceoverPath}"`
    : '';

  const numInputs = Math.min(sections.length || 5, 6);

  // Concat all color cards
  const concatFilter = `[${[...Array(numInputs).keys()].map(i => `${i}:v`).join('][')}]concat=n=${numInputs}:v=1:a=0[base]`;

  // Title text overlay on first 5 seconds
  const titleOverlay = `[base]drawtext=text='${title}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.5:boxborderw=15:enable='between(t,0,5)'[out]`;

  const audioMap = voiceoverPath && fs.existsSync(voiceoverPath)
    ? `-map "[out]" -map ${numInputs}:a -shortest`
    : '-map "[out]" -an';

  const ffmpegCmd = [
    'ffmpeg -y',
    inputs.join(' '),
    voiceArg,
    `-filter_complex "${concatFilter};${titleOverlay}"`,
    audioMap,
    `-c:v libx264 -preset fast -crf 23`,
    `-c:a aac -b:a 192k`,
    `"${outputPath}"`,
  ].filter(Boolean).join(' ');

  await execAsync(ffmpegCmd, { timeout: 600000 });
}

// ─── Main render function ─────────────────────────────────────────────────────
async function renderVideo(jobId, scriptData, voiceoverPath) {
  console.log(`[Video] Starting render for job: ${jobId}`);
  try {
    return await buildVideo(jobId, scriptData, voiceoverPath);
  } catch (err) {
    console.error('[Video] Render error:', err.message);
    throw err;
  }
}

module.exports = { renderVideo };
