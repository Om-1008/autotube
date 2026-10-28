#!/usr/bin/env node
// Dependency-free status ping used by the GitHub workflow before `npm ci`, so the
// dashboard shows the runner has started while tools are still installing.
//   node job-ping.js <jobId> "<message>"
const jobstate = require('./jobstate');

(async () => {
  const [jobId, message] = process.argv.slice(2);
  if (!jobId) return;
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;
  const cur = await jobstate.read(jobId);
  const base = cur && cur.phase === 'render' && cur.status === 'queued' ? cur : {};
  const r = jobstate.createReporter(jobId, 'render', { ...base, runUrl });
  await r.stage('queued', message || 'Render server started');
})().catch(e => { console.error('ping failed:', e.message); });
