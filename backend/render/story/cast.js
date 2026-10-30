// Story cast: reusable cartoon animal puppets for the kids' story renderer.
// Every puppet is built at the origin with its feet on y = 0, facing right.
// rig.update(s) takes a state: { t, mouth 0..1, emotion, pose, look, blink, walk }.
/* global document */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  function mk(tag, a, p) { const e = document.createElementNS(NS, tag); for (const k in a) if (a[k] !== undefined) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; }
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, p) => a + (b - a) * p;

  // ── shared face: eyes + brows + mouth + cheeks ──
  function face(g, o) {
    const F = { o };
    F.eyes = [-1, 1].map(side => {
      const eg = mk('g', { transform: `translate(${side * o.ex},${o.ey})` }, g);
      mk('ellipse', { rx: o.er * 0.82, ry: o.er, fill: '#fff' }, eg);
      const pupil = mk('g', {}, eg);
      mk('circle', { r: o.er * 0.56, fill: o.pupil || '#2B1B0E' }, pupil);
      mk('circle', { cx: o.er * 0.2, cy: -o.er * 0.28, r: o.er * 0.2, fill: '#fff' }, pupil);
      const lid = mk('path', { d: '', fill: o.lid || o.fur }, eg);
      const brow = mk('path', { d: `M ${-o.er * 0.7} 0 Q 0 ${-o.er * 0.25} ${o.er * 0.7} 0`, stroke: o.brow || '#3E2723', 'stroke-width': Math.max(4, o.er * 0.28), fill: 'none', 'stroke-linecap': 'round' }, eg);
      return { eg, pupil, lid, brow, side };
    });
    if (o.cheeks !== false) [-1, 1].forEach(s => mk('ellipse', { cx: s * (o.ex + o.er * 0.6), cy: o.ey + o.er * 1.45, rx: o.er * 0.55, ry: o.er * 0.38, fill: '#FF8A80', opacity: 0.5 }, g));
    F.mouth = mk('path', { d: '', fill: 'none', stroke: o.mouthLine || '#3E2723', 'stroke-width': Math.max(4, o.mw * 0.12), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
    F.tongue = mk('ellipse', { rx: o.mw * 0.28, ry: o.mw * 0.13, fill: '#FF8A80', opacity: 0 }, g);
    F.update = (s) => {
      const em = s.emotion || 'neutral';
      const er = o.er;
      // lids: how much of the eye is covered from the top (0..1)
      let lid = 0, browA = 0, browY = -er * 1.35, look = s.look || 0, lookY = 0;
      if (em === 'sleepy') lid = 1; else if (em === 'proud') lid = 0.45; else if (em === 'sad' || em === 'crying') lid = 0.3;
      if (em === 'angry') { lid = 0.25; browA = -24; browY = -er * 1.12; }   // inner ends down
      if (em === 'sad' || em === 'crying' || em === 'scared') { browA = 20; }   // inner ends up
      if (em === 'surprised' || em === 'scared') { browY = -er * 1.7; }
      if (em === 'thinking') { lookY = -er * 0.35; look = 0.5; browY = -er * 1.55; }
      if (s.blink) lid = 1;
      F.eyes.forEach(e => {
        const sc = em === 'surprised' || em === 'scared' ? 1.12 : 1;
        e.eg.setAttribute('transform', `translate(${e.side * o.ex},${o.ey}) scale(${sc})`);
        e.pupil.setAttribute('transform', `translate(${look * er * 0.3},${lookY + (em === 'sad' ? er * 0.15 : 0)}) scale(${em === 'scared' ? 0.7 : 1})`);
        const top = -er - 2, cut = lerp(-er, er, lid);
        e.lid.setAttribute('d', lid > 0.02 ? `M ${-er} ${top} H ${er} V ${cut} Q 0 ${cut + er * 0.25 * (lid < 1 ? 1 : 0)} ${-er} ${cut} Z` : '');
        if (lid >= 0.98) e.lid.setAttribute('d', `M ${-er} ${top} H ${er} V ${er * 0.15} Q 0 ${er * 0.45} ${-er} ${er * 0.15} Z`);
        e.brow.setAttribute('transform', `translate(0,${browY}) rotate(${e.side * browA})`);
      });
      // mouth
      const w = o.mw, mx = o.mx || 0, my = o.my, open = clamp(s.mouth || 0);
      let d, fill = 'none';
      if (open > 0.06) {
        const h = 6 + open * w * 0.9;
        const curve = em === 'sad' || em === 'scared' ? -0.15 : 0.25;
        d = `M ${mx - w * 0.5} ${my} Q ${mx} ${my - w * curve * 0.4} ${mx + w * 0.5} ${my} Q ${mx + w * 0.4} ${my + h} ${mx} ${my + h} Q ${mx - w * 0.4} ${my + h} ${mx - w * 0.5} ${my} Z`;
        fill = '#8E1B1B';
        F.tongue.setAttribute('cx', mx); F.tongue.setAttribute('cy', my + h * 0.72); F.tongue.setAttribute('opacity', open > 0.35 ? 1 : 0);
      } else {
        F.tongue.setAttribute('opacity', 0);
        if (em === 'sad' || em === 'crying' || em === 'scared') d = `M ${mx - w * 0.4} ${my + w * 0.18} Q ${mx} ${my - w * 0.12} ${mx + w * 0.4} ${my + w * 0.18}`;
        else if (em === 'surprised') { d = `M ${mx - w * 0.16} ${my + 4} a ${w * 0.16} ${w * 0.2} 0 1 0 ${w * 0.32} 0 a ${w * 0.16} ${w * 0.2} 0 1 0 ${-w * 0.32} 0`; fill = '#8E1B1B'; }
        else if (em === 'angry') d = `M ${mx - w * 0.35} ${my + w * 0.12} L ${mx + w * 0.35} ${my + w * 0.04}`;
        else if (em === 'proud') d = `M ${mx - w * 0.35} ${my + w * 0.05} Q ${mx + w * 0.05} ${my + w * 0.3} ${mx + w * 0.42} ${my - w * 0.06}`;
        else if (em === 'happy' || em === 'laughing') { d = `M ${mx - w * 0.45} ${my} Q ${mx} ${my + w * 0.6} ${mx + w * 0.45} ${my} Z`; fill = '#8E1B1B'; }
        else d = `M ${mx - w * 0.4} ${my} Q ${mx} ${my + w * 0.32} ${mx + w * 0.4} ${my}`;
      }
      F.mouth.setAttribute('d', d); F.mouth.setAttribute('fill', fill);
    };
    return F;
  }

  // ── generic upright ("chibi") animal ──
  // cfg: fur, belly, paw, headR, bodyRx, bodyRy, legH, armLen, scale, face{...}, back(g), front(g), tail(g)
  function biped(g, cfg) {
    const R = { cfg, root: g };
    const legH = cfg.legH || 40, bRx = cfg.bodyRx || 58, bRy = cfg.bodyRy || 70, hR = cfg.headR || 64;
    const bodyY = -legH - bRy * 0.9, headY = bodyY - bRy * 0.85 - hR * 0.72;
    R.inner = mk('g', {}, g);
    R.tail = mk('g', { transform: `translate(${-bRx * 0.75},${bodyY + bRy * 0.3})` }, R.inner);
    if (cfg.tail) cfg.tail(R.tail);
    R.legs = [-1, 1].map(s => {
      const lg = mk('g', { transform: `translate(${s * bRx * 0.42},${-legH})` }, R.inner);
      mk('rect', { x: -bRx * 0.22, y: -6, width: bRx * 0.44, height: legH + 4, rx: bRx * 0.2, fill: cfg.limb || cfg.fur }, lg);
      mk('ellipse', { cx: s * 4, cy: legH - 4, rx: bRx * 0.36, ry: bRx * 0.17, fill: cfg.paw || cfg.belly }, lg);
      return lg;
    });
    R.armBack = mk('g', { transform: `translate(${-bRx * 0.82},${bodyY - bRy * 0.35})` }, R.inner);
    const body = mk('g', { transform: `translate(0,${bodyY})` }, R.inner);
    mk('ellipse', { rx: bRx, ry: bRy, fill: cfg.fur }, body);
    mk('ellipse', { cx: 0, cy: bRy * 0.15, rx: bRx * 0.66, ry: bRy * 0.7, fill: cfg.belly }, body);
    if (cfg.bodyExtra) cfg.bodyExtra(body, bRx, bRy);
    const arm = (parent) => {
      const len = cfg.armLen || bRy * 1.0;
      mk('path', { d: `M 0 0 Q 4 ${len * 0.5} 0 ${len}`, stroke: cfg.limb || cfg.fur, 'stroke-width': bRx * 0.34, fill: 'none', 'stroke-linecap': 'round' }, parent);
      mk('circle', { cx: 0, cy: len + 2, r: bRx * 0.22, fill: cfg.paw || cfg.belly }, parent);
    };
    arm(R.armBack);
    R.armFront = mk('g', { transform: `translate(${bRx * 0.82},${bodyY - bRy * 0.35})` }, R.inner);
    arm(R.armFront);
    R.head = mk('g', { transform: `translate(0,${headY})` }, R.inner);
    if (cfg.back) cfg.back(R.head, hR);
    mk('circle', { r: hR, fill: cfg.headFur || cfg.fur }, R.head);
    if (cfg.muzzle) cfg.muzzle(R.head, hR);
    R.face = face(R.head, { fur: cfg.headFur || cfg.fur, ...cfg.face });
    if (cfg.front) cfg.front(R.head, hR);
    R.headAnchor = { x: 0, y: headY - hR };
    R.height = -(headY - hR);
    const base = { bodyY, headY, bRx, bRy };
    R.update = (s) => {
      const t = s.t || 0, pose = s.pose || 'idle';
      let bob = Math.sin(t * 2.4) * 3, lean = 0, headTilt = Math.sin(t * 1.4) * 2, aF = 8, aB = -8, legA = 0;
      const sw = Math.sin((s.walkPhase || 0));
      if (pose === 'walk' || pose === 'run') { const amp = pose === 'run' ? 28 : 18; legA = sw * amp; aF = -sw * amp * 1.2; aB = sw * amp * 1.2; bob = -Math.abs(Math.cos(s.walkPhase || 0)) * (pose === 'run' ? 12 : 6); lean = pose === 'run' ? 8 : 3; }
      if (pose === 'celebrate') { aF = -150 + Math.sin(t * 10) * 15; aB = 150 - Math.sin(t * 10) * 15; }
      if (pose === 'wave') aF = -145 + Math.sin(t * 12) * 20;
      if (pose === 'point' || pose === 'give') aF = -85;
      if (pose === 'think') { aF = -150; headTilt = 8; }
      if (pose === 'sad') { aF = 4; aB = -4; headTilt = 10; bob -= 0; }
      if (pose === 'scared') { aF = -120 + Math.sin(t * 30) * 6; aB = 120 - Math.sin(t * 30) * 6; lean = Math.sin(t * 40) * 2; }
      if (pose === 'angry') { aF = -20 + Math.sin(t * 18) * 10; aB = 20; lean = Math.sin(t * 25) * 2; }
      if (pose === 'sleep') { headTilt = 18; aF = 10; aB = -10; bob = Math.sin(t * 1.2) * 4; }
      if (pose === 'laugh') { headTilt = -8 + Math.sin(t * 16) * 4; bob = Math.sin(t * 16) * 4; }
      R.inner.setAttribute('transform', `translate(0,${bob}) rotate(${lean})`);
      R.legs[0].setAttribute('transform', `translate(${-bRx * 0.42},${-legH}) rotate(${legA})`);
      R.legs[1].setAttribute('transform', `translate(${bRx * 0.42},${-legH}) rotate(${-legA})`);
      R.armFront.setAttribute('transform', `translate(${bRx * 0.82},${base.bodyY - bRy * 0.35}) rotate(${aF})`);
      R.armBack.setAttribute('transform', `translate(${-bRx * 0.82},${base.bodyY - bRy * 0.35}) rotate(${aB})`);
      R.head.setAttribute('transform', `translate(0,${base.headY}) rotate(${headTilt + (s.mouth > 0.08 ? Math.sin(t * 7) * 2.5 : 0)})`);
      R.tail.setAttribute('transform', `translate(${-bRx * 0.75},${base.bodyY + bRy * 0.3}) rotate(${Math.sin(t * 2.6) * 10})`);
      if (cfg.animate) cfg.animate(R, s);
      R.face.update(s);
    };
    return R;
  }

  // ── species ──
  const SPECIES = {
    rabbit: { name: 'खरगोश', voice: 'child', build: g => biped(g, {
      fur: '#F4F1EC', belly: '#FFFFFF', paw: '#FFE4E1', headR: 60, bodyRx: 52, bodyRy: 64, legH: 34,
      face: { ex: 22, ey: -2, er: 15, mw: 26, my: 28, lid: '#F4F1EC' },
      back: (h, r) => { [-1, 1].forEach(s => { const e = mk('g', { transform: `translate(${s * 24},${-r * 0.8}) rotate(${s * 10})` }, h); mk('ellipse', { cx: 0, cy: -62, rx: 20, ry: 70, fill: '#F4F1EC' }, e); mk('ellipse', { cx: 0, cy: -58, rx: 10, ry: 54, fill: '#FFB6C1' }, e); h.__ears = h.__ears || []; h.__ears.push(e); }); },
      muzzle: (h) => { mk('ellipse', { cx: 0, cy: 18, rx: 24, ry: 16, fill: '#FFFFFF' }, h); mk('path', { d: 'M -7 10 L 7 10 L 0 18 Z', fill: '#FF8FA3' }, h); [-1, 1].forEach(s => { mk('line', { x1: s * 18, y1: 18, x2: s * 54, y2: 12, stroke: '#BDBDBD', 'stroke-width': 3 }, h); mk('line', { x1: s * 18, y1: 24, x2: s * 54, y2: 28, stroke: '#BDBDBD', 'stroke-width': 3 }, h); }); },
      front: (h) => { mk('rect', { x: -7, y: 31, width: 14, height: 11, rx: 3, fill: '#fff', stroke: '#E0E0E0', 'stroke-width': 2 }, h); },
      tail: (tg) => mk('circle', { cx: -6, cy: 10, r: 22, fill: '#FFFFFF' }, tg),
      animate: (R, s) => { const ears = R.head.__ears || []; const droop = s.emotion === 'sad' || s.emotion === 'crying' ? 38 : 0; ears.forEach((e, i) => { const sd = i ? 1 : -1; e.setAttribute('transform', `translate(${sd * 24},${-48}) rotate(${sd * (10 + droop) + Math.sin((s.t || 0) * 3 + i) * 4})`); }); },
    }) },

    lion: { name: 'शेर', voice: 'deep', scale: 1.18, build: g => biped(g, {
      fur: '#F2B544', belly: '#FBE3A1', paw: '#FBE3A1', headR: 62, bodyRx: 64, bodyRy: 72, legH: 40,
      face: { ex: 24, ey: -6, er: 13, mw: 30, my: 30, lid: '#F2B544', brow: '#7B3F00' },
      back: (h, r) => { for (let i = 0; i < 14; i++) mk('ellipse', { cx: Math.cos(i / 14 * Math.PI * 2) * r * 1.08, cy: Math.sin(i / 14 * Math.PI * 2) * r * 1.08, rx: 32, ry: 26, fill: i % 2 ? '#C0612B' : '#D9792F', transform: `rotate(${i / 14 * 360} ${Math.cos(i / 14 * Math.PI * 2) * r * 1.08} ${Math.sin(i / 14 * Math.PI * 2) * r * 1.08})` }, h); [-1, 1].forEach(s => { mk('circle', { cx: s * 44, cy: -46, r: 16, fill: '#F2B544' }, h); mk('circle', { cx: s * 44, cy: -46, r: 8, fill: '#D9792F' }, h); }); },
      muzzle: (h) => { mk('ellipse', { cx: 0, cy: 22, rx: 30, ry: 20, fill: '#FBE3A1' }, h); mk('path', { d: 'M -10 10 L 10 10 Q 0 22 -10 10 Z', fill: '#5D3A1A' }, h); },
      tail: (tg) => { mk('path', { d: 'M 0 0 C -50 10 -70 -30 -60 -70', stroke: '#F2B544', 'stroke-width': 12, fill: 'none', 'stroke-linecap': 'round' }, tg); mk('ellipse', { cx: -60, cy: -78, rx: 16, ry: 20, fill: '#C0612B' }, tg); },
    }) },

    fox: { name: 'लोमड़ी', voice: 'sly', build: g => biped(g, {
      fur: '#F07B22', belly: '#FFF3E0', paw: '#3E2723', limb: '#E8701B', headR: 58, bodyRx: 50, bodyRy: 66, legH: 38,
      face: { ex: 21, ey: -4, er: 13, mw: 24, my: 30, lid: '#F07B22', pupil: '#3E2723' },
      back: (h) => { [-1, 1].forEach(s => { mk('path', { d: `M ${s * 18} -40 L ${s * 54} -112 L ${s * 62} -30 Z`, fill: '#F07B22' }, h); mk('path', { d: `M ${s * 30} -48 L ${s * 52} -96 L ${s * 54} -46 Z`, fill: '#3E2723' }, h); }); },
      muzzle: (h, r) => { mk('path', { d: `M ${-r} 4 Q -20 50 0 50 Q 20 50 ${r} 4 Q 30 26 0 24 Q -30 26 ${-r} 4 Z`, fill: '#FFF3E0' }, h); mk('ellipse', { cx: 0, cy: 22, rx: 8, ry: 6, fill: '#3E2723' }, h); },
      tail: (tg) => { mk('path', { d: 'M 6 0 C -60 6 -104 -40 -92 -104 C -70 -84 -40 -40 6 -14 Z', fill: '#F07B22' }, tg); mk('path', { d: 'M -92 -104 C -100 -82 -98 -70 -88 -62 C -76 -72 -76 -88 -92 -104 Z', fill: '#FFF3E0' }, tg); },
    }) },

    mouse: { name: 'चूहा', voice: 'tiny', scale: 0.62, build: g => biped(g, {
      fur: '#A8A8B3', belly: '#E4E4EC', paw: '#FFC1CC', headR: 58, bodyRx: 50, bodyRy: 58, legH: 30,
      face: { ex: 21, ey: -2, er: 15, mw: 22, my: 30, lid: '#A8A8B3' },
      back: (h) => { [-1, 1].forEach(s => { mk('circle', { cx: s * 52, cy: -42, r: 34, fill: '#A8A8B3' }, h); mk('circle', { cx: s * 52, cy: -42, r: 22, fill: '#FFC1CC' }, h); }); },
      muzzle: (h) => { mk('ellipse', { cx: 0, cy: 20, rx: 20, ry: 13, fill: '#E4E4EC' }, h); mk('circle', { cx: 0, cy: 12, r: 8, fill: '#FF8FA3' }, h); [-1, 1].forEach(s => mk('line', { x1: s * 14, y1: 18, x2: s * 52, y2: 10, stroke: '#7D7D88', 'stroke-width': 3 }, h)); },
      tail: (tg) => mk('path', { d: 'M 0 0 C -60 20 -90 -20 -70 -60 C -60 -80 -40 -70 -48 -56', stroke: '#FFC1CC', 'stroke-width': 7, fill: 'none', 'stroke-linecap': 'round' }, tg),
    }) },

    elephant: { name: 'हाथी', voice: 'gentle_big', scale: 1.3, build: g => biped(g, {
      fur: '#9FB3C0', belly: '#B9CAD4', paw: '#E3EAEE', limb: '#93A7B4', headR: 66, bodyRx: 70, bodyRy: 76, legH: 48,
      face: { ex: 28, ey: -16, er: 12, mw: 18, my: 40, mx: 30, lid: '#9FB3C0' },
      back: (h) => { [-1, 1].forEach(s => { mk('ellipse', { cx: s * 72, cy: 2, rx: 46, ry: 62, fill: '#9FB3C0' }, h); mk('ellipse', { cx: s * 74, cy: 4, rx: 30, ry: 44, fill: '#F2B8C6' }, h); }); },
      front: (h) => {
        const tr = mk('g', {}, h); h.__trunk = tr;
        mk('path', { d: 'M -6 4 C -8 50 -2 84 -30 104 C -40 112 -54 100 -44 92 C -26 78 -26 50 -24 20', fill: 'none', stroke: '#6F8593', 'stroke-width': 30, 'stroke-linecap': 'round' }, tr);
        mk('path', { d: 'M -6 4 C -8 50 -2 84 -30 104 C -40 112 -54 100 -44 92 C -26 78 -26 50 -24 20', fill: 'none', stroke: '#A9BCC8', 'stroke-width': 22, 'stroke-linecap': 'round' }, tr);
        [40, 56, 72].forEach(y => mk('path', { d: `M -24 ${y} q 9 4 18 0`, stroke: '#7E95A3', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }, tr));
        [-1, 1].forEach(s => mk('path', { d: `M ${s * 30} 36 q ${s * 10} 18 ${s * 2} 30`, stroke: '#FFFDF5', 'stroke-width': 9, fill: 'none', 'stroke-linecap': 'round' }, h));
      },
      tail: (tg) => mk('path', { d: 'M 0 0 C -20 10 -30 20 -26 40', stroke: '#9FB3C0', 'stroke-width': 6, fill: 'none' }, tg),
      animate: (R, s) => { if (R.head.__trunk) R.head.__trunk.setAttribute('transform', `rotate(${Math.sin((s.t || 0) * 2) * 6 + (s.pose === 'celebrate' ? -60 : 0)} -14 6)`); },
    }) },

    monkey: { name: 'बंदर', voice: 'child_m', build: g => biped(g, {
      fur: '#8D5524', belly: '#E0AC69', paw: '#F1C27D', limb: '#7B4A22', headR: 62, bodyRx: 52, bodyRy: 62, legH: 36,
      face: { ex: 22, ey: -6, er: 16, mw: 26, my: 30, lid: '#F1C27D' },
      back: (h) => { [-1, 1].forEach(s => { mk('circle', { cx: s * 62, cy: -2, r: 26, fill: '#8D5524' }, h); mk('circle', { cx: s * 62, cy: -2, r: 15, fill: '#F7B2A4' }, h); }); },
      muzzle: (h) => { mk('path', { d: 'M 0 -18 C -20 -42 -58 -30 -52 2 C -48 30 -30 54 0 56 C 30 54 48 30 52 2 C 58 -30 20 -42 0 -18 Z', fill: '#F1C27D' }, h); mk('path', { d: 'M -10 -24 Q -2 -60 8 -66 Q 4 -44 14 -30', fill: '#8D5524' }, h); },
      tail: (tg) => mk('path', { d: 'M 0 0 C -80 10 -100 -80 -50 -110 C -20 -125 -10 -95 -28 -88', stroke: '#7B4A22', 'stroke-width': 14, fill: 'none', 'stroke-linecap': 'round' }, tg),
    }) },

    bear: { name: 'भालू', voice: 'deep_soft', scale: 1.15, build: g => biped(g, {
      fur: '#7B5233', belly: '#C9A27E', paw: '#C9A27E', headR: 62, bodyRx: 66, bodyRy: 74, legH: 40,
      face: { ex: 22, ey: -8, er: 12, mw: 26, my: 30, lid: '#7B5233' },
      back: (h) => { [-1, 1].forEach(s => { mk('circle', { cx: s * 48, cy: -46, r: 22, fill: '#7B5233' }, h); mk('circle', { cx: s * 48, cy: -46, r: 12, fill: '#C9A27E' }, h); }); },
      muzzle: (h) => { mk('ellipse', { cx: 0, cy: 22, rx: 28, ry: 20, fill: '#C9A27E' }, h); mk('ellipse', { cx: 0, cy: 12, rx: 11, ry: 8, fill: '#3E2723' }, h); },
    }) },

    // ── non-biped species ──
    tortoise: { name: 'कछुआ', voice: 'old', build: (g) => {
      const R = { root: g };
      R.inner = mk('g', {}, g);
      R.legs = [[-60, 0], [-20, 0], [30, 0], [70, 0]].map(([x], i) => { const lg = mk('g', { transform: `translate(${x},-30)` }, R.inner); mk('rect', { x: -14, y: 0, width: 28, height: 34, rx: 12, fill: '#B8A35B' }, lg); return lg; });
      R.head = mk('g', { transform: 'translate(118,-78)' }, R.inner);
      mk('path', { d: 'M -70 50 C -50 20 -30 10 -10 18 L 0 40 Z', fill: '#C9B66A' }, R.head);
      mk('circle', { r: 46, fill: '#C9B66A' }, R.head);
      R.face = face(R.head, { fur: '#C9B66A', ex: 17, ey: -8, er: 12, mw: 22, my: 18, mx: 8, lid: '#C9B66A' });
      const shell = mk('g', { transform: 'translate(0,-40)' }, R.inner);
      mk('path', { d: 'M -110 10 C -110 -110 110 -110 110 10 Z', fill: '#5E8C31' }, shell);
      mk('path', { d: 'M -118 4 H 118 Q 118 22 100 22 H -100 Q -118 22 -118 4 Z', fill: '#C9B66A' }, shell);
      [[-55, -30], [0, -55], [55, -30], [-25, -10], [30, -10]].forEach(([x, y]) => mk('path', { d: `M ${x - 22} ${y} l 11 -18 h 22 l 11 18 l -11 18 h -22 Z`, fill: '#7DAA45', stroke: '#4E7A27', 'stroke-width': 4 }, shell));
      R.tail = mk('path', { d: 'M -110 -14 l -24 10 l 22 6 Z', fill: '#C9B66A' }, R.inner);
      R.headAnchor = { x: 118, y: -130 };
      R.height = 140;
      R.update = (s) => {
        const t = s.t || 0, w = s.walkPhase || 0;
        const walking = s.pose === 'walk' || s.pose === 'run';
        R.legs.forEach((lg, i) => lg.setAttribute('transform', `translate(${[-60, -20, 30, 70][i]},-30) rotate(${walking ? Math.sin(w + i * Math.PI / 2) * 16 : 0})`));
        R.inner.setAttribute('transform', `translate(0,${walking ? -Math.abs(Math.sin(w)) * 3 : Math.sin(t * 1.6) * 2})`);
        const pull = s.emotion === 'scared' ? -40 : 0;
        R.head.setAttribute('transform', `translate(${118 + pull},${-78 + Math.sin(t * 1.4) * 3}) rotate(${(s.mouth > 0.08 ? Math.sin(t * 6) * 3 : 0) + (s.pose === 'celebrate' ? Math.sin(t * 8) * 8 : 0)})`);
        R.face.update(s);
      };
      return R;
    } },

    crow: { name: 'कौआ', voice: 'crow', build: (g) => {
      const R = { root: g };
      R.inner = mk('g', {}, g);
      [-1, 1].forEach(s => mk('path', { d: `M ${s * 12} -40 L ${s * 14} 0 M ${s * 14} 0 l -10 4 M ${s * 14} 0 l 10 4`, stroke: '#F4A63A', 'stroke-width': 6, fill: 'none', 'stroke-linecap': 'round' }, R.inner));
      mk('path', { d: 'M -40 -90 L -100 -60 L -96 -44 L -36 -64 Z', fill: '#2B2F3A' }, R.inner);
      mk('ellipse', { cx: 0, cy: -95, rx: 52, ry: 62, fill: '#353B48' }, R.inner);
      mk('ellipse', { cx: 6, cy: -84, rx: 30, ry: 40, fill: '#4B5263' }, R.inner);
      R.wing = mk('g', { transform: 'translate(-10,-110)' }, R.inner);
      mk('path', { d: 'M 0 0 C -60 10 -70 60 -40 80 C -20 60 0 40 10 10 Z', fill: '#2B2F3A' }, R.wing);
      R.head = mk('g', { transform: 'translate(14,-178)' }, R.inner);
      mk('circle', { r: 46, fill: '#353B48' }, R.head);
      mk('path', { d: 'M 0 -46 q 6 -20 18 -22 q -4 14 -6 24 Z', fill: '#353B48' }, R.head);
      R.beakTop = mk('path', { d: 'M 32 2 L 86 10 L 32 18 Z', fill: '#8A8F98' }, R.head);
      R.beakBot = mk('path', { d: 'M 32 16 L 78 18 L 32 28 Z', fill: '#6B7079' }, R.head);
      R.face = face(R.head, { fur: '#353B48', ex: 16, ey: -10, er: 13, mw: 0.01, my: 200, lid: '#353B48', brow: '#11141A', cheeks: false });
      R.face.mouth.setAttribute('opacity', 0);
      R.headAnchor = { x: 14, y: -230 };
      R.height = 230;
      R.update = (s) => {
        const t = s.t || 0;
        const flying = s.pose === 'fly';
        const flap = flying ? Math.sin(t * 22) * 40 : Math.sin(t * 2) * 4;
        R.wing.setAttribute('transform', `translate(-10,-110) rotate(${flap})`);
        R.inner.setAttribute('transform', `translate(0,${flying ? Math.sin(t * 6) * 8 : Math.sin(t * 2.4) * 2})`);
        const open = clamp(s.mouth || 0) * 22;
        R.beakTop.setAttribute('transform', `rotate(${-open * 0.4} 32 10)`);
        R.beakBot.setAttribute('transform', `rotate(${open * 0.9} 32 20)`);
        R.head.setAttribute('transform', `translate(14,-178) rotate(${s.mouth > 0.08 ? Math.sin(t * 7) * 3 : Math.sin(t * 1.8) * 3})`);
        R.face.update({ ...s, mouth: 0 });
      };
      return R;
    } },

    deer: { name: 'हिरण', voice: 'soft_f', build: (g) => {
      const R = { root: g };
      R.inner = mk('g', {}, g);
      R.legs = [[-58, 1], [-34, -1], [40, 1], [64, -1]].map(([x]) => { const lg = mk('g', { transform: `translate(${x},-110)` }, R.inner); mk('rect', { x: -8, y: 0, width: 16, height: 110, rx: 8, fill: '#B9773F' }, lg); mk('rect', { x: -9, y: 96, width: 18, height: 14, rx: 4, fill: '#4E342E' }, lg); return lg; });
      mk('ellipse', { cx: 0, cy: -130, rx: 92, ry: 50, fill: '#C8875B' }, R.inner);
      mk('ellipse', { cx: 10, cy: -112, rx: 60, ry: 26, fill: '#F2D7B9' }, R.inner);
      [[-40, -150], [-10, -160], [20, -150], [-60, -130], [40, -158]].forEach(([x, y]) => mk('circle', { cx: x, cy: y, r: 7, fill: '#F7E6D3' }, R.inner));
      mk('ellipse', { cx: -92, cy: -150, rx: 12, ry: 16, fill: '#FFFFFF' }, R.inner);
      R.neck = mk('path', { d: 'M 60 -150 C 80 -200 96 -230 104 -250 L 136 -240 C 126 -210 110 -170 92 -130 Z', fill: '#C8875B' }, R.inner);
      R.head = mk('g', { transform: 'translate(124,-262)' }, R.inner);
      [-1, 1].forEach(s => mk('path', { d: `M ${s * 18} -34 l ${s * 6} -34 m 0 10 l ${s * 14} -12 m -14 -2 l ${s * -6} -14`, stroke: '#7A4E2D', 'stroke-width': 7, fill: 'none', 'stroke-linecap': 'round' }, R.head));
      [-1, 1].forEach(s => mk('ellipse', { cx: s * 44, cy: -20, rx: 26, ry: 12, fill: '#C8875B', transform: `rotate(${s * -25} ${s * 44} -20)` }, R.head));
      mk('circle', { r: 42, fill: '#C8875B' }, R.head);
      mk('ellipse', { cx: 6, cy: 24, rx: 24, ry: 18, fill: '#F2D7B9' }, R.head);
      mk('ellipse', { cx: 6, cy: 14, rx: 8, ry: 6, fill: '#3E2723' }, R.head);
      R.face = face(R.head, { fur: '#C8875B', ex: 17, ey: -6, er: 13, mw: 18, my: 32, mx: 6, lid: '#C8875B' });
      R.headAnchor = { x: 124, y: -310 };
      R.height = 310;
      R.update = (s) => {
        const t = s.t || 0, w = s.walkPhase || 0, walking = s.pose === 'walk' || s.pose === 'run';
        R.legs.forEach((lg, i) => lg.setAttribute('transform', `translate(${[-58, -34, 40, 64][i]},-110) rotate(${walking ? Math.sin(w + (i % 2) * Math.PI) * (s.pose === 'run' ? 26 : 14) : 0})`));
        R.inner.setAttribute('transform', `translate(0,${walking ? -Math.abs(Math.sin(w)) * 6 : Math.sin(t * 2) * 2})`);
        R.head.setAttribute('transform', `translate(124,-262) rotate(${(s.mouth > 0.08 ? Math.sin(t * 7) * 3 : Math.sin(t * 1.3) * 3) + (s.emotion === 'sad' ? 12 : 0)})`);
        R.face.update(s);
      };
      return R;
    } },

    crocodile: { name: 'मगरमच्छ', voice: 'deep', build: (g) => {
      const R = { root: g };
      R.inner = mk('g', {}, g);
      R.tail = mk('path', { d: 'M -240 -40 C -330 -50 -380 -100 -420 -130 C -400 -70 -360 -20 -250 -10 Z', fill: '#2E7D32' }, R.inner);
      [-1, 1].forEach((s, i) => mk('rect', { x: -160 + i * 220, y: -40, width: 34, height: 40, rx: 12, fill: '#2E7D32' }, R.inner));
      mk('ellipse', { cx: -60, cy: -70, rx: 200, ry: 60, fill: '#388E3C' }, R.inner);
      mk('ellipse', { cx: -60, cy: -48, rx: 170, ry: 24, fill: '#9CCC65' }, R.inner);
      for (let i = 0; i < 7; i++) mk('path', { d: `M ${-220 + i * 42} -122 l 16 -26 l 16 26 Z`, fill: '#2E7D32' }, R.inner);
      R.head = mk('g', { transform: 'translate(150,-80)' }, R.inner);
      R.jaw = mk('g', {}, R.head);
      mk('path', { d: 'M -40 10 L 210 18 C 240 20 240 46 212 50 L -40 50 Z', fill: '#66BB6A' }, R.jaw);
      for (let i = 0; i < 6; i++) mk('path', { d: `M ${10 + i * 34} 18 l 9 -14 l 9 14 Z`, fill: '#fff' }, R.jaw);
      mk('path', { d: 'M -60 -40 C -20 -70 40 -60 90 -46 L 220 -22 C 266 -12 266 24 220 24 L -60 24 Z', fill: '#43A047' }, R.head);
      for (let i = 0; i < 6; i++) mk('path', { d: `M ${20 + i * 34} 24 l 9 14 l 9 -14 Z`, fill: '#fff' }, R.head);
      mk('ellipse', { cx: 238, cy: -14, rx: 18, ry: 12, fill: '#388E3C' }, R.head);
      const eyesG = mk('g', { transform: 'translate(10,-62)' }, R.head);
      [-24, 24].forEach(x => mk('circle', { cx: x, cy: 0, r: 30, fill: '#43A047' }, eyesG));
      R.face = face(eyesG, { fur: '#43A047', ex: 24, ey: -4, er: 20, mw: 0.01, my: 300, lid: '#43A047', brow: '#1B5E20', cheeks: false });
      R.face.mouth.setAttribute('opacity', 0);
      mk('circle', { cx: 90, cy: 4, r: 12, fill: '#FF8A80', opacity: 0.45 }, R.head);
      R.headAnchor = { x: 160, y: -170 };
      R.height = 170;
      R.update = (s) => {
        const t = s.t || 0;
        R.tail.setAttribute('transform', `rotate(${Math.sin(t * 2.4) * 6} -240 -40)`);
        R.inner.setAttribute('transform', `translate(0,${Math.sin(t * 1.8) * 3})`);
        R.jaw.setAttribute('transform', `rotate(${clamp(s.mouth || 0) * 22 + (s.emotion === 'happy' ? 6 : 0)} -40 20)`);
        R.head.setAttribute('transform', `translate(150,-80) rotate(${s.mouth > 0.08 ? -Math.sin(t * 6) * 2 : 0})`);
        R.face.update({ ...s, mouth: 0 });
      };
      return R;
    } },
  };

  root.CAST = { SPECIES, face, biped, mk };
})(window);
