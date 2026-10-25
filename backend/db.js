// Lightweight JSON file-based DB — no external DB needed
const fs = require('fs');
const path = require('path');

// Use persistent disk if mounted (survives redeploys), else fall back to local
const DB_FILE = process.env.RENDER
  ? '/opt/render/project/src/backend/data/data.json'
  : path.join(__dirname, 'data.json');

const DEFAULT = {
  videos: [],      // all video jobs
  settings: {
    niche: process.env.CHANNEL_NICHE || 'personal finance',
    audience: process.env.CHANNEL_AUDIENCE || 'global English',
    frequencyDays: parseInt(process.env.VIDEO_FREQUENCY_DAYS || '2'),
    voiceId: process.env.ELEVENLABS_VOICE_ID || '',
    publishHour: 18,   // 6 PM IST
    isRunning: true,
  },
  nextGenerateAt: null,
};

function load() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT, null, 2));
    return JSON.parse(JSON.stringify(DEFAULT));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function save(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function get() { return load(); }

function update(fn) {
  const data = load();
  fn(data);
  save(data);
  return data;
}

module.exports = { get, update };
