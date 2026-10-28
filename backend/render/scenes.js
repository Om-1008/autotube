// Parse a script into scenes: { broll, heading, sentences[] }.
// Tolerant of the formats Claude produces: markdown headings, **bold labels**,
// [SECTION] markers, inline [B-ROLL: ...] and [PAUSE] markers.

const GENERIC_HEADINGS = /^(hook|intro|introduction|opening|problem|the problem|problem setup|main content|content|body|cta|call to action|outro|conclusion|closing|wrap ?up|affiliate|affiliate mention|sponsor|sponsor segment|pause|transition|summary|recap|end screen)$/i;

function cleanHeading(s) {
  return s
    .replace(/^\[|\]$/g, '')
    .replace(/\(?\b\d{1,2}:\d{2}(\s*[-–—]\s*\d{1,2}:\d{2})?\)?/g, '')   // timestamps
    .replace(/\b(section|part)\s*\d+\s*[:.\-–—]\s*/i, '')
    .replace(/[*_#`]/g, '')
    .replace(/\s*[-–—:|]\s*$/g, '')
    .replace(/^\s*[-–—:|]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanNarration(s) {
  return s
    .replace(/\[PAUSE\]/gi, ' ')
    .replace(/\[[^\]]*\]/g, ' ')                 // any other bracket annotation
    .replace(/^\s*(narrator|vo|voiceover|host)\s*:\s*/i, '')
    .replace(/[*_#`~|\\^]/g, '')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text) {
  const raw = text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [];
  const out = [];
  for (let s of raw.map(x => x.trim()).filter(Boolean)) {
    // Merge very short fragments ("Boom." "Right?") into the previous sentence
    if (out.length && (s.length < 18 || out[out.length - 1].length < 18) && (out[out.length - 1].length + s.length) < 260) {
      out[out.length - 1] += ' ' + s;
    } else {
      out.push(s);
    }
  }
  // Hard-split anything very long at commas/semicolons
  return out.flatMap(s => {
    if (s.length <= 320) return [s];
    const parts = s.split(/(?<=[,;:])\s+/);
    const chunks = [];
    let cur = '';
    for (const p of parts) {
      if ((cur + ' ' + p).length > 280 && cur) { chunks.push(cur.trim()); cur = p; }
      else cur += (cur ? ' ' : '') + p;
    }
    if (cur) chunks.push(cur.trim());
    return chunks;
  });
}

function parseScript(script, videoTitle = '') {
  const tokens = [];
  const titleNorm = videoTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  let sawText = false;

  for (let line of String(script).replace(/\r/g, '').split('\n')) {
    line = line.trim();
    if (!line || /^([-*_=]\s*){3,}$/.test(line)) continue;

    const md = line.match(/^#{1,6}\s+(.*)$/);
    if (md) {
      const h = cleanHeading(md[1]);
      const hNorm = h.toLowerCase().replace(/[^a-z0-9]/g, '');
      const isTitle = !sawText && titleNorm && (hNorm === titleNorm || titleNorm.startsWith(hNorm.slice(0, 25)));
      if (!isTitle && h) tokens.push({ type: 'heading', text: h });
      continue;
    }

    const boldOnly = line.match(/^\*\*(.+?)\*\*:?$/);
    const bracketOnly = line.match(/^\[(?!B-ROLL)([^\]]+)\]$/i);
    const label = boldOnly ? boldOnly[1] : bracketOnly ? bracketOnly[1] : null;
    if (label && !/^\[?B-ROLL/i.test(label) && label.split(/\s+/).length <= 10 && !/[.!?]$/.test(label.trim())) {
      // A bold line that only wraps a B-ROLL marker is handled below
      if (!/\[B-ROLL:/i.test(label) && !/^PAUSE$/i.test(label.trim())) {
        const h = cleanHeading(label);
        if (h) tokens.push({ type: 'heading', text: h });
        continue;
      }
    }

    // Inline B-ROLL markers, in order
    const parts = line.split(/\[B-ROLL:\s*([^\]]*)\]/i);
    parts.forEach((part, i) => {
      if (i % 2 === 1) { tokens.push({ type: 'broll', text: part.trim() }); return; }
      const t = cleanNarration(part);
      if (t && /[a-z0-9]/i.test(t)) { tokens.push({ type: 'text', text: t }); sawText = true; }
    });
  }

  const scenes = [];
  let cur = null;
  const fresh = () => ({ broll: '', heading: '', text: '' });
  for (const tok of tokens) {
    if (tok.type === 'text') {
      if (!cur) cur = fresh();
      cur.text += (cur.text ? ' ' : '') + tok.text;
      continue;
    }
    // heading / broll start a new scene once the current one has narration
    if (!cur || cur.text) { if (cur) scenes.push(cur); cur = fresh(); }
    if (tok.type === 'heading') cur.heading = tok.text;
    else cur.broll = cur.broll ? cur.broll + ', ' + tok.text : tok.text;
  }
  if (cur && cur.text) scenes.push(cur);

  // Split very long scenes (> ~90 words) so footage changes topic with the narration
  const out = [];
  for (const s of scenes) {
    const sentences = splitSentences(s.text);
    let group = [];
    let words = 0;
    let first = true;
    for (const sen of sentences) {
      group.push(sen);
      words += sen.split(/\s+/).length;
      if (words >= 90) {
        out.push({ broll: s.broll, heading: first ? s.heading : '', sentences: group, continued: !first });
        group = []; words = 0; first = false;
      }
    }
    if (group.length) out.push({ broll: s.broll, heading: first ? s.heading : '', sentences: group, continued: !first });
  }

  return out.map((s, i) => ({
    index: i,
    broll: s.broll,
    heading: s.heading && !GENERIC_HEADINGS.test(s.heading) && s.heading.split(/\s+/).length <= 9 ? s.heading : '',
    sentences: s.sentences,
    text: s.sentences.join(' '),
  }));
}

module.exports = { parseScript, splitSentences, cleanNarration };
