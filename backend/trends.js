// "Use what's trending" topic picking (used only when you choose it, or when scheduled runs are set to).
// Evidence: (1) videos in the niche published in the last 14 days, ranked by views per day,
// (2) Claude's web search for this week's news / upcoming festivals. Claude then picks ONE topic
// that is rising but still fits the channel, and explains why. Any failure → caller falls back
// to the normal flow.
const MODEL = process.env.TREND_MODEL || 'claude-sonnet-4-6';

async function youtubeRising(youtube, { queries, lang, region, days = 14, log }) {
  if (!youtube) return [];
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const ids = new Set();
  for (const q of queries) {
    try {
      const r = await youtube.search.list({
        part: ['id'], q, type: ['video'], order: 'viewCount', maxResults: 25, publishedAfter: since,
        relevanceLanguage: lang, ...(region ? { regionCode: region } : {}), safeSearch: 'strict',
      });
      (r.data.items || []).forEach(i => i.id && i.id.videoId && ids.add(i.id.videoId));
    } catch (e) { log(`YouTube trend check skipped (${e.message.slice(0, 100)})`); return []; }
  }
  if (!ids.size) return [];
  const v = await youtube.videos.list({ part: ['snippet', 'statistics', 'contentDetails'], id: [...ids].slice(0, 50) });
  const now = Date.now();
  return (v.data.items || [])
    .filter(i => !/^PT(\d{1,2}S|[0-5]M\d*S?)$/.test(i.contentDetails.duration || ''))   // skip Shorts / very short clips
    .map(i => {
      const views = +(i.statistics.viewCount || 0);
      const ageDays = Math.max(0.5, (now - new Date(i.snippet.publishedAt).getTime()) / 86400000);
      return { title: i.snippet.title, channel: i.snippet.channelTitle, views, perDay: Math.round(views / ageDays), ageDays: Math.round(ageDays) };
    })
    .sort((a, b) => b.perDay - a.perDay)
    .slice(0, 15);
}

const fmt = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));

function parseJSONLoose(text) {
  const t = text.replace(/```json|```/g, '');
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}

async function askWithSearch(anthropic, prompt, maxUses = 3) {
  const msg = await anthropic.messages.create({
    model: MODEL, max_tokens: 2500,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }],
    messages: [{ role: 'user', content: prompt }],
  });
  const text = msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  const searches = (msg.usage && msg.usage.server_tool_use && msg.usage.server_tool_use.web_search_requests) || 0;
  return { data: parseJSONLoose(text), searches };
}

function risingBlock(rising) {
  return rising.length
    ? rising.map(r => `- "${r.title}" — ${fmt(r.perDay)} views/day (${fmt(r.views)} in ${r.ageDays}d, ${r.channel})`).join('\n')
    : '(no YouTube data available — rely on web search)';
}

