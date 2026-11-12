// Toy-3D cast for Kahani Pitara: 11 animals built from soft "clay" primitives.
// Every rig: { root, height, scale, head, hand, update(s) } where
// s = { t, mouth (0..1 voice envelope), emotion, pose, walkPhase, blink }.
// Local forward is +z; the runtime turns the root to face left/right.
import { THREE, clay, mesh, sphere, capsule, cyl, eye, clamp, lerp } from './toy.js';

const S = 28; // sphere detail (kept modest — the renderer is a CPU rasteriser)
const sph = r => sphere(r, S);

// ───────── shared face: eyes, brows, mouth (smile ⟷ open), cheeks ─────────
function face(head, o) {
  const F = { eyes: [], brows: [] };
  const z = x => Math.sqrt(Math.max(0, o.R * o.R - x * x)) * (o.zk || 1);
  [-1, 1].forEach(s => {
    const x = s * o.ex, y = o.ey, e = eye(head, [x, y, z(Math.hypot(x, y)) - o.er * 0.35], o.er, o.iris || '#3b2414');
    e.rotation.y = s * (o.eyeYaw || 0.12);
    F.eyes.push(e);
    const arc = mesh(new THREE.TorusGeometry(o.er * 0.75, o.er * 0.16, 8, 18, Math.PI), clay('#2b1a10', 0.5), head, [x, y - o.er * 0.2, z(Math.hypot(x, y)) + 0.005], [1, 1.1, 0.5], false);
    arc.rotation.y = e.rotation.y; arc.visible = false; (F.arcs = F.arcs || []).push(arc);
    const b = new THREE.Group(); b.position.set(x, y + o.er * 1.45, z(Math.hypot(x, y + o.er * 1.45)) - 0.01); head.add(b);
    const bm = mesh(capsule(o.er * 0.16, o.er * 0.9), clay(o.brow || '#4a3020', 0.6), b, [0, 0, 0], [1, 1, 0.6], false); bm.rotation.z = Math.PI / 2;
    b.side = s; F.brows.push(b);
  });
  const mp = o.mouthPos || [0, o.my, z(Math.abs(o.my)) + 0.005];
  const mg = new THREE.Group(); mg.position.set(...mp); if (o.mouthTilt) mg.rotation.x = o.mouthTilt; head.add(mg);
  const w = o.mw;
  F.open = mesh(sph(1), clay('#4a140e', 0.45), mg, [0, 0, 0], [w, 0.02, w * 0.45], false);
  F.tongue = mesh(sph(1), clay('#ff7f8f', 0.5), mg, [0, -w * 0.3, w * 0.12], [w * 0.55, w * 0.25, w * 0.3], false);
  F.smile = mesh(new THREE.TorusGeometry(w * 0.85, w * 0.13, 8, 20, Math.PI), clay('#4a140e', 0.45), mg, [0, w * 0.35, 0], [1, 0.75, 1], false);
  F.mg = mg; F.w = w;
  if (o.cheek) [-1, 1].forEach(s => mesh(sph(1), clay(o.cheek, 0.8), head, [s * o.ex * 1.75, o.ey - o.er * 1.2, z(o.ex * 1.75) - 0.02], [o.er * 0.6, o.er * 0.38, o.er * 0.25], false));
  F.lid = o.lid;
  F.update = (s) => {
    const em = s.emotion || 'happy';
    const talk = clamp(s.mouth || 0);
    let open = talk, smileOn = talk < 0.08, sad = false, eyeY = 1, eyeS = 1, blink = !!s.blink;
    let bAng = 0, bUp = 0;
    switch (em) {
      case 'laughing': open = Math.max(talk, 0.45 + Math.abs(Math.sin((s.t || 0) * 9)) * 0.3); smileOn = false; eyeY = 0; bUp = 0.02; break;
      case 'happy': case 'proud': bUp = 0.01; if (em === 'proud') { eyeY = 0.88; bAng = 0.1; } break;
      case 'sad': case 'crying': sad = true; bAng = -0.42; bUp = 0.01; eyeY = em === 'crying' ? 0.55 : 0.85; break;
      case 'angry': bAng = 0.55; bUp = -0.03; sad = true; eyeY = 0.8; break;
      case 'surprised': open = Math.max(talk, 0.55); smileOn = false; eyeS = 1.18; bUp = 0.06; bAng = -0.1; break;
      case 'scared': open = Math.max(talk, 0.3); smileOn = false; eyeS = 1.15; bAng = -0.35; bUp = 0.05; break;
      case 'sleepy': blink = true; break;
      case 'thinking': bAng = -0.15; bUp = 0.03; break;
      default: break;
    }
    if (s.pose === 'sleep') { blink = true; open = 0; smileOn = true; }
    F.eyes.forEach(e => { e.visible = eyeY > 0; e.scale.set(eyeS, eyeS * eyeY, eyeS); e.blink(blink, F.lid); });
    F.arcs.forEach(a => { a.visible = eyeY === 0; });
    F.brows.forEach(b => { b.rotation.z = b.side * bAng; b.position.y = o.ey + o.er * 1.45 + bUp * (o.R / 0.42); });
    F.open.visible = !smileOn;
    F.open.scale.set(w * (1 - open * 0.2), 0.03 + open * w * 0.95, w * 0.45);
    F.tongue.visible = !smileOn && open > 0.25;
    F.smile.visible = smileOn;
    F.smile.rotation.z = sad ? 0 : Math.PI;
    F.smile.position.y = sad ? -w * 0.55 : w * 0.35;
  };
  return F;
}

