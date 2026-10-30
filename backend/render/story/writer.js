// Claude writes a kids' story as structured data (Hindi), and this module validates it.
// Output shape:
// { title, moral, cast: [{id, species, name, voice}], scenes: [{background, characters: [ids], beats: [...] }],
//   description, tags, thumbnailText }
// beat: { speaker: 'narrator' | castId, text, emotion?, question?, actions?: [{who, do, to?, item?, from?}] }

const SPECIES = ['rabbit', 'tortoise', 'lion', 'fox', 'monkey', 'mouse', 'elephant', 'bear', 'crow', 'deer', 'crocodile'];
const SPECIES_HI = { rabbit: 'खरगोश', tortoise: 'कछुआ', lion: 'शेर', fox: 'लोमड़ी', monkey: 'बंदर', mouse: 'चूहा', elephant: 'हाथी', bear: 'भालू', crow: 'कौआ', deer: 'हिरण', crocodile: 'मगरमच्छ' };
const BACKGROUNDS = ['jungle', 'riverbank', 'village', 'night', 'meadow'];
const VOICES = ['child', 'child_m', 'tiny', 'deep', 'deep_soft', 'gentle_big', 'sly', 'old', 'crow', 'soft_f', 'female', 'male'];
const DEFAULT_VOICE = { rabbit: 'child', tortoise: 'old', lion: 'deep', fox: 'sly', monkey: 'child_m', mouse: 'tiny', elephant: 'gentle_big', bear: 'deep_soft', crow: 'crow', deer: 'soft_f', crocodile: 'deep' };
const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'scared', 'proud', 'sleepy', 'thinking', 'crying', 'laughing'];
const ACTIONS = ['enter', 'exit', 'walk_to', 'run_to', 'jump', 'celebrate', 'wave', 'point', 'give', 'sleep', 'wake', 'think', 'cry', 'laugh', 'angry', 'scared', 'fall', 'fly', 'land'];
const ITEMS = ['fruit', 'jamun', 'carrot', 'roti', 'water', 'stone', 'cheese', 'gift', 'flower', 'honey'];

// Classic tales the writer can pick from (it may also adapt others with the same cast)
const CLASSICS = [
  'खरगोश और कछुआ (the hare and the tortoise)', 'बंदर और मगरमच्छ (the monkey and the crocodile)',
  'शेर और चूहा (the lion and the mouse)', 'प्यासा कौआ (the thirsty crow)', 'लोमड़ी और कौआ (the fox and the crow)',
  'चतुर खरगोश और शेर (the clever hare and the lion — the well)', 'लोमड़ी और अंगूर (the fox and the grapes)',
  'हाथी और चूहे (the elephants and the mice)', 'भालू और दो दोस्त (the bear and two friends)', 'हिरण, कौआ और लोमड़ी (the deer, the crow and the jackal)',
];

