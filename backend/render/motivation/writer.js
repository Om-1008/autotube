// Apna Motivation: Claude writes a Hinglish long video (3 lessons) + one Short per lesson as
// structured data. Each teaching must be genuine and sourced; a second pass with web search
// checks the references, and used references are remembered so nothing repeats.
const ICONS = ['skill', 'goal', 'globe', 'speech', 'clock', 'book', 'flame', 'shield', 'crown', 'heart'];
const NUM = ['ज़ीरो', 'वन', 'टू', 'थ्री', 'फ़ोर', 'फ़ाइव'];

function parseJSON(raw) {
  const t = raw.replace(/```json|```/g, '');
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}
const str = (v, max = 300) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function prompt({ person, items, shorts, trend }) {
  return `You write scripts for "Apna Motivation", a Hindi/Hinglish motivation YouTube channel (young Indian audience: students, job seekers, young professionals).
Today's person: ${person}.${trend ? `\nTheme of this video (trending): ${trend}` : ''}

Write one lesson for EACH of these verified teachings, in this order. The lesson's explanation must faithfully convey the given meaning — do not change what the teaching says.
${items.map((it, i) => `${i + 1}. [${it.ref}] ${it.original.join(' / ')}\n   Meaning: ${it.meaning}`).join('\n')}
Use each "original" and "ref" exactly as given.

Language: Hinglish — everyday Hindi with natural English words, warm and energetic, like a friendly mentor. Short sentences (max ~14 words).
Every narration line has two forms:
- "speak": Devanagari, English words written phonetically in Devanagari (for the voice), e.g. "अगर आपके अंदर स्किल्स हैं, तो कोई काम भारी नहीं।"
- "show": the same line in Roman Hinglish for on-screen captions, e.g. "Agar aapke andar skills hain, toh koi kaam bhaari nahi."
For the original verse/quote lines (part "original"), speak and show are the original text (Sanskrit/Hindi/English as written).

Rules for narration:
- The original verse/quote is recited automatically right before a lesson's narration — do NOT repeat, transliterate or re-read it, and never say verse/chapter numbers (they are shown on screen).
- Start a lesson's narration with the meaning ("Matlab…", "Chanakya kehte hain…").
- No statistics or "experts say" claims; a stat number must follow from your own narration (e.g. 1 ghanta roz → 365 ghante saal mein).
Each lesson: a short punchy title, the original (1–2 lines), 2–4 "points" (icon + 1–2 word key + 3–5 word line) explained one by one, then a modern-life example (studies, career, money, relationships, discipline). Optionally one "stat": "big" must be a plain number (e.g. "365") that follows from the narration; "small" is 2–4 words (e.g. "GHANTE / SAAL").
Icons allowed: ${ICONS.join(', ')}.

Respond with ONLY JSON:
{"title": "YouTube title, Roman Hinglish, under 70 chars, curiosity + benefit",
 "thumbnailText": "2–4 Roman words", "description": "3 short paragraphs, Hinglish, list the teachings and their sources", "tags": ["10 tags, Hindi + English"],
 "searchQueries": ["2 phrases people type, e.g. 'chanakya niti for students'"],
 "intro": [{"speak": "...", "show": "..."}],                    // 2–3 hook lines
 "lessons": [{"title": "...", "ref": "e.g. Chanakya Niti 3.13", "original": ["line 1", "line 2"],
   "points": [{"icon": "skill", "key": "Skills", "text": "Koi kaam bhaari nahi"}],
   "stat": {"icon": "clock", "big": "365", "small": "GHANTE / SAAL"} or null,
   "narration": [{"speak": "...", "show": "...", "part": "intro|points|example", "point": 0, "stat": false}]}],
 "outro": [{"speak": "...", "show": "..."}],                    // 1–2 closing lines; must ask to like, share and subscribe to Apna Motivation
 "shorts": [{"lesson": 0, "title": "Short title + #Shorts", "hook": "4–7 Roman words for the top banner",
   "narration": [{"speak": "...", "show": "...", "part": "hook|points|example", "point": 0, "stat": false}]}]   // ${shorts} shorts, 25–40 seconds each, one per lesson, end with a line asking to subscribe for more
}
In lesson/short narration, put "point": i on the line that explains points[i]; mark the line that states the stat number with "stat": true.`;
}