// ── WealthSutra ──
async function trendingFinanceTopic({ anthropic, youtube, niche, audience, pastTitles = [], log = () => {} }) {
  const today = new Date().toISOString().slice(0, 10);
  const rising = await youtubeRising(youtube, { queries: [`${niche}`, `${niche} tips ${new Date().getFullYear()}`], lang: 'en', log });
  if (rising.length) log(`Rising on YouTube: ${rising.slice(0, 3).map(r => `“${r.title.slice(0, 50)}” (${fmt(r.perDay)}/day)`).join(' · ')}`);
  const { data, searches } = await askWithSearch(anthropic, `Today is ${today}. You pick the next video for a ${niche} YouTube channel for a ${audience} audience (beginner-friendly explainers, 8–10 minutes).

Fast-rising ${niche} videos from the last 14 days (views per day):
${risingBlock(rising)}

Use web search (2–3 searches) to find what in ${niche} is trending THIS WEEK: news, rule/tax/rate changes, deadlines, viral money questions.
Then choose ONE topic that is rising right now but where a clear, helpful beginner video can still stand out (our own angle, not a copy of a title above).
Avoid: ${pastTitles.slice(0, 20).join('; ') || 'nothing yet'}.
Only include facts you found in sources; they will be used in the script.

Respond with ONLY JSON:
{"title": "YouTube title, under 70 chars", "hook": "first-30-seconds hook", "searchKeywords": ["3 search phrases"],
 "whyNow": "one sentence", "why": "one or two sentences: the trend evidence behind this pick",
 "facts": ["up to 6 short, sourced facts the script may use, with numbers/dates"],
 "sources": [{"title": "...", "url": "https://..."}]}`);
  log(`Web research: ${searches} search${searches === 1 ? '' : 'es'}`);
  if (!data.title) throw new Error('No trending topic returned');
  return {
    topic: { title: String(data.title).slice(0, 100), hook: data.hook || '', searchKeywords: (data.searchKeywords || []).slice(0, 3), whyNow: data.whyNow || '', facts: (data.facts || []).slice(0, 6) },
    trend: { why: data.why || data.whyNow || '', sources: (data.sources || []).filter(s => s && /^https?:\/\//.test(s.url || '')).slice(0, 5), rising: rising.slice(0, 5) },
  };
}

// ── Kahani Pitara ──
async function trendingStoryIdea({ anthropic, youtube, pastTitles = [], species = [], log = () => {} }) {
  const today = new Date().toISOString().slice(0, 10);
  const rising = await youtubeRising(youtube, { queries: ['hindi kahani bachon ki', 'moral stories in hindi for kids'], lang: 'hi', region: 'IN', log });
  if (rising.length) log(`Rising kids' stories: ${rising.slice(0, 3).map(r => `“${r.title.slice(0, 45)}” (${fmt(r.perDay)}/day)`).join(' · ')}`);
  const { data, searches } = await askWithSearch(anthropic, `Today is ${today}. You pick the next animated Hindi moral story for a kids' YouTube channel (ages 3–8, Panchatantra style, animal characters).

Fast-rising Hindi kids' story videos from the last 14 days (views per day):
${risingBlock(rising)}

Use web search (1–2 searches) for Indian festivals, special days or school events in the next 3 weeks (e.g. Children's Day, Diwali, Holi, exams) that families with young kids care about.
Then choose ONE story idea that rides a rising theme or an upcoming occasion, told ONLY with these animals: ${species.join(', ')}.
Settings available: jungle, riverbank, village, night, meadow. Keep it gentle, kind and age-appropriate, with a clear moral. Don't copy any video above.
Avoid stories already made: ${pastTitles.slice(0, 20).join('; ') || 'none yet'}.

Respond with ONLY JSON:
{"storyHint": "2–3 sentences in English: the story to write (characters, what happens, the moral, the occasion if any)",
 "why": "one or two sentences: the trend/occasion behind this pick", "occasion": "festival/day name or empty",
 "sources": [{"title": "...", "url": "https://..."}]}`, 2);
  log(`Web research: ${searches} search${searches === 1 ? '' : 'es'}`);
  if (!data.storyHint) throw new Error('No trending story idea returned');
  return {
    storyHint: String(data.storyHint).slice(0, 600),
    trend: { why: data.why || '', occasion: data.occasion || '', sources: (data.sources || []).filter(s => s && /^https?:\/\//.test(s.url || '')).slice(0, 5), rising: rising.slice(0, 5) },
  };
}

// ── Apna Motivation ──
async function trendingMotivation({ anthropic, youtube, person, log = () => {} }) {
  const today = new Date().toISOString().slice(0, 10);
  const rising = await youtubeRising(youtube, { queries: [`${person} motivation hindi`, 'motivational video hindi students'], lang: 'hi', region: 'IN', log });
  if (rising.length) log(`Rising motivation videos: ${rising.slice(0, 3).map(r => `“${r.title.slice(0, 45)}” (${fmt(r.perDay)}/day)`).join(' · ')}`);
  const { data, searches } = await askWithSearch(anthropic, `Today is ${today}. You plan the next Hinglish motivation video on teachings of ${person}, for young Indians (students, job seekers, young professionals).

Fast-rising Hindi motivation videos from the last 14 days (views per day):
${risingBlock(rising)}

Use web search (1–2 searches) for what young Indians are going through right now: exams/results season, placements, layoffs, festivals, New Year, special days (e.g. Teachers' Day, Youth Day).
Choose ONE angle that rides a rising theme or occasion and that ${person}'s genuine teachings can speak to. Don't copy any video above.

Respond with ONLY JSON: {"angle": "1–2 sentences in English: the theme the 3 teachings should address and why now", "why": "one sentence: the trend evidence", "sources": [{"title": "...", "url": "https://..."}]}`, 2);
  log(`Web research: ${searches} search${searches === 1 ? '' : 'es'}`);
  if (!data.angle) throw new Error('No trending angle returned');
  return { angle: String(data.angle).slice(0, 400), trend: { why: data.why || '', sources: (data.sources || []).filter(x => x && /^https?:\/\//.test(x.url || '')).slice(0, 5), rising: rising.slice(0, 5) } };
}

module.exports = { trendingFinanceTopic, trendingStoryIdea, trendingMotivation, youtubeRising };