function prompt({ pastTitles, storyHint }) {
  return `तुम बच्चों (3–8 साल) के लिए एक बहुत प्यारी, मज़ेदार हिंदी कहानी लिखने वाले लेखक हो — पंचतंत्र/जातक/हितोपदेश शैली में।

Write ONE complete animated story script in simple, warm Hindi (Devanagari), 3–5 minutes long when narrated (about 40–60 beats).
${storyHint ? `Story to tell: ${storyHint}` : `Pick a classic you have NOT done yet: ${CLASSICS.join('; ')}`}
${pastTitles.length ? `Already made (don't repeat): ${pastTitles.slice(0, 30).join(', ')}` : ''}

Make it irresistible for kids:
- A narrator (warm storyteller) + characters who TALK in their own voices. Dialogue should be lively, a bit funny, with sound words (धम्म!, छपाक!, हा हा हा!).
- Every 5–8 beats ask the kids a question as the narrator, with "question": true (e.g. "बच्चों, बताओ... अब खरगोश क्या करेगा?"). A pause follows automatically.
- Something visible happens often: characters enter, jump, run, give things, laugh, get scared, celebrate.
- Short sentences (max ~16 words per beat). Clear moral at the end.

CAST: only these animals (species ids): ${SPECIES.map(s => `${s} (${SPECIES_HI[s]})`).join(', ')}. Give each a cute Hindi name.
Voices (pick per character): child (young girl), child_m (young boy), tiny (very small squeaky), deep (big strong), deep_soft (big friendly), gentle_big (calm giant), sly (clever/cunning), old (wise old), crow (cawing bird), soft_f (gentle lady), female, male.
BACKGROUNDS: ${BACKGROUNDS.join(', ')} (crocodile only in "riverbank" — it stays in the water).
EMOTIONS: ${EMOTIONS.join(', ')}.
ACTIONS (on beats, "who" = cast id): enter {from: left|right}, exit {to: left|right}, walk_to {to: left|center|right|<castId>}, run_to {to: ...}, jump, celebrate, wave, point, give {to: castId, item: ${ITEMS.join('|')}}, sleep, wake, think, cry, laugh, angry, scared, fall, fly (crow only), land (crow only).
Max 3 characters on screen per scene. 3–6 scenes.

Respond with ONLY valid JSON:
{"title": "कहानी का नाम", "moral": "सीख (one sentence)", "thumbnailText": "2–4 Hindi words for the thumbnail",
 "description": "YouTube description in Hindi + a line in English (under 120 words)", "tags": ["8 tags, mix Hindi and English"],
 "cast": [{"id": "chiku", "species": "rabbit", "name": "चीकू", "voice": "child"}],
 "scenes": [{"background": "meadow", "characters": ["chiku", "kalu"], "beats": [
   {"speaker": "narrator", "text": "...", "actions": [{"who": "chiku", "do": "enter", "from": "left"}]},
   {"speaker": "chiku", "text": "...", "emotion": "proud", "actions": [{"who": "chiku", "do": "laugh"}]},
   {"speaker": "narrator", "text": "बच्चों, बताओ...?", "question": true}
 ]}]}`;
}

function parseJSON(raw) {
  const t = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}

const str = (v, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function validate(raw) {
  const story = { title: str(raw.title, 80), moral: str(raw.moral, 160), thumbnailText: str(raw.thumbnailText, 40), description: str(raw.description, 900), tags: (Array.isArray(raw.tags) ? raw.tags : []).map(t => str(t, 40)).filter(Boolean).slice(0, 15) };
  if (!story.title) throw new Error('Story has no title');
  const cast = [];
  for (const c of Array.isArray(raw.cast) ? raw.cast : []) {
    const id = str(c && c.id, 24).toLowerCase().replace(/[^a-z0-9_]/g, '');
    const species = SPECIES.includes(c && c.species) ? c.species : null;
    if (!id || !species || cast.find(x => x.id === id)) continue;
    cast.push({ id, species, name: str(c.name, 20) || SPECIES_HI[species], voice: VOICES.includes(c.voice) ? c.voice : DEFAULT_VOICE[species] });
  }
  if (!cast.length) throw new Error('Story has no valid cast');
  const ids = new Set(cast.map(c => c.id));
  story.cast = cast;
  story.scenes = [];
  for (const sc of Array.isArray(raw.scenes) ? raw.scenes : []) {
    let background = BACKGROUNDS.includes(sc && sc.background) ? sc.background : 'jungle';
    const chars = (Array.isArray(sc && sc.characters) ? sc.characters : []).map(x => String(x).toLowerCase()).filter(x => ids.has(x));
    const beats = [];
    for (const b of Array.isArray(sc && sc.beats) ? sc.beats : []) {
      const text = str(b && b.text, 220);
      if (!text) continue;
      const speaker = b.speaker === 'narrator' || !ids.has(String(b.speaker).toLowerCase()) ? 'narrator' : String(b.speaker).toLowerCase();
      const actions = (Array.isArray(b.actions) ? b.actions : []).map(a => ({
        who: String(a && a.who || '').toLowerCase(), do: ACTIONS.includes(a && a.do) ? a.do : null,
        to: a && a.to ? String(a.to).toLowerCase() : undefined, from: a && (a.from === 'right' ? 'right' : a.from === 'left' ? 'left' : undefined), item: ITEMS.includes(a && a.item) ? a.item : 'fruit',
      })).filter(a => ids.has(a.who) && a.do).slice(0, 3);
      actions.forEach(a => { if (!chars.includes(a.who) && chars.length < 3) chars.push(a.who); });
      if (speaker !== 'narrator' && !chars.includes(speaker) && chars.length < 3) chars.push(speaker);
      beats.push({ speaker, text, emotion: EMOTIONS.includes(b.emotion) ? b.emotion : undefined, question: !!b.question, actions });
    }
    if (!beats.length) continue;
    const onScreen = chars.slice(0, 3);
    if (onScreen.some(id => cast.find(c => c.id === id).species === 'crocodile')) background = 'riverbank';
    story.scenes.push({ background, characters: onScreen, beats });
  }
  if (!story.scenes.length) throw new Error('Story has no scenes');
  if (!story.moral) story.moral = 'अच्छाई की हमेशा जीत होती है।';
  if (!story.thumbnailText) story.thumbnailText = story.title;
  return story;
}

async function writeStory({ anthropic, model, pastTitles = [], storyHint = '' }) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const msg = await anthropic.messages.create({ model, max_tokens: 12000, messages: [{ role: 'user', content: prompt({ pastTitles, storyHint }) }] });
      return validate(parseJSON(msg.content[0].text));
    } catch (e) { lastErr = e; }
  }
  throw new Error('Story writing failed: ' + lastErr.message);
}

// Plain-text version for the review modal (and the job's "script" field)
function storyToScript(story) {
  const name = id => (story.cast.find(c => c.id === id) || {}).name || id;
  const lines = [`# ${story.title}`, ''];
  story.scenes.forEach((s, i) => {
    lines.push(`## दृश्य ${i + 1}`);
    s.beats.forEach(b => lines.push(`${b.speaker === 'narrator' ? 'सूत्रधार' : name(b.speaker)}: ${b.text}${b.question ? '  (सवाल)' : ''}`));
    lines.push('');
  });
  lines.push(`सीख: ${story.moral}`);
  return lines.join('\n');
}

module.exports = { writeStory, validate, storyToScript, SPECIES, BACKGROUNDS, VOICES, DEFAULT_VOICE };
