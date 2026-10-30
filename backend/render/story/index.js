// Kids' story job: story JSON (written by Claude at generate time) → multi-voice soundtrack →
// 2D animation → YouTube (made for kids).
const fs = require('fs');
const { buildStoryAudio } = require('./audio');
const { renderStory } = require('./render');

async function processStoryJob(job, reporter, { workDir, upload = true } = {}) {
  const story = job.story;
  if (!story || !story.scenes) throw new Error('Job has no story');

  await reporter.stage('voiceover', `${story.cast.length} characters, ${story.scenes.reduce((a, s) => a + s.beats.length, 0)} lines`);
  const audio = await buildStoryAudio(story, workDir, reporter);
  reporter.log(`Soundtrack ready: ${(audio.total / 60).toFixed(1)} min`);

  await reporter.stage('rendering', `Animating ${story.scenes.length} scenes`);
  const H = parseInt(process.env.OUTPUT_HEIGHT_ANIMATED || '1440', 10);
  const brand = (job.settings && job.settings.channelName) || process.env.KIDS_CHANNEL_NAME || 'कहानी घर';
  const { videoPath, thumbPath } = await renderStory({ story, audio, brand, workDir, reporter, width: Math.round((H * 16) / 9) });
  const sizeMB = +(fs.statSync(videoPath).size / 1048576).toFixed(1);
  const stats = { durationSec: Math.round(audio.total), sizeMB, shots: story.scenes.length, voice: 'kokoro', style: 'story' };
  reporter.log(`Video rendered: ${(audio.total / 60).toFixed(1)} min, ${sizeMB} MB`);

  if (!upload) { await reporter.done('rendered', { stats }); return { outPath: videoPath, thumbPath, stats }; }
  const yt = require('../../youtube');
  if (!(await yt.isYouTubeConnected())) {
    await reporter.done('rendered', { stats, note: 'YouTube is not connected — download the MP4 from the render run.' });
    return { outPath: videoPath, thumbPath, stats };
  }
  await reporter.stage('uploading', `${sizeMB} MB`);
  const { videoId, videoUrl, thumbnailSet } = await yt.uploadVideo(videoPath, {
    kids: true, title: job.title || story.title, description: story.description, tags: story.tags, moral: story.moral,
  }, { thumbnailPath: thumbPath, onProgress: p => reporter.progress(p, `Uploaded ${p}%`) });
  if (!thumbnailSet) reporter.log('Custom thumbnail not applied (needs a phone-verified YouTube channel)');
  reporter.log(`🎉 Live on YouTube: ${videoUrl}`);
  await reporter.done('uploaded', { stats, youtubeId: videoId, youtubeUrl: videoUrl, uploadedAt: new Date().toISOString() });
  return { outPath: videoPath, thumbPath, stats, videoId, videoUrl };
}

module.exports = { processStoryJob };