function pickPrompt(person, usedRefs, n, hint, trend) {
  const isChanakya = /chanakya|चाणक्य|kautilya/i.test(person);
  return `Pick ${n} GENUINE teachings of ${person} for a motivation video for young Indians (students, job seekers, young professionals).
${trend ? `They should speak to this trending theme: ${trend}\n` : ''}${hint ? `Owner's topic idea: ${hint}\n` : ''}${isChanakya ? 'Use only verses from Chanakya Niti (Chanakya Neeti Darpan): exact Sanskrit text.' : `Use only words ${person} actually said or wrote (books, speeches, letters) — no popular misattributed quotes.`}
Not already used: ${usedRefs.length ? usedRefs.join('; ') : 'none'}.
Verify each with web search (the text is real and correctly attributed). Edition numbering differences are fine.
If fewer than ${n} genuine unused ones remain, return as many as you can; if none, return {"exhausted": true}.

Respond with ONLY JSON: {"items": [{"ref": "SHORT reference, e.g. 'Chanakya Niti 3.13' or 'Wings of Fire, ch. 4'", "original": ["line 1", "line 2"],
  "meaning": "faithful plain-English meaning of exactly this text", "theme": "2-4 word life theme"}]}`;
}

function cleanLine(x) { return x && str(x.speak) && str(x.show) ? { speak: str(x.speak, 240), show: str(x.show, 240), part: str(x.part, 12), point: Number.isInteger(x.point) ? x.point : undefined, stat: !!x.stat } : null; }

function validate(raw, wantShorts) {
  if (raw.exhausted) { const e = new Error('exhausted'); e.exhausted = true; throw e; }
  const lessons = (raw.lessons || []).map(l => ({
    title: str(l.title, 70), ref: str(l.ref, 80),
    original: (Array.isArray(l.original) ? l.original : [l.original]).map(o => str(o, 160)).filter(Boolean).slice(0, 3),
    points: (l.points || []).map(p => ({ icon: ICONS.includes(p.icon) ? p.icon : 'flame', key: str(p.key, 18), text: str(p.text, 34) })).filter(p => p.key).slice(0, 4),
    stat: l.stat && /^\d[\d,.]*\s*%?$/.test(str(l.stat.big, 10)) && Number(str(l.stat.big).replace(/[^0-9.]/g, '')) >= 2 ? { icon: ICONS.includes(l.stat.icon) ? l.stat.icon : 'clock', big: str(l.stat.big, 10), small: str(l.stat.small, 32).toUpperCase() } : null,
    narration: (l.narration || []).map(cleanLine).filter(Boolean),
  })).filter(l => l.title && l.original.length && l.narration.length);
  if (!lessons.length) throw new Error('Script has no usable lessons');
  const v = {
    title: str(raw.title, 100), thumbnailText: str(raw.thumbnailText, 40) || str(raw.title, 40),
    description: str(raw.description, 1500), tags: (raw.tags || []).map(t => str(t, 40)).filter(Boolean).slice(0, 15),
    searchQueries: (raw.searchQueries || []).map(q => str(q, 60)).filter(Boolean).slice(0, 2),
    intro: (raw.intro || []).map(cleanLine).filter(Boolean).slice(0, 4),
    outro: (raw.outro || []).map(cleanLine).filter(Boolean).slice(0, 3),
    lessons,
  };
  if (!v.outro.length) v.outro = [{ speak: 'अगर ये बातें आपको अच्छी लगीं, तो वीडियो को लाइक कीजिए, दोस्तों के साथ शेयर कीजिए, और अपना मोटिवेशन को सब्सक्राइब कीजिए!', show: 'Agar ye baatein aapko achhi lagi, toh video ko like kijiye, doston ke saath share kijiye, aur Apna Motivation ko subscribe kijiye!' }];
  v.shorts = (raw.shorts || []).map(s => ({
    lesson: Math.min(lessons.length - 1, Math.max(0, parseInt(s.lesson, 10) || 0)), title: str(s.title, 95), hook: str(s.hook, 60),
    narration: (s.narration || []).map(cleanLine).filter(Boolean),
  })).filter(s => s.narration.length && s.hook).slice(0, wantShorts);
  return v;
}

async function writeMotivation({ anthropic, model, person, usedRefs = [], lessons = 3, shorts = 2, hint = '', trend = '', log = () => {} }) {
  // 1. pick + verify the teachings (web search)
  const pick = await anthropic.messages.create({
    model, max_tokens: 4000, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    messages: [{ role: 'user', content: pickPrompt(person, usedRefs, lessons, hint, trend) }],
  });
  const picked = parseJSON(pick.content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
  if (picked.exhausted) { const e = new Error('exhausted'); e.exhausted = true; throw e; }
  const used = new Set(usedRefs.map(r => r.toLowerCase()));
  const items = (picked.items || []).map(it => ({ ref: str(it.ref, 60), original: (Array.isArray(it.original) ? it.original : [it.original]).map(o => str(o, 160)).filter(Boolean).slice(0, 3), meaning: str(it.meaning, 400), theme: str(it.theme, 40) }))
    .filter(it => it.ref && it.original.length && it.meaning && !used.has(it.ref.toLowerCase())).slice(0, lessons);
  if (!items.length) { const e = new Error('exhausted'); e.exhausted = true; throw e; }
  log(`Verified teachings: ${items.map(it => it.ref).join(' · ')}`);
  // 2. write the script around them
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const msg = await anthropic.messages.create({ model, max_tokens: 16000, messages: [{ role: 'user', content: prompt({ person, items, shorts: Math.min(shorts, items.length), trend }) }] });
      const v = validate(parseJSON(msg.content.filter(c => c.type === 'text').map(c => c.text).join('')), Math.min(shorts, items.length));
      v.lessons = v.lessons.slice(0, items.length);
      v.lessons.forEach((l, i) => { l.ref = items[i].ref; l.original = items[i].original; l.meaning = items[i].meaning; });
      return v;
    } catch (e) { lastErr = e; }
  }
  throw new Error('Script writing failed: ' + lastErr.message);
}

// Plain-text version for the review modal
function toReviewText(v, person) {
  const L = [`# ${v.title}`, '', ...v.intro.map(l => l.show), ''];
  v.lessons.forEach((l, i) => {
    L.push(`## Lesson ${i + 1}: ${l.title}`, `📜 ${l.original.join(' / ')}  (${l.ref})`);
    l.narration.forEach(n => L.push(n.show));
    L.push('');
  });
  L.push(...v.outro.map(l => l.show), '');
  v.shorts.forEach((s, i) => { L.push(`## Short ${i + 1}: ${s.title}`, `[${s.hook}]`); s.narration.forEach(n => L.push(n.show)); L.push(''); });
  return L.join('\n');
}

