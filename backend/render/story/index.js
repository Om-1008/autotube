// Kids' story job: story JSON (written by Claude at generate time) → multi-voice soundtrack →
// 2D animation → YouTube (made for kids).
const fs = require('fs');
const { buildStoryAudio } = require('./audio');
const { renderStory } = require('./render');
const { youtubeTitle } = require('./writer');

async function processStoryJob(job, reporter, { workDir, upload = true } = {}) {
  const story = job.story;
  if (!story || !story.scenes) throw new Error('Job has no story');

  await reporter.stage('voiceover', `${story.cast.length} characters, ${story.scenes.reduce((a, s) => a + s.beats.length, 0)} lines`);
  const brand = (job.settings && job.settings.channelName) || process.env.KIDS_CHANNEL_NAME || 'कहानी पिटारा';
  const audio = await buildStoryAudio(story, workDir, reporter, { brand });
  reporter.log(`Soundtrack ready: ${(audio.total / 60).toFixed(1)} min`);

  await reporter.stage('rendering', `Animating ${story.scenes.length} scenes`);
  const H = parseInt(process.env.OUTPUT_HEIGHT_ANIMATED || '1440', 10);
  const { videoPath, thumbPath } = await renderStory({ story, audio, brand, workDir, reporter, width: Math.round((H * 16) / 9) });
  const sizeMB = +(fs.statSync(videoPath).size / 1048576).toFixed(1);
  const stats = { durationSec: Math.round(audio.total), sizeMB, shots: story.scenes.length, voice: 'kokoro', style: 'story' };
  reporter.log(`Video rendered: ${(audio.total / 60).toFixed(1)} min, ${sizeMB} MB`);

  if (!upload) { await reporter.done('rendered', { stats }); return { outPath: videoPath, thumbPath, stats }; }
  const yt = require('../../youtube');
  if (!(await yt.isYouTubeConnected('kids'))) {
    await reporter.done('rendered', { stats, note: 'Kahani Pitara YouTube is not connected — download the MP4 from the render run.' });
    return { outPath: videoPath, thumbPath, stats };
  }
  await reporter.stage('uploading', `${sizeMB} MB`);
  const seo = require('../../seo');
  // Subtitles: Hindi exactly as spoken, plus an English translation
  const spoken = audio.lines.filter(l => l.text && l.end > l.start);
  const captions = [{ lang: 'hi', name: 'हिंदी', srt: seo.toSrt(seo.cuesFromLines(spoken)) }];
  try {
    const en = await seo.translateLines(spoken.map(l => l.text), 'English', 'These are lines from a Hindi animated story for young children.');
    if (en) captions.push({ lang: 'en', name: 'English', srt: seo.toSrt(seo.cuesFromLines(spoken.map((l, i) => ({ ...l, text: en[i] })))) });
  } catch (e) { reporter.log(`English subtitles skipped (${e.message.slice(0, 80)})`); }
  const title = youtubeTitle({ ...story, title: job.title || story.title });
  const castNames = story.cast.map(c => `${c.name} (${c.species})`).join(', ');
  const { videoId, videoUrl, thumbnailSet } = await yt.uploadVideo(videoPath, {
    kids: true, title, description: story.description, tags: story.tags, moral: story.moral, captions,
    searchQueries: story.searchQueries && story.searchQueries.length ? story.searchQueries : [`${story.englishTitle || story.title} story in hindi`],
    seoContext: `Hindi animated moral story for kids aged 3-8: "${story.title}"${story.englishTitle ? ` (${story.englishTitle})` : ''}. Characters: ${castNames}. Moral: ${story.moral}`,
    hashtags: ['#HindiKahani', '#Panchatantra', '#MoralStories', '#BachonKiKahani'],
    playlist: { title: process.env.KIDS_PLAYLIST || 'पंचतंत्र की कहानियाँ | Panchatantra Stories in Hindi', description: 'बच्चों के लिए प्यारी हिंदी कहानियाँ — हर कहानी में एक सीख। Animated Hindi moral stories for kids.' },
  }, { channel: 'kids', thumbnailPath: thumbPath, onProgress: p => reporter.progress(p, `Uploaded ${p}%`), log: m => reporter.log(m) });
  if (!thumbnailSet) reporter.log('Custom thumbnail not applied (needs a phone-verified YouTube channel)');
  reporter.log(`🎉 Live on YouTube: ${videoUrl}`);
  await reporter.done('uploaded', { stats, youtubeId: videoId, youtubeUrl: videoUrl, uploadedAt: new Date().toISOString() });
  return { outPath: videoPath, thumbPath, stats, videoId, videoUrl };
}

module.exports = { processStoryJob };