// ───────── generic toy biped (rabbit, lion, fox, mouse, elephant, monkey, bear, crow) ─────────
function biped(o) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);              // bobs / leans
  const fur = clay(o.fur), belly = clay(o.belly), paw = clay(o.paw || o.belly), limb = clay(o.limb || o.fur);
  const bR = o.bodyR || 0.42, bY = o.bodyY || 0.56;
  mesh(sph(bR), fur, body, [0, bY, 0], [1, o.bodyTall || 1.1, 0.92]);
  if (!o.noBelly) mesh(sph(bR * 0.74), belly, body, [0, bY - 0.04, bR * 0.36], [1, 1.1, 0.62]);
  // legs (pivot at hips)
  const legs = [-1, 1].map(s => {
    const g = new THREE.Group(); g.position.set(s * bR * 0.45, 0.3, 0); root.add(g);
    mesh(capsule(o.legR || 0.11, 0.14), limb, g, [0, -0.13, 0]);
    mesh(sph(o.footR || 0.14), paw, g, [0, -0.25, 0.06], [1, 0.55, 1.45]);
    return g;
  });
  // arms (pivot at shoulders)
  const arms = [-1, 1].map(s => {
    const g = new THREE.Group(); g.position.set(s * bR * 0.88, bY + bR * 0.42, 0.04); body.add(g);
    if (o.wing) { const w = mesh(sph(1), limb, g, [0, -0.2, -0.02], [0.08, 0.26, 0.2]); w.rotation.z = s * 0.1; g.paw = w; }
    else { mesh(capsule(o.armR || 0.075, o.armLen || 0.2), limb, g, [0, -0.15, 0]); g.paw = mesh(sph((o.armR || 0.075) * 1.35), paw, g, [0, -0.3, 0.01]); }
    g.side = s; return g;
  });
  const head = new THREE.Group(); const hR = o.headR || 0.42;
  head.position.set(0, bY + bR * 1.02 + hR * 0.62, 0.02); body.add(head);
  mesh(sph(hR), fur, head, [0, 0, 0], o.headScale || [1.05, 0.95, 0.95]);
  if (o.decor) o.decor(head, { fur, belly, paw, hR, body, root });
  const F = face(head, { R: hR * 0.96, zk: 0.95, ex: o.ex || hR * 0.36, ey: o.ey || hR * 0.18, er: o.er || hR * 0.26, my: o.my || -hR * 0.42, mw: o.mw || hR * 0.2, lid: o.fur, brow: o.brow, iris: o.iris, cheek: o.cheek === undefined ? '#ffb3c1' : o.cheek, mouthPos: o.mouthPos, eyeYaw: o.eyeYaw });
  const tail = new THREE.Group(); tail.position.set(0, bY - 0.1, -bR * 0.85); body.add(tail);
  if (o.tail) o.tail(tail, { fur, belly, paw });
  const height = head.position.y + hR * 0.95 + (o.extraTop || 0);
  const R = { root, height, frameH: height - (o.extraTop || 0), scale: o.scale || 1, head, arms, legs, body, tail, F };
  R.hand = arms[1].paw;
  R.update = (s) => {
    const t = s.t || 0, pose = s.pose || 'idle', em = s.emotion || 'happy';
    let lean = 0, bob = Math.sin(t * 2.2) * 0.01, hx = 0, hz = Math.sin(t * 1.3) * 0.04, hy = 0;
    let a = [[0.22, 0], [0.22, 0]]; // [outward(z-rot), forward(x-rot)] per arm (L, R)
    let lg = [0, 0], sit = 0, shake = 0, legOut = 0;
    const wp = s.walkPhase || 0;
    switch (pose) {
      case 'walk': case 'run': {
        const k = pose === 'run' ? 1 : 0.6;
        lg = [Math.sin(wp) * 0.8 * k, -Math.sin(wp) * 0.8 * k];
        a = [[0.3, -Math.sin(wp) * 0.9 * k], [0.3, Math.sin(wp) * 0.9 * k]];
        bob = Math.abs(Math.sin(wp)) * (pose === 'run' ? 0.09 : 0.04); lean = pose === 'run' ? 0.18 : 0.05; break;
      }
      case 'celebrate': a = [[2.5 + Math.sin(t * 9) * 0.25, 0], [2.5 + Math.sin(t * 9 + 1) * 0.25, 0]]; bob = Math.abs(Math.sin(t * 6)) * 0.12; hz = Math.sin(t * 6) * 0.1; break;
      case 'wave': a = [[0.22, 0], [2.5 + Math.sin(t * 10) * 0.35, -0.2]]; hz = 0.08; break;
      case 'point': a = [[0.2, 0], [0.25, -1.45]]; hx = -0.05; break;
      case 'give': a = [[0.25, -1.2], [0.25, -1.3]]; break;
      case 'think': a = [[0.3, -0.5], [0.15, -2.4]]; hz = 0.18; hx = 0.08; break;
      case 'sad': a = [[0.06, 0.15], [0.06, 0.15]]; hx = 0.35; lean = 0.08; break;
      case 'laugh': a = [[0.5, -0.7], [0.5, -0.7]]; shake = Math.sin(t * 14) * 0.04; bob = Math.abs(Math.sin(t * 9)) * 0.06; hx = -0.15; break;
      case 'angry': a = [[0.55, -0.25 + Math.sin(t * 12) * 0.12], [0.55, -0.25 - Math.sin(t * 12) * 0.12]]; lean = 0.12; hx = 0.08; bob = Math.abs(Math.sin(t * 8)) * 0.03; break;
      case 'scared': a = [[0.45, -2.3], [0.45, -2.3]]; shake = Math.sin(t * 40) * 0.025; lean = -0.1; break;
      case 'sleep': sit = 1; a = [[0.15, -0.3], [0.15, -0.3]]; hx = 0.45; hz = 0.25; bob = Math.sin(t * 1.4) * 0.015; break;
      case 'fly': a = [[1.2 + Math.sin(t * 16) * 1.0, 0], [1.2 + Math.sin(t * 16) * 1.0, 0]]; lg = [0.5, 0.5]; lean = 0.25; break;
      default: break;
    }
    if (em === 'scared' && pose === 'idle') shake = Math.sin(t * 40) * 0.02;
    body.position.set(shake, bob - sit * 0.22, 0);
    body.rotation.x = lean;
    legs.forEach((l, i) => { l.rotation.x = sit ? -1.5 : lg[i]; l.rotation.z = (i ? 1 : -1) * legOut; l.position.y = 0.3 - sit * 0.2 + (pose === 'run' || pose === 'walk' ? bob * 0.5 : 0); });
    arms.forEach((g, i) => { g.rotation.z = g.side * a[i][0]; g.rotation.x = a[i][1]; });
    head.rotation.set(hx, hy, hz);
    F.update(s);
    if (o.animate) o.animate(R, s);
  };
  return R;
}