// Long video / Short → phrase list with segment tags (consumed by the renderer)
function longPhrases(v, person) {
  const out = v.intro.map(l => ({ ...l, seg: 'title' }));
  v.lessons.forEach((l, i) => {
    out.push({ speak: `लेसन नंबर ${NUM[i + 1] || i + 1}।`, show: `Lesson number ${['zero', 'one', 'two', 'three', 'four', 'five'][i + 1] || i + 1}.`, seg: 'lesson', lesson: i });
    l.original.forEach(o => out.push({ speak: o, show: o, seg: 'shloka', noCaption: true, lesson: i }));
    let inStat = false;   // once the stat card appears it stays for the rest of the lesson
    l.narration.forEach(n => { if (l.stat && (n.stat || n.part === 'example')) inStat = true; out.push({ ...n, seg: inStat ? 'stat' : 'points', lesson: i }); });
  });
  v.outro.forEach(l => out.push({ ...l, seg: 'cta' }));
  return out;
}
function shortPhrases(v, s) {
  const l = v.lessons[s.lesson];
  const out = [];
  let inStat = false;
  s.narration.forEach((n, k) => {
    if (k === 1) out.push({ speak: l.original[0], show: l.original[0], seg: 'shloka', noCaption: true, lesson: s.lesson });
    if (n.part !== 'hook' && l.stat && (n.stat || n.part === 'example')) inStat = true;
    out.push({ ...n, seg: n.part === 'hook' ? 'hookonly' : (inStat ? 'stat' : 'points'), lesson: s.lesson });
  });
  const last = out[out.length - 1];
  if (!/subscrib/i.test(last.show)) out.push({ speak: 'ऐसी और बातों के लिए लाइक, शेयर और सब्सक्राइब करो!', show: 'Aisi aur baaton ke liye like, share aur subscribe karo!' });
  out[out.length - 1].seg = 'cta';
  return out;
}

module.exports = { writeMotivation, toReviewText, longPhrases, shortPhrases, ICONS };
