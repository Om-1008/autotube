// Process helpers: spawn without a shell (no quoting/escaping bugs), ffprobe, pooling.
const { spawn } = require('child_process');

function run(cmd, args, { onStdout, timeoutMs = 30 * 60 * 1000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${cmd} timed out`)); }, timeoutMs);
    p.stdout.on('data', d => { const s = d.toString(); stdout += s.length < 1e6 ? s : ''; onStdout && onStdout(s); });
    p.stderr.on('data', d => { stderr = (stderr + d.toString()).slice(-4000); });
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.split('\n').filter(Boolean).slice(-3).join(' | ')}`));
    });
  });
}

const ffmpeg = (args, opts) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], opts);

// ffmpeg with -progress parsing → onPercent(0..100) given the expected output duration
function ffmpegWithProgress(args, totalSeconds, onPercent, { cwd } = {}) {
  let buf = '';
  return ffmpeg(['-progress', 'pipe:1', '-nostats', ...args], {
    cwd,
    onStdout: (s) => {
      buf += s;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const m = line.match(/^out_time_us=(\d+)/) || line.match(/^out_time_ms=(\d+)/);
        if (m && totalSeconds > 0) onPercent(Math.min(99, (parseInt(m[1], 10) / 1e6 / totalSeconds) * 100));
      }
    },
  });
}

async function duration(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const d = parseFloat(stdout.trim());
  if (!isFinite(d)) throw new Error('Could not read duration of ' + file);
  return d;
}

// Run async tasks with limited concurrency, preserving result order
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function has(cmd, args = ['--version']) {
  try { await run(cmd, args, { timeoutMs: 20000 }); return true; } catch { return false; }
}

module.exports = { run, ffmpeg, ffmpegWithProgress, duration, pool, has };