const whiskers = (head, x, y, z, len, color = '#9e9e9e') => [-1, 1].forEach(s => [0.06, -0.04].forEach((dy, k) => {
  const w = mesh(cyl(0.006, 0.006, len, 5), clay(color, 0.6), head, [s * (x + len / 2), y + dy, z], [1, 1, 1], false);
  w.rotation.z = Math.PI / 2 + s * (k ? -0.12 : 0.12);
}));

export const SPECIES3D = {
  rabbit: () => biped({
    fur: '#f4efe6', belly: '#ffffff', paw: '#ffe4e1', headR: 0.42, extraTop: 0.55, scale: 1,
    decor: (h, m) => {
      mesh(sph(0.17), m.belly, h, [-0.11, -0.15, 0.32], [1, 0.8, 0.7]); mesh(sph(0.17), m.belly, h, [0.11, -0.15, 0.32], [1, 0.8, 0.7]);
      mesh(sph(0.055), clay('#ff8fa3', 0.35), h, [0, -0.05, 0.42], [1.25, 0.9, 0.8]);
      mesh(new THREE.BoxGeometry(0.07, 0.07, 0.02), clay('#ffffff', 0.3), h, [0, -0.27, 0.36], [1, 1, 1], false);
      whiskers(h, 0.2, -0.13, 0.36, 0.26);
      h.ears = [-1, 1].map(s => { const e = new THREE.Group(); e.position.set(s * 0.16, 0.33, -0.04); h.add(e); mesh(capsule(0.1, 0.5), m.fur, e, [0, 0.32, 0]); mesh(capsule(0.055, 0.42), clay('#f8a5b6'), e, [0, 0.32, 0.06], [1, 1, 0.4]); e.side = s; return e; });
    },
    tail: (g, m) => mesh(sph(0.13), m.belly, g, [0, 0, -0.04]),
    animate: (R, s) => { const droop = s.emotion === 'sad' || s.emotion === 'crying' || s.pose === 'sleep' ? 0.5 : (s.emotion === 'scared' ? 0.3 : 0); (R.head.ears || []).forEach((e, i) => { e.rotation.z = -e.side * (0.12 + droop * 0.9 + Math.sin((s.t || 0) * 3 + i) * 0.06); e.rotation.x = -0.1 - droop * 1.6; }); },
  }),
  lion: () => biped({
    fur: '#f2b544', belly: '#fbe3a1', paw: '#fbe3a1', headR: 0.44, bodyR: 0.46, scale: 1.18, brow: '#7b3f00', cheek: null,
    decor: (h, m) => {
      const mane = [];
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; mane.push(mesh(sph(0.17), clay(i % 2 ? '#c0612b' : '#d9792f', 0.8), h, [Math.cos(a) * 0.42, Math.sin(a) * 0.42 + 0.02, -0.14], [1, 1, 0.75])); }
      [-1, 1].forEach(s => { mesh(sph(0.11), m.fur, h, [s * 0.3, 0.33, 0.02]); mesh(sph(0.06), clay('#d9792f'), h, [s * 0.3, 0.33, 0.08], [1, 1, 0.5]); });
      mesh(sph(0.2), m.belly, h, [0, -0.17, 0.3], [1.2, 0.8, 0.75]);
      mesh(sph(0.06), clay('#5d3a1a', 0.4), h, [0, -0.07, 0.45], [1.3, 0.8, 0.8]);
      whiskers(h, 0.2, -0.17, 0.4, 0.2, '#7b5a36');
    },
    my: -0.25, mw: 0.08, mouthPos: [0, -0.26, 0.42],
    tail: (g, m) => { const c = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.05, -0.25), new THREE.Vector3(0, 0.3, -0.42), new THREE.Vector3(0, 0.55, -0.4)]); mesh(new THREE.TubeGeometry(c, 20, 0.04, 8), m.fur, g); mesh(sph(0.1), clay('#c0612b', 0.8), g, [0, 0.6, -0.4]); },
  }),
  fox: () => biped({
    fur: '#f07b22', belly: '#fff3e0', paw: '#3e2723', limb: '#e8701b', headR: 0.41, brow: '#3e2723', iris: '#2b1a10', cheek: null,
    decor: (h, m) => {
      [-1, 1].forEach(s => { const e = mesh(new THREE.ConeGeometry(0.14, 0.38, 20), m.fur, h, [s * 0.24, 0.42, -0.04]); e.rotation.z = -s * 0.32; const i = mesh(new THREE.ConeGeometry(0.08, 0.26, 16), clay('#3e2723'), h, [s * 0.235, 0.41, 0.02]); i.rotation.z = -s * 0.32; });
      const mz = mesh(new THREE.ConeGeometry(0.2, 0.36, 24), m.belly, h, [0, -0.13, 0.36]); mz.rotation.x = Math.PI / 2;
      mesh(sph(0.06), clay('#2b1a10', 0.35), h, [0, -0.11, 0.55]);
      [-1, 1].forEach(s => mesh(sph(0.16), m.belly, h, [s * 0.2, -0.17, 0.2], [1, 0.8, 0.8]));
    },
    my: -0.26, mw: 0.07, mouthPos: [0, -0.24, 0.43],
    tail: (g, m) => { const t = new THREE.Group(); t.rotation.x = -0.9; g.add(t); mesh(sph(0.2), m.fur, t, [0, 0, -0.3], [0.85, 0.85, 1.8]); mesh(sph(0.13), m.belly, t, [0, 0, -0.62], [0.9, 0.9, 1]); g.wag = t; },
    animate: (R, s) => { if (R.tail.wag) R.tail.wag.rotation.y = Math.sin((s.t || 0) * 3) * 0.3; },
  }),
  mouse: () => biped({
    fur: '#a8a8b3', belly: '#e4e4ec', paw: '#ffc1cc', headR: 0.42, scale: 0.62, cheek: '#ffb3c1',
    decor: (h, m) => {
      [-1, 1].forEach(s => { mesh(sph(0.24), m.fur, h, [s * 0.38, 0.32, -0.05], [1, 1, 0.35]); mesh(sph(0.16), clay('#ffc1cc'), h, [s * 0.38, 0.32, 0.03], [1, 1, 0.3]); });
      mesh(sph(0.16), m.belly, h, [0, -0.16, 0.33], [1.2, 0.8, 0.7]);
      mesh(sph(0.06), clay('#ff8fa3', 0.35), h, [0, -0.08, 0.47]);
      whiskers(h, 0.18, -0.14, 0.4, 0.3, '#7d7d88');
    },
    my: -0.27, mw: 0.07, mouthPos: [0, -0.26, 0.42],
    tail: (g) => { const c = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(0.1, -0.35, -0.3), new THREE.Vector3(-0.15, -0.25, -0.6), new THREE.Vector3(0, 0.05, -0.75)]); mesh(new THREE.TubeGeometry(c, 24, 0.025, 8), clay('#ffc1cc'), g); },
  }),
  elephant: () => biped({
    fur: '#9fb3c0', belly: '#b9cad4', paw: '#e3eaee', limb: '#93a7b4', headR: 0.46, bodyR: 0.5, bodyY: 0.6, legR: 0.15, footR: 0.17, armR: 0.1, scale: 1.3, cheek: '#f2b8c6', noBelly: false,
    ex: 0.2, ey: 0.12, er: 0.1,
    decor: (h, m) => {
      h.earsE = [-1, 1].map(s => { const g = new THREE.Group(); g.position.set(s * 0.4, 0.04, -0.06); h.add(g); mesh(sph(0.34), m.fur, g, [s * 0.12, 0, 0], [0.75, 1, 0.16]); mesh(sph(0.24), clay('#f2b8c6'), g, [s * 0.13, 0, 0.04], [0.75, 1, 0.1]); g.side = s; return g; });
      const trunk = new THREE.Group(); trunk.position.set(0, -0.1, 0.38); h.add(trunk); h.trunk = trunk;
      const segs = []; let par = trunk;
      for (let i = 0; i < 5; i++) { const g = new THREE.Group(); g.position.set(0, i ? -0.1 : 0, 0); par.add(g); mesh(sph(0.11 - i * 0.012), m.fur, g, [0, -0.05, 0], [1, 1.1, 1]); segs.push(g); par = g; }
      trunk.segs = segs;
      [-1, 1].forEach(s => { const tk = mesh(new THREE.ConeGeometry(0.035, 0.18, 12), clay('#fffdf5', 0.4), h, [s * 0.13, -0.24, 0.3]); tk.rotation.x = 2.4; });
    },
    mouthPos: [0, -0.3, 0.34], mw: 0.06,
    tail: (g, m) => { const tl = mesh(cyl(0.025, 0.02, 0.22, 6), m.fur, g, [0, -0.1, 0.02]); tl.rotation.x = 0.5; },
    animate: (R, s) => { const t = s.t || 0; const h = R.head; (h.earsE || []).forEach((e, i) => { e.rotation.y = e.side * (0.2 + Math.sin(t * 2.4 + i) * 0.15); }); if (h.trunk) h.trunk.segs.forEach((g, i) => { g.rotation.x = -0.22 - (s.pose === 'celebrate' ? 0.35 : 0) + (s.mouth || 0) * -0.12; g.rotation.z = Math.sin(t * 1.8 + i * 0.5) * 0.08; }); },
  }),
  monkey: () => biped({
    fur: '#8d5a3b', belly: '#e9c8a0', paw: '#e9c8a0', limb: '#7b4a2e', headR: 0.42, armLen: 0.3, cheek: '#f4a1a1', brow: '#5a3520',
    decor: (h, m) => {
      [-0.12, 0.12].forEach(x => mesh(sph(0.2), m.belly, h, [x, 0.06, 0.24], [1, 1.1, 0.7]));
      mesh(sph(0.22), m.belly, h, [0, -0.16, 0.26], [1.15, 0.8, 0.7]);
      [-1, 1].forEach(s => { mesh(sph(0.13), m.fur, h, [s * 0.44, 0.03, 0], [0.6, 1, 1]); mesh(sph(0.08), m.belly, h, [s * 0.47, 0.03, 0.02], [0.4, 1, 0.8]); });
      [-1, 1].forEach(s => mesh(sph(0.02), clay('#3e2723'), h, [s * 0.04, -0.08, 0.47], [1, 1, 1], false));
    },
    ex: 0.12, ey: 0.08, er: 0.1, my: -0.24, mw: 0.09, mouthPos: [0, -0.22, 0.45],
    tail: (g, m) => { const c = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.15, 0), new THREE.Vector3(0, -0.2, -0.4), new THREE.Vector3(0, 0.25, -0.65), new THREE.Vector3(0, 0.55, -0.45), new THREE.Vector3(0, 0.45, -0.3)]); mesh(new THREE.TubeGeometry(c, 28, 0.04, 8), clay('#7b4a2e'), g); },
  }),
  bear: () => biped({
    fur: '#8b5e3c', belly: '#d9b48a', paw: '#d9b48a', limb: '#7d5233', headR: 0.44, bodyR: 0.48, scale: 1.15, brow: '#4a2c17', cheek: '#e8a090',
    decor: (h, m) => {
      [-1, 1].forEach(s => { mesh(sph(0.13), m.fur, h, [s * 0.3, 0.32, 0]); mesh(sph(0.07), m.belly, h, [s * 0.3, 0.32, 0.07], [1, 1, 0.5]); });
      mesh(sph(0.19), m.belly, h, [0, -0.16, 0.3], [1.2, 0.85, 0.8]);
      mesh(sph(0.07), clay('#2b1a10', 0.35), h, [0, -0.08, 0.46], [1.3, 0.85, 0.8]);
    },
    my: -0.27, mw: 0.08, mouthPos: [0, -0.27, 0.43],
    tail: (g, m) => mesh(sph(0.09), m.fur, g, [0, 0, -0.02]),
  }),
  crow: () => biped({
    fur: '#353b48', belly: '#4b5263', paw: '#e0a030', limb: '#2b2f3a', headR: 0.38, bodyR: 0.4, legR: 0.04, footR: 0.09, wing: true, scale: 0.85, iris: '#1a1a1a', brow: '#1d2027', cheek: null,
    decor: (h, m) => {
      const top = mesh(new THREE.ConeGeometry(0.11, 0.38, 20), clay('#8a8f98', 0.4), h, [0, -0.04, 0.48]); top.rotation.x = Math.PI / 2; h.beakTop = top;
      const bot = new THREE.Group(); bot.position.set(0, -0.1, 0.34); h.add(bot); const b2 = mesh(new THREE.ConeGeometry(0.085, 0.3, 18), clay('#6b7079', 0.4), bot, [0, 0, 0.13]); b2.rotation.x = Math.PI / 2; h.beakBot = bot;
      for (let i = 0; i < 3; i++) { const f = mesh(new THREE.ConeGeometry(0.04, 0.2, 10), m.fur, h, [(i - 1) * 0.06, 0.4, -0.02]); f.rotation.z = (i - 1) * -0.4; }
    },
    ex: 0.15, ey: 0.12, er: 0.085, mouthPos: [0, -0.5, 0], mw: 0.001,
    tail: (g, m) => { [-1, 0, 1].forEach(i => { const f = mesh(sph(0.1), clay('#2b2f3a'), g, [i * 0.08, -0.05, -0.18], [0.5, 0.15, 1.6]); f.rotation.y = i * 0.25; f.rotation.x = 0.4; }); },
    animate: (R, s) => { const h = R.head; if (h.beakBot) h.beakBot.rotation.x = clamp(s.mouth || 0) * 0.55 + (s.emotion === 'laughing' ? 0.3 : 0); R.F.mg.visible = false; },
  }),

  // ── quadrupeds / special shapes ──
  tortoise: () => {
    const root = new THREE.Group(); const body = new THREE.Group(); root.add(body);
    const SKIN = '#9ccc65', skin = clay(SKIN);
    const legs = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([a, b]) => { const g = new THREE.Group(); g.position.set(a * 0.42, 0.26, b * 0.4); body.add(g); mesh(capsule(0.13, 0.12), skin, g, [0, -0.12, 0]); g.ab = [a, b]; return g; });
    mesh(new THREE.SphereGeometry(0.68, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), clay('#5e8c31', 0.65), body, [0, 0.24, 0], [1, 0.85, 1.12]);
    mesh(new THREE.TorusGeometry(0.68, 0.07, 14, 48), clay('#c9b66a', 0.7), body, [0, 0.24, 0], [1, 1.12, 1]).rotation.x = Math.PI / 2;
    [[0, 0.8, 0], [0.33, 0.64, 0.3], [-0.33, 0.64, 0.3], [0.33, 0.64, -0.32], [-0.33, 0.64, -0.32], [0, 0.62, 0.5], [0, 0.62, -0.52]].forEach(([x, y, z]) => mesh(sph(0.2), clay('#7daa45', 0.6), body, [x, y, z], [1, 0.35, 1]));
    mesh(cyl(0.02, 0.08, 0.16, 10), skin, body, [0, 0.22, -0.78]).rotation.x = -1.3;
    const neck = mesh(capsule(0.13, 0.22), skin, body, [0, 0.44, 0.68]); neck.rotation.x = 0.9;
    const head = new THREE.Group(); head.position.set(0, 0.66, 0.9); body.add(head);
    mesh(sph(0.29), skin, head, [0, 0, 0], [1, 0.92, 1.05]);
    const F = face(head, { R: 0.29, ex: 0.11, ey: 0.07, er: 0.08, my: -0.12, mw: 0.07, lid: SKIN, brow: '#5d4037', cheek: '#e57373', mouthPos: [0, -0.12, 0.27] });
    [-1, 1].forEach(s => mesh(new THREE.TorusGeometry(0.09, 0.012, 8, 24), clay('#5d4037', 0.4), head, [s * 0.11, 0.07, 0.26], [1, 1, 1], false));
    mesh(cyl(0.008, 0.008, 0.05, 6), clay('#5d4037'), head, [0, 0.07, 0.27]).rotation.z = Math.PI / 2;
    const R = { root, body, head, height: 1.0, frameH: 1.05, scale: 1, F, hand: head };
    R.update = s => {
      const t = s.t || 0, wp = s.walkPhase || 0, moving = s.pose === 'walk' || s.pose === 'run';
      legs.forEach(g => { const [a, b] = g.ab; g.rotation.x = moving ? Math.sin(wp * 0.7 + (a * b > 0 ? 0 : Math.PI)) * 0.5 : 0; });
      body.position.y = moving ? Math.abs(Math.sin(wp * 0.7)) * 0.03 : Math.sin(t * 1.2) * 0.01;
      let hx = Math.sin(t * 0.8) * 0.05, hz = 0, hy = 0.35, sh = 0;
      if (s.mouth > 0.05) hx += Math.sin(t * 2.4) * 0.1;
      if (s.pose === 'celebrate') { body.position.y += Math.abs(Math.sin(t * 6)) * 0.1; hz = Math.sin(t * 6) * 0.15; }
      if (s.pose === 'laugh' || s.emotion === 'laughing') hz = Math.sin(t * 10) * 0.1;
      if (s.pose === 'sad' || s.emotion === 'sad' || s.emotion === 'crying') hx = 0.3;
      if (s.pose === 'think') hz = 0.2;
      if (s.pose === 'sleep') { head.position.set(0, 0.42, 0.72); hx = 0.4; } else head.position.set(0, 0.66, 0.9);
      if (s.emotion === 'scared') sh = Math.sin(t * 40) * 0.02;
      body.position.x = sh;
      head.rotation.set(hx, hy, hz);
      F.update(s);
    };
    return R;
  },
  deer: () => {
    const root = new THREE.Group(); const body = new THREE.Group(); root.add(body);
    const coat = clay('#c8875b'), cream = clay('#f2d7b9'), hoof = clay('#5d4037');
    const torso = new THREE.Group(); torso.position.set(0, 0.95, 0); body.add(torso);
    mesh(sph(0.42), coat, torso, [0, 0, 0], [0.85, 0.75, 1.35]);
    mesh(sph(0.34), cream, torso, [0, -0.12, 0.05], [0.75, 0.55, 1.15]);
    [[0.18, 0.25, -0.2], [-0.2, 0.22, 0.05], [0.12, 0.26, 0.25], [-0.1, 0.28, -0.35], [0.24, 0.15, 0.1], [-0.25, 0.12, -0.15]].forEach(p => mesh(sph(0.045), clay('#f7e6d3'), torso, p, [1, 0.5, 1], false));
    mesh(sph(0.1), clay('#ffffff'), torso, [0, 0.12, -0.56], [0.8, 1.2, 0.6]);
    const legs = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([a, b]) => { const g = new THREE.Group(); g.position.set(a * 0.18, 0.82, b * 0.36); body.add(g); mesh(capsule(0.06, 0.58), coat, g, [0, -0.38, 0]); mesh(sph(0.075), hoof, g, [0, -0.76, 0.01], [1, 0.7, 1.2]); g.ab = [a, b]; return g; });
    const neck = new THREE.Group(); neck.position.set(0, 1.12, 0.42); body.add(neck); neck.rotation.x = -0.35;
    mesh(capsule(0.13, 0.4), coat, neck, [0, 0.25, 0]);
    const head = new THREE.Group(); head.position.set(0, 0.6, 0.06); neck.add(head); head.rotation.x = 0.35;
    mesh(sph(0.3), coat, head, [0, 0, 0], [1, 0.95, 1]);
    mesh(sph(0.18), cream, head, [0, -0.11, 0.2], [1, 0.75, 0.9]);
    mesh(sph(0.055), clay('#3e2723', 0.35), head, [0, -0.07, 0.36], [1.3, 0.9, 0.8]);
    const ears = [-1, 1].map(s => { const e = new THREE.Group(); e.position.set(s * 0.25, 0.18, -0.02); head.add(e); mesh(sph(0.16), coat, e, [s * 0.1, 0, 0], [1, 0.45, 0.3]); mesh(sph(0.1), clay('#f8c0b0'), e, [s * 0.1, 0, 0.03], [1, 0.4, 0.2]); e.rotation.z = s * -0.35; e.side = s; return e; });
    [-1, 1].forEach(s => { const an = mesh(cyl(0.02, 0.03, 0.2, 8), clay('#8d6e63'), head, [s * 0.1, 0.33, -0.02]); an.rotation.z = -s * 0.3; });
    const F = face(head, { R: 0.29, ex: 0.12, ey: 0.06, er: 0.085, mw: 0.06, lid: '#c8875b', brow: '#5d4037', cheek: '#f4a1a1', mouthPos: [0, -0.19, 0.3], eyeYaw: 0.2 });
    const R = { root, body, head, height: 2.05, frameH: 2.05, scale: 1, F, hand: head };
    R.update = s => {
      const t = s.t || 0, wp = s.walkPhase || 0, moving = s.pose === 'walk' || s.pose === 'run';
      const k = s.pose === 'run' ? 0.8 : 0.45;
      legs.forEach(g => { const [a, b] = g.ab; g.rotation.x = moving ? Math.sin(wp + (a * b > 0 ? 0 : Math.PI)) * k : (s.pose === 'sleep' ? 0 : 0); });
      let by = moving ? Math.abs(Math.sin(wp)) * 0.05 : Math.sin(t * 1.5) * 0.008, nx = -0.35, hz = Math.sin(t * 1.1) * 0.05;
      if (s.pose === 'celebrate') { by += Math.abs(Math.sin(t * 6)) * 0.18; hz = Math.sin(t * 6) * 0.12; }
      if (s.pose === 'sad' || s.emotion === 'sad' || s.emotion === 'crying') nx = 0.1;
      if (s.pose === 'sleep') { by = -0.55; legs.forEach(g => { g.rotation.x = 0; g.scale.y = 0.35; }); nx = 0.4; } else legs.forEach(g => { g.scale.y = 1; });
      if (s.emotion === 'scared') body.position.x = Math.sin(t * 40) * 0.02; else body.position.x = 0;
      body.position.y = by; neck.rotation.x = nx + (s.mouth > 0.05 ? Math.sin(t * 2.2) * 0.05 : 0); head.rotation.z = hz;
      ears.forEach((e, i) => { e.rotation.z = e.side * -(0.35 + Math.sin(t * 2 + i) * 0.08 + (s.emotion === 'sad' ? 0.4 : 0)); });
      F.update(s);
    };
    return R;
  },
  crocodile: () => {
    const root = new THREE.Group(); const body = new THREE.Group(); root.add(body);
    const green = clay('#43a047', 0.6), dark = clay('#2e7d32', 0.6), light = clay('#9ccc65', 0.7), white = clay('#ffffff', 0.4);
    mesh(sph(0.5), green, body, [0, 0.32, -0.25], [0.85, 0.48, 1.7]);
    mesh(sph(0.4), light, body, [0, 0.18, -0.2], [0.75, 0.3, 1.45]);
    for (let i = 0; i < 7; i++) mesh(new THREE.ConeGeometry(0.06, 0.14, 8), dark, body, [0, 0.56 - i * 0.008, 0.25 - i * 0.22]);
    const tail = mesh(new THREE.ConeGeometry(0.3, 1.5, 20), green, body, [0, 0.28, -1.65], [1, 1, 0.55]); tail.rotation.x = -Math.PI / 2;
    [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([a, b]) => mesh(capsule(0.09, 0.12), dark, body, [a * 0.42, 0.1, b * 0.45 - 0.2]));
    const head = new THREE.Group(); head.position.set(0, 0.36, 0.55); body.add(head);
    const upper = new THREE.Group(); head.add(upper);
    mesh(sph(0.3), green, upper, [0, 0.04, 0.02], [1, 0.75, 1]);
    mesh(new THREE.BoxGeometry(0.42, 0.14, 0.62), green, upper, [0, 0, 0.46]);
    mesh(sph(0.21), green, upper, [0, 0, 0.78], [1, 0.34, 0.5]);
    for (let i = 0; i < 5; i++) [-1, 1].forEach(s => mesh(new THREE.ConeGeometry(0.025, 0.07, 6), white, upper, [s * 0.18, -0.09, 0.3 + i * 0.12], [1, 1, 1], false).rotation.x = Math.PI);
    [-1, 1].forEach(s => mesh(sph(0.03), dark, upper, [s * 0.07, 0.08, 0.86], [1, 1, 1], false));
    const jaw = new THREE.Group(); jaw.position.set(0, -0.06, 0.12); head.add(jaw);
    mesh(new THREE.BoxGeometry(0.38, 0.08, 0.66), light, jaw, [0, -0.04, 0.34]);
    mesh(new THREE.BoxGeometry(0.3, 0.02, 0.56), clay('#c2185b', 0.6), jaw, [0, 0.005, 0.32], [1, 1, 1], false);
    for (let i = 0; i < 5; i++) [-1, 1].forEach(s => mesh(new THREE.ConeGeometry(0.022, 0.06, 6), white, jaw, [s * 0.16, 0.03, 0.2 + i * 0.12], [1, 1, 1], false));
    const eyeG = new THREE.Group(); eyeG.position.set(0, 0.17, 0.08); upper.add(eyeG);
    [-1, 1].forEach(s => mesh(sph(0.11), green, eyeG, [s * 0.13, 0, 0], [1, 0.9, 1]));
    const F = face(eyeG, { R: 0.14, ex: 0.13, ey: 0.03, er: 0.07, mw: 0.001, lid: '#43a047', brow: '#1b5e20', mouthPos: [0, -5, 0] });
    F.mg.visible = false;
    F.eyes.forEach((e, i) => { e.position.set((i ? 1 : -1) * 0.13, 0.03, 0.08); }); F.arcs.forEach((a, i) => { a.position.set((i ? 1 : -1) * 0.13, 0.02, 0.15); });
    F.brows.forEach((b, i) => { b.position.set((i ? 1 : -1) * 0.13, 0.13, 0.06); });
    const R = { root, body, head, height: 0.8, frameH: 0.9, scale: 1.05, F, hand: head };
    R.update = s => {
      const t = s.t || 0;
      jaw.rotation.x = clamp(s.mouth || 0) * 0.45 + (s.emotion === 'laughing' ? 0.3 + Math.abs(Math.sin(t * 9)) * 0.15 : 0);
      upper.rotation.x = -clamp(s.mouth || 0) * 0.15;
      tail.rotation.y = Math.sin(t * 1.4) * 0.12;
      body.position.y = Math.sin(t * 1.6) * 0.03;
      head.rotation.z = Math.sin(t * 1.1) * 0.04;
      F.update({ ...s, mouth: 0 });
      F.brows.forEach(b => { b.position.y = 0.13; });
    };
    return R;
  },
};

// Build a rig for a species (unknown → rabbit), normalised so root sits on the ground at y=0.
export function buildCharacter(species) {
  const make = SPECIES3D[species] || SPECIES3D.rabbit;
  const R = make();
  R.species = species;
  R.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  R.headTop = new THREE.Object3D(); R.head.add(R.headTop);
  R.headTop.position.set(0, species === 'tortoise' || species === 'deer' ? 0.3 : 0.45, 0);
  if (!R.update) R.update = () => {};
  const raw = R.update; R.update = s => { raw(s); };
  return R;
}

export const SPECIES_IDS = Object.keys(SPECIES3D);
