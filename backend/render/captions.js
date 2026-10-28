// Build an ASS subtitle file: punchy word-chunk captions synced per sentence,
// an intro title card, section headings, and an end card. Rendered with libass.
const FONT = 'Anton';

function ts(sec) {
  const total = Math.round(Math.max(0, sec) * 100);   // centiseconds
  const h = Math.floor(total / 360000);
  const m = Math.floor((total % 360000) / 6000);
  const s = Math.floor((total % 6000) / 100);
  const cs = total % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function esc(t) {
  return String(t).replace(/\\/g, '/').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, '\\N');
}

// Gold highlight for numbers / money / percentages
function highlight(t) {
  return esc(t).replace(/(\$?\d[\d,.]*\s?(%|k|K|percent|dollars?)?)/g, '{\\c&H0000D7FF&}$1{\\c&H00FFFFFF&}');
}

function chunkSentence(text, maxWords = 6, maxChars = 34) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let cur = [];
  for (const w of words) {
    const candidate = [...cur, w].join(' ');
    if (cur.length && (cur.length >= maxWords || candidate.length > maxChars)) { chunks.push(cur.join(' ')); cur = []; }
    cur.push(w);
    // Prefer breaking right after punctuation once we have a few words
    if (/[,.;:!?]$/.test(w) && cur.length >= 3) { chunks.push(cur.join(' ')); cur = []; }
  }
  if (cur.length) {
    // Avoid a lonely 1-word tail
    if (cur.length === 1 && chunks.length && chunks[chunks.length - 1].split(' ').length < maxWords + 1) chunks[chunks.length - 1] += ' ' + cur[0];
    else chunks.push(cur.join(' '));
  }
  return chunks;
}

function wrapTwoLines(text, maxLine = 22) {
  if (text.length <= maxLine) return text;
  const words = text.split(' ');
  let best = text;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const diff = Math.abs(a.length - b.length);
    if (diff < bestDiff) { bestDiff = diff; best = `${a}\n${b}`; }
  }
  return best;
}

function buildASS({ timeline, scenes, plan, title, totalDuration, width = 1920, height = 1080 }) {
  const lines = [];
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${FONT},112,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,0,0,0,0,100,100,1,0,1,6,3,2,120,120,150,1
Style: Title,${FONT},150,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,1,0,1,7,4,5,160,160,0,1
Style: Heading,${FONT},92,&H00FFFFFF,&H00FFFFFF,&H00C8501E,&H00C8501E,0,0,0,0,100,100,1,0,3,18,0,8,120,120,70,1
Style: End,${FONT},140,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,1,0,1,7,4,5,160,160,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  // Intro title card (first ~4s)
  const introEnd = Math.min(4.2, totalDuration);
  lines.push(`Dialogue: 2,${ts(0)},${ts(introEnd)},Title,,0,0,0,,{\\fad(300,400)\\blur1}${esc(wrapTwoLines(title.toUpperCase(), 24))}`);

  // Section headings at the start of scenes
  scenes.forEach((s, si) => {
    const heading = s.heading || (plan && plan.scenes[si] && plan.scenes[si].heading) || '';
    if (!heading) return;
    const first = timeline.find(t => t.scene === si);
    if (!first || first.start < introEnd) return;
    lines.push(`Dialogue: 1,${ts(first.start)},${ts(Math.min(first.start + 3.8, totalDuration))},Heading,,0,0,0,,{\\fad(250,300)}${esc(heading.toUpperCase())}`);
  });

  // Captions
  for (const seg of timeline) {
    const chunks = chunkSentence(seg.text);
    const totalChars = chunks.reduce((a, c) => a + c.length + 6, 0);
    let t = seg.start;
    const span = seg.end - seg.start;
    for (const c of chunks) {
      const d = span * ((c.length + 6) / totalChars);
      const start = t;
      const end = t + d;
      t = end;
      if (start < introEnd - 0.2) continue;     // title card owns the screen at the start
      lines.push(`Dialogue: 0,${ts(start)},${ts(end)},Cap,,0,0,0,,{\\fscx92\\fscy92\\t(0,90,\\fscx100\\fscy100)}${highlight(wrapTwoLines(c.toUpperCase()))}`);
    }
  }

  // End card
  if (totalDuration > 15) {
    lines.push(`Dialogue: 2,${ts(totalDuration - 4.5)},${ts(totalDuration)},End,,0,0,0,,{\\fad(300,0)\\pos(${width / 2},${height * 0.4})}SUBSCRIBE\\N{\\fs80}FOR MORE MONEY TIPS`);
  }

  return header + '\n' + lines.join('\n') + '\n';
}

function buildThumbASS(text, width = 1280, height = 720) {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: T,${FONT},170,&H0000E1FF,&H00FFFFFF,&H00000000,&H96000000,0,0,0,0,100,100,1,-4,1,10,6,4,60,60,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:10.00,T,,0,0,0,,${esc(wrapTwoLines(text.toUpperCase(), 14)).replace(/\n/g, '\\N')}
`;
}

module.exports = { buildASS, buildThumbASS, chunkSentence };
