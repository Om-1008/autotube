// Story backgrounds. Each builds into an SVG group (world space, 1920×1080, wider margins
// for camera moves) and returns { update(t), groundY, water?: {x0, x1, y} }.
/* global CAST */
(function (root) {
  'use strict';
  const mk = (...a) => CAST.mk(...a);
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const GROUND = 880;

  function defs(svg) {
    if (svg.querySelector('#bgDefs')) return;
    const d = mk('defs', { id: 'bgDefs' }, svg);
    const lg = (id, stops, y2 = 1) => { const g = mk('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2 }, d); stops.forEach(([o, c]) => mk('stop', { offset: o, 'stop-color': c }, g)); };
    lg('bgSkyDay', [[0, '#5EC8FF'], [0.65, '#BDE9FF'], [1, '#E8F8FF']]);
    lg('bgSkyNight', [[0, '#0B1640'], [0.7, '#24306E'], [1, '#3C3F8F']]);
    lg('bgSkyDusk', [[0, '#FF9E7A'], [0.6, '#FFD6A5'], [1, '#FFF1D6']]);
    lg('bgRiver', [[0, '#4FC3F7'], [1, '#0277BD']]);
    lg('bgGrass', [[0, '#8BD450'], [1, '#5DA832']]);
    lg('bgGrassNight', [[0, '#2E5E3A'], [1, '#1B3A26']]);
    lg('bgPath', [[0, '#E8C38A'], [1, '#D2A86A']]);
    const r = mk('radialGradient', { id: 'bgSun' }, d); mk('stop', { offset: 0, 'stop-color': '#FFF59D' }, r); mk('stop', { offset: 1, 'stop-color': '#FFCA28' }, r);
    const m = mk('radialGradient', { id: 'bgMoonGlow' }, d); mk('stop', { offset: 0, 'stop-color': '#FFF9C4', 'stop-opacity': 0.55 }, m); mk('stop', { offset: 1, 'stop-color': '#FFF9C4', 'stop-opacity': 0 }, m);
  }

  // ── shared pieces ──
  function sky(g, fill) { mk('rect', { x: -600, y: -500, width: 3120, height: 2200, fill }, g); }
  function sun(g, x, y) {
    const s = mk('g', { transform: `translate(${x},${y})` }, g); const rays = mk('g', {}, s);
    for (let i = 0; i < 12; i++) mk('rect', { x: -7, y: -150, width: 14, height: 44, rx: 7, fill: '#FFE082', transform: `rotate(${i * 30})` }, rays);
    mk('circle', { r: 86, fill: 'url(#bgSun)' }, s);
    mk('circle', { cx: -26, cy: -8, r: 8, fill: '#5D4037' }, s); mk('circle', { cx: 26, cy: -8, r: 8, fill: '#5D4037' }, s);
    mk('path', { d: 'M -26 22 Q 0 44 26 22', stroke: '#5D4037', 'stroke-width': 7, fill: 'none', 'stroke-linecap': 'round' }, s);
    return t => { rays.setAttribute('transform', `rotate(${t * 12})`); s.setAttribute('transform', `translate(${x},${y + Math.sin(t * 1.4) * 6})`); };
  }
  function clouds(g, list, color = '#fff') {
    const cs = list.map(([x, y, s, v]) => { const c = mk('g', {}, g); [[0, 0, 60], [60, -20, 70], [125, 0, 58], [60, 18, 62]].forEach(([cx, cy, r]) => mk('circle', { cx, cy, r, fill: color }, c)); return { c, x, y, s, v }; });
    return t => cs.forEach(k => k.c.setAttribute('transform', `translate(${((k.x + t * k.v + 700) % 3100) - 700},${k.y}) scale(${k.s})`));
  }
  function hills(g, c1, c2) {
    mk('path', { d: 'M -600 680 C 0 560 300 600 600 640 C 900 680 1150 560 1500 580 C 1800 600 2100 640 2520 620 L 2520 1600 L -600 1600 Z', fill: c1 }, g);
    mk('path', { d: 'M -600 740 C 100 660 400 710 760 710 C 1100 710 1300 660 1700 690 C 2000 710 2200 700 2520 710 L 2520 1600 L -600 1600 Z', fill: c2 }, g);
  }
  function ground(g, fill = 'url(#bgGrass)', edge = '#5DA832') {
    mk('path', { d: `M -600 ${GROUND - 70} C 0 ${GROUND - 90} 900 ${GROUND - 60} 2520 ${GROUND - 80} L 2520 1600 L -600 1600 Z`, fill }, g);
    mk('path', { d: `M -600 ${GROUND - 70} C 0 ${GROUND - 90} 900 ${GROUND - 60} 2520 ${GROUND - 80}`, stroke: edge, 'stroke-width': 10, fill: 'none' }, g);
  }
  function tree(g, x, s = 1, fruit = null, seed = 1) {
    const t = mk('g', { transform: `translate(${x},${GROUND}) scale(${s})` }, g);
    mk('path', { d: 'M -60 0 C -30 -150 -40 -360 -10 -560 L 60 -560 C 80 -360 80 -150 110 0 Z', fill: '#8D5524' }, t);
    mk('path', { d: 'M -20 -10 C 0 -150 0 -310 15 -470', stroke: '#6D3F1A', 'stroke-width': 10, fill: 'none', 'stroke-linecap': 'round' }, t);
    const can = mk('g', {}, t);
    [[20, -640, 170, '#2E9E3F'], [-120, -590, 120, '#38B24A'], [160, -600, 125, '#38B24A'], [10, -750, 125, '#43C055'], [-80, -700, 105, '#4CC95E'], [120, -710, 110, '#4CC95E']].forEach(([cx, cy, r, f]) => mk('circle', { cx, cy, r, fill: f }, can));
    if (fruit) { const r = rng(seed); for (let i = 0; i < 18; i++) { const a = r() * Math.PI * 2, d = 40 + r() * 150; mk('ellipse', { cx: 20 + Math.cos(a) * d * 1.15, cy: -650 + Math.sin(a) * d * 0.7, rx: 12, ry: 15, fill: fruit }, can); } }
    return tt => can.setAttribute('transform', `rotate(${Math.sin(tt * 1.1 + seed) * 1.2} 20 -560)`);
  }
  function flowers(g, spots) {
    spots.forEach(([x, y, c]) => {
      const f = mk('g', { transform: `translate(${x},${y})` }, g);
      mk('path', { d: 'M 0 0 Q -4 30 0 60', stroke: '#2E7D32', 'stroke-width': 6, fill: 'none' }, f);
      for (let k = 0; k < 5; k++) mk('ellipse', { cx: 0, cy: -16, rx: 10, ry: 16, fill: c, transform: `rotate(${k * 72})` }, f);
      mk('circle', { r: 9, fill: '#FFF59D' }, f);
    });
  }
  function grassTufts(g, y, color = '#4CAF50', from = -500, to = 2400) { for (let x = from; x < to; x += 58) mk('path', { d: `M ${x} ${y + (x % 3) * 6} l 8 -26 l 6 26 l 8 -22 l 4 22 Z`, fill: color }, g); }
  function butterflies(g, n = 2) {
    const bs = Array.from({ length: n }, (_, i) => { const b = mk('g', {}, g); const wl = mk('ellipse', { cx: -14, rx: 18, ry: 13, fill: i % 2 ? '#FF80AB' : '#FFD740' }, b); const wr = mk('ellipse', { cx: 14, rx: 18, ry: 13, fill: i % 2 ? '#FF80AB' : '#FFD740' }, b); mk('rect', { x: -3, y: -12, width: 6, height: 24, rx: 3, fill: '#4E342E' }, b); return { b, wl, wr, i }; });
    return t => bs.forEach(k => { const x = 200 + k.i * 1300 + Math.sin(t * 0.7 + k.i * 2) * 180, y = 560 + Math.sin(t * 1.3 + k.i) * 70; const f = Math.abs(Math.sin(t * 18 + k.i)); k.b.setAttribute('transform', `translate(${x},${y}) rotate(${Math.sin(t + k.i) * 15})`); k.wl.setAttribute('transform', `translate(-14,0) scale(${0.3 + 0.7 * f},1) translate(14,0)`); k.wr.setAttribute('transform', `translate(14,0) scale(${0.3 + 0.7 * f},1) translate(-14,0)`); });
  }

  const BACKGROUNDS = {
    jungle: { name: 'जंगल', build(g) {
      sky(g, 'url(#bgSkyDay)'); const u = [sun(g, 1700, 160), clouds(g, [[100, 150, 1.1, 14], [800, 100, 0.8, 18], [1400, 220, 1.0, 12]])];
      hills(g, '#A5E28A', '#86D46A');
      u.push(tree(g, -120, 1.05, '#6A1B9A', 2), tree(g, 2050, 1.1, null, 3));
      ground(g); grassTufts(g, GROUND - 74);
      u.push(tree(g, 260, 0.62, null, 4), tree(g, 1650, 0.58, '#E53935', 5));
      flowers(g, [[90, 960, '#FF5252'], [520, 1000, '#FFD740'], [1280, 990, '#FF4081'], [1760, 960, '#E040FB'], [980, 1040, '#FFD740']]);
      u.push(butterflies(g, 2));
      return { update: t => u.forEach(f => f(t)), groundY: GROUND };
    } },

    riverbank: { name: 'नदी किनारा', build(g) {
      sky(g, 'url(#bgSkyDay)'); const u = [sun(g, 1720, 150), clouds(g, [[200, 140, 1.0, 15], [1100, 110, 0.85, 12]])];
      hills(g, '#A5E28A', '#86D46A');
      mk('path', { d: 'M 1030 740 C 1200 700 1600 690 2520 700 L 2520 1600 L 880 1600 C 920 1200 1000 900 1030 740 Z', fill: 'url(#bgRiver)' }, g);
      const waves = Array.from({ length: 6 }, () => mk('path', { d: '', stroke: '#E1F5FE', 'stroke-width': 7, fill: 'none', 'stroke-linecap': 'round', opacity: 0.7 }, g));
      u.push(t => waves.forEach((w, i) => { const y = 790 + i * 55, x0 = 1080 - i * 20; let d = `M ${x0} ${y}`; for (let k = 0; k <= 9; k++) d += ` Q ${x0 + k * 70 + 35} ${y + Math.sin(t * 2 + i + k) * 10} ${x0 + (k + 1) * 70} ${y}`; w.setAttribute('d', d); w.setAttribute('transform', `translate(${((t * 30 + i * 70) % 140) - 70},0)`); }));
      mk('path', { d: `M -600 ${GROUND - 70} C 0 ${GROUND - 90} 600 ${GROUND - 70} 900 ${GROUND - 66} C 1000 ${GROUND - 60} 1040 ${GROUND - 20} 1000 ${GROUND + 40} C 960 ${GROUND + 120} 930 1300 900 1600 L -600 1600 Z`, fill: 'url(#bgGrass)' }, g);
      grassTufts(g, GROUND - 74, '#4CAF50', -500, 900);
      u.push(tree(g, 420, 1.0, '#4A148C', 7));
      flowers(g, [[80, 950, '#FF5252'], [700, 990, '#FFD740'], [240, 1030, '#E040FB']]);
      u.push(butterflies(g, 1));
      return { update: t => u.forEach(f => f(t)), groundY: GROUND, water: { x0: 1150, x1: 2300, y: 860 } };
    } },

    village: { name: 'गाँव', build(g) {
      sky(g, 'url(#bgSkyDay)'); const u = [sun(g, 300, 150), clouds(g, [[600, 120, 0.9, 13], [1500, 170, 1.1, 10]])];
      hills(g, '#B9E4A0', '#9BD67E');
      const hut = (x, s, roof) => { const h = mk('g', { transform: `translate(${x},${GROUND - 70}) scale(${s})` }, g); mk('rect', { x: -130, y: -190, width: 260, height: 190, fill: '#E8C9A0' }, h); mk('rect', { x: -130, y: -40, width: 260, height: 40, fill: '#C9A276' }, h); mk('path', { d: 'M -170 -180 L 0 -330 L 170 -180 Z', fill: roof }, h); mk('path', { d: 'M -170 -180 L 0 -330 L 170 -180', stroke: '#8D5524', 'stroke-width': 10, fill: 'none' }, h); mk('rect', { x: -32, y: -120, width: 64, height: 120, rx: 30, fill: '#6D4C41' }, h); mk('rect', { x: 60, y: -150, width: 46, height: 46, fill: '#6D4C41' }, h); mk('path', { d: 'M 60 -127 h 46 M 83 -150 v 46', stroke: '#E8C9A0', 'stroke-width': 5 }, h); };
      hut(-60, 1.0, '#D84315'); hut(1720, 0.9, '#F9A825'); hut(2200, 1.05, '#D84315');
      ground(g, 'url(#bgPath)', '#C29A63'); grassTufts(g, GROUND - 74, '#7CB342');
      const well = mk('g', { transform: `translate(1240,${GROUND - 40})` }, g); mk('rect', { x: -70, y: -90, width: 140, height: 90, rx: 10, fill: '#9E9E9E' }, well); mk('path', { d: 'M -70 -60 h 140 M -70 -30 h 140 M -35 -90 v 30 M 35 -90 v 30 M 0 -60 v 30 M -50 -30 v 30 M 20 -30 v 30', stroke: '#757575', 'stroke-width': 4 }, well); mk('path', { d: 'M -60 -90 V -190 M 60 -90 V -190 M -76 -190 H 76', stroke: '#6D4C41', 'stroke-width': 10 }, well); mk('path', { d: 'M -90 -186 L 0 -240 L 90 -186 Z', fill: '#D84315' }, well);
      u.push(tree(g, 560, 0.7, '#FB8C00', 9));
      return { update: t => u.forEach(f => f(t)), groundY: GROUND };
    } },

    night: { name: 'रात का जंगल', build(g) {
      sky(g, 'url(#bgSkyNight)');
      const r = rng(21); const stars = Array.from({ length: 70 }, () => mk('circle', { cx: -500 + r() * 2900, cy: -300 + r() * 900, r: 1.5 + r() * 2.8, fill: '#FFF9C4' }, g));
      mk('circle', { cx: 1600, cy: 170, r: 220, fill: 'url(#bgMoonGlow)' }, g);
      const moon = mk('g', { transform: 'translate(1600,170)' }, g); mk('circle', { r: 80, fill: '#FFF59D' }, moon); mk('circle', { cx: 30, cy: -14, r: 72, fill: '#24306E' }, moon);
      mk('path', { d: 'M -600 690 C 0 580 400 620 800 650 C 1200 680 1500 590 2520 640 L 2520 1600 L -600 1600 Z', fill: '#1E4D3A' }, g);
      const u = [];
      u.push(tree(g, -60, 1.0, null, 11), tree(g, 2050, 1.05, null, 12));
      g.querySelectorAll('circle[fill="#2E9E3F"],circle[fill="#38B24A"],circle[fill="#43C055"],circle[fill="#4CC95E"]').forEach(c => c.setAttribute('fill', '#1F5E3A'));
      ground(g, 'url(#bgGrassNight)', '#163B28'); grassTufts(g, GROUND - 74, '#24573A');
      const flies = Array.from({ length: 16 }, (_, i) => ({ e: mk('circle', { r: 6, fill: '#E6EE9C' }, g), i, x: -300 + r() * 2500, y: 400 + r() * 400 }));
      u.push(t => { stars.forEach((s, i) => s.setAttribute('opacity', 0.5 + 0.5 * Math.sin(t * 2 + i))); flies.forEach(f => { f.e.setAttribute('cx', f.x + Math.sin(t * 0.8 + f.i) * 60); f.e.setAttribute('cy', f.y + Math.cos(t * 1.1 + f.i) * 40); f.e.setAttribute('opacity', 0.3 + 0.7 * Math.abs(Math.sin(t * 2.2 + f.i))); }); });
      return { update: t => u.forEach(f => f(t)), groundY: GROUND, night: true };
    } },

    meadow: { name: 'मैदान', build(g) {
      sky(g, 'url(#bgSkyDay)'); const u = [sun(g, 1650, 170), clouds(g, [[0, 130, 1.0, 16], [700, 90, 0.8, 12], [1300, 200, 1.1, 14]])];
      hills(g, '#C5E1A5', '#AED581');
      mk('path', { d: 'M -600 760 C 300 700 1300 730 2520 700 L 2520 1600 L -600 1600 Z', fill: '#9CCC65' }, g);
      ground(g); grassTufts(g, GROUND - 74);
      // a winding race track / path
      mk('path', { d: `M -600 ${GROUND + 40} C 200 ${GROUND - 10} 1200 ${GROUND + 70} 2520 ${GROUND + 10} L 2520 ${GROUND + 110} C 1200 ${GROUND + 170} 200 ${GROUND + 90} -600 ${GROUND + 140} Z`, fill: 'url(#bgPath)', opacity: 0.85 }, g);
      flowers(g, [[100, 830, '#FF5252'], [380, 860, '#FFD740'], [800, 820, '#E040FB'], [1500, 840, '#FF4081'], [1850, 820, '#FFD740'], [600, 1040, '#FF5252'], [1300, 1050, '#E040FB']]);
      u.push(tree(g, 2150, 0.8, null, 13), butterflies(g, 2));
      return { update: t => u.forEach(f => f(t)), groundY: GROUND };
    } },
  };

  root.STORY_BG = { BACKGROUNDS, defs, GROUND };
})(window);
