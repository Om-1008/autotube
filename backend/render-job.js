#!/usr/bin/env node
// Render worker entry point (run by GitHub Actions, or locally).
//   node render-job.js <jobId>                 render + upload
//   node render-job.js <jobId> --no-upload     render only
//   node render-job.js --mark-failed <jobId> "<reason>"   (workflow failure hook)
try { require('dotenv').config(); } catch { /* optional */ }
const fs = require('fs');
const os = require('os');
const path = require('path');
const jobstate = require('./jobstate');   // dependency-free (works even if npm ci failed)

const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : null;

async function markFailed(jobId, reason) {
  const cur = await jobstate.read(jobId);
  if (cur && ['error', 'uploaded', 'rendered'].includes(cur.status)) return;   // already reported
  const base = cur && cur.phase === 'render' ? cur : null;
  const r = jobstate.createReporter(jobId, 'render', base ? { ...base, runUrl: runUrl || base.runUrl } : { runUrl });
  await r.fail(new Error(reason || 'Render server stopped unexpectedly'));
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--mark-failed') {
    await markFailed(args[1], args[2]);
    return;
  }
  const jobId = args[0];
  if (!jobId) throw new Error('Usage: node render-job.js <jobId>');

  const db = require('./db');
  const { processJob } = require('./render');
  const data = await db.loadFresh();
  const job = data.videos.find(v => v.id === jobId);
  const reporter = jobstate.createReporter(jobId, 'render', { runUrl });
  if (!job) {
    await reporter.fail(new Error(`Job ${jobId} not found in database`));
    process.exit(1);
  }
  job.settings = data.settings;

  await reporter.stage('queued', runUrl ? 'Render server started on GitHub Actions' : 'Render started');
  const workDir = process.env.RENDER_WORKDIR || path.join(os.tmpdir(), `autotube-${jobId}`);
  try {
    const result = await processJob(job, reporter, { workDir, upload: !args.includes('--no-upload') });
    if (process.env.OUTPUT_DIR) {
      fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });
      fs.copyFileSync(result.outPath, path.join(process.env.OUTPUT_DIR, `${jobId}.mp4`));
      if (fs.existsSync(result.thumbPath)) fs.copyFileSync(result.thumbPath, path.join(process.env.OUTPUT_DIR, `${jobId}.jpg`));
    }
  } catch (err) {
    console.error(err.stack);
    await reporter.fail(err);
    process.exit(1);
  }
}

main().catch(async (e) => { console.error(e); process.exit(1); });
