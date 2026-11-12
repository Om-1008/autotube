// Toy-3D story worlds: jungle, riverbank, village, night, meadow.
// The acting strip is x ∈ [-7, 7], z ∈ [-1.2, 1.6]; props stay out of it.
// build(scene) → { group, look: {top, bottom, fog, hemi, ground, sun, sunPos, exposure}, update(t), water? }
import { THREE, clay, mesh, sphere, cyl, rbox, rng } from './toy.js';

const sph = (r, s = 20) => sphere(r, s);

function instanced(geo, mat, list, parent) {
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  const o = new THREE.Object3D();
  list.forEach((p, i) => { o.position.set(p[0], p[1], p[2]); o.rotation.set(p[6] || 0, p[7] || 0, p[8] || 0); o.scale.set(p[3] || 1, p[4] || p[3] || 1, p[5] || p[3] || 1); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
  m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
const outsideStrip = (x, z) => !(Math.abs(x) < 8.5 && z > -2 && z < 2.6);

function ground(g, color, size = 90) { const m = mesh(new THREE.CircleGeometry(size, 48), clay(color, 0.95), g); m.rotation.x = -Math.PI / 2; m.castShadow = false; return m; }
function roundTree(g, x, z, s = 1, cols = ['#4fa845', '#5dbb52'], trunk = '#8a5a33') {
  const t = new THREE.Group(); t.position.set(x, 0, z); t.scale.setScalar(s); g.add(t);
  mesh(cyl(0.16, 0.26, 1.7, 12), clay(trunk, 0.85), t, [0, 0.85, 0]);
  [[0, 2.1, 0, 1], [-0.55, 1.8, 0.2, 0.72], [0.6, 1.85, -0.1, 0.75], [0.1, 2.65, -0.1, 0.66]].forEach(([a, b, c, r], i) => mesh(sph(r), clay(cols[i % cols.length], 0.85), t, [a, b, c]));
  return t;
}
function palm(g, x, z, s = 1) {
  const t = new THREE.Group(); t.position.set(x, 0, z); t.scale.setScalar(s); g.add(t);
  const pts = []; for (let i = 0; i <= 6; i++) pts.push(new THREE.Vector3(Math.sin(i / 6 * 1.2) * 0.35, i * 0.55, 0));
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.13, 8), clay('#9c6b3f', 0.85), t);
  for (let i = 0; i < 7; i++) { const l = new THREE.Group(); l.position.set(0.3, 3.3, 0); l.rotation.y = i / 7 * Math.PI * 2; t.add(l); const lf = mesh(sph(0.5, 14), clay(i % 2 ? '#3f9b3c' : '#4cae45', 0.8), l, [0.75, -0.15, 0], [1.6, 0.12, 0.42]); lf.rotation.z = -0.35; }
  return t;
}
function pine(g, x, z, s = 1, col = '#2f7d45') {
  const t = new THREE.Group(); t.position.set(x, 0, z); t.scale.setScalar(s); g.add(t);
  mesh(cyl(0.12, 0.18, 0.8, 8), clay('#7a5230'), t, [0, 0.4, 0]);
  [[1.1, 1.3, 1.1], [0.9, 1.1, 1.8], [0.65, 0.9, 2.4]].forEach(([r, h, y]) => mesh(new THREE.ConeGeometry(r, h, 10), clay(col, 0.85), t, [0, y, 0]));
  return t;
}
function bushes(g, R, n, cols, zMin = -14, zMax = 4, xs = [2, 9]) {
  for (let i = 0; i < n; i++) { const x = (R() < 0.5 ? -1 : 1) * (xs[0] + R() * xs[1]), z = zMin + R() * (zMax - zMin); if (!outsideStrip(x, z)) continue; mesh(sph(0.35 + R() * 0.35, 14), clay(cols[i % cols.length], 0.9), g, [x, 0.15, z], [1.3, 0.8, 1]); }
}
function flowers(g, R, n, zMin, zMax, cols = ['#ff6fa8', '#ffd54f', '#ff8a65', '#ba68c8', '#ffffff'], ok = outsideStrip) {
  const stems = [], heads = cols.map(() => []);
  for (let i = 0; i < n; i++) { const x = (R() - 0.5) * 30, z = zMin + R() * (zMax - zMin); if (!ok(x, z)) continue; stems.push([x, 0.15, z, 1, 1, 1]); heads[i % cols.length].push([x, 0.32, z, 1, 0.7, 1]); }
  instanced(cyl(0.015, 0.015, 0.3, 5), clay('#3f8f35'), stems, g);
  heads.forEach((h, k) => h.length && instanced(sph(0.07, 10), clay(cols[k], 0.5), h, g));
}
function clouds(g, R, n = 6, y = 14, col = '#ffffff', glow = 0.35) {
  const list = [];
  for (let i = 0; i < n; i++) { const c = new THREE.Group(); c.position.set(-34 + i * 13, y + R() * 6, -42 - R() * 10); [[0, 0, 2.2], [2, -0.3, 1.6], [-2, -0.4, 1.5], [0.8, 0.9, 1.4]].forEach(([a, b, r]) => mesh(sph(r, 16), clay(col, 1, { emissive: col, emissiveIntensity: glow }), c, [a, b, 0], [1, 1, 1], false)); g.add(c); list.push(c); }
  return t => list.forEach((c, i) => { c.position.x = -34 + i * 13 + ((t * 0.35 + i * 3) % 12); });
}
function hills(g, list) { list.forEach(([x, z, r, c, sx = 1.6]) => { const m = mesh(sph(r, 28), clay(c, 0.95), g, [x, -r * 0.55, z], [sx, 1, 1]); m.castShadow = false; }); }
function mountains(g, list, col = '#8fb7d8') { list.forEach(([x, z, h]) => mesh(new THREE.ConeGeometry(h * 0.8, h, 6), clay(col, 0.95), g, [x, h / 2 - 1, z], [1, 1, 1], false)); }
function rocks(g, R, n, col = '#9e9e9e') { for (let i = 0; i < n; i++) { const x = (R() < 0.5 ? -1 : 1) * (3 + R() * 9), z = -10 + R() * 13; if (!outsideStrip(x, z)) continue; mesh(new THREE.DodecahedronGeometry(0.25 + R() * 0.35, 0), clay(col, 0.9), g, [x, 0.1, z], [1.3, 0.7, 1]); } }

export const WORLDS = {
  meadow(scene) {
    const g = new THREE.Group(), R = rng(5); scene.add(g);
    ground(g, '#7cc35a');
    const path = mesh(new THREE.PlaneGeometry(40, 2.4), clay('#e9d3a0', 0.95), g, [0, 0.01, 0.2]); path.rotation.x = -Math.PI / 2; path.castShadow = false;
    hills(g, [[-18, -30, 9, '#6ab74f'], [14, -34, 11, '#5aa944'], [-4, -42, 13, '#73bf5a']]);
    mountains(g, [[-26, -55, 12], [22, -58, 15], [0, -64, 18]]);
    [[-5.5, -3.5, 1.3], [5.8, -4.5, 1.4], [-9, -8, 1.6], [9.5, -9, 1.7], [-3, -12, 1.3], [3.5, -15, 1.4], [-11, -16, 1.8], [11, -3, 1.2]].forEach(a => roundTree(g, ...a));
    bushes(g, R, 22, ['#58b04a', '#69c056']);
    flowers(g, R, 260, -12, 5);
    const cl = clouds(g, R);
    return { group: g, look: { top: '#5fb2f2', bottom: '#e6f6ff', fog: ['#dff2ff', 22, 70], hemi: ['#ffffff', '#8a7a66', 1.25], sun: ['#fff1dc', 2.4], sunPos: [6, 10, 7], exposure: 1.05 }, update: t => cl(t) };
  },

  jungle(scene) {
    const g = new THREE.Group(), R = rng(11); scene.add(g);
    ground(g, '#5aa13f');
    const path = mesh(new THREE.PlaneGeometry(40, 2.6), clay('#c9a66b', 0.95), g, [0, 0.01, 0.2]); path.rotation.x = -Math.PI / 2; path.castShadow = false;
    hills(g, [[-16, -26, 8, '#3f8a35'], [12, -28, 9, '#468f38'], [0, -36, 12, '#3b7f31']]);
    const greens = [['#2f8a3a', '#3e9d45'], ['#3a9440', '#4caf50'], ['#2e7d32', '#43a047']];
    [[-5, -3, 1.5], [6, -3.6, 1.6], [-8.5, -6, 1.9], [9, -7, 2], [-12, -4, 2.2], [12.5, -5, 2.1], [-3.5, -9, 1.7], [3, -10, 1.8], [-7, -13, 2.2], [7.5, -14, 2.3], [0, -16, 2.4], [-14, -11, 2.5], [14, -12, 2.4]].forEach((a, i) => roundTree(g, a[0], a[1], a[2], greens[i % 3], '#6d4c2f'));
    [[-10, -2, 1.1], [10.5, -1.5, 1.2], [-6.5, -9.5, 1.3], [5.5, -6.5, 1.15]].forEach(a => palm(g, ...a));
    // big leaves + ferns at the sides
    for (let i = 0; i < 26; i++) { const s = R() < 0.5 ? -1 : 1, x = s * (8 + R() * 6), z = -6 + R() * 9; const l = mesh(sph(0.6, 12), clay(R() < 0.5 ? '#2e7d32' : '#388e3c', 0.8), g, [x, 0.3, z], [1.4, 0.12, 0.5]); l.rotation.set(R() * 0.6, R() * 3, 0.5 * s); }
    bushes(g, R, 30, ['#2e7d32', '#43a047', '#388e3c'], -12, 4);
    // mushrooms + flowers
    for (let i = 0; i < 10; i++) { const x = (R() < 0.5 ? -1 : 1) * (2.5 + R() * 7), z = -5 + R() * 7.5; if (!outsideStrip(x, z)) continue; mesh(cyl(0.05, 0.06, 0.2, 8), clay('#fff8e1'), g, [x, 0.1, z]); mesh(new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), clay('#e53935', 0.6), g, [x, 0.18, z]); }
    flowers(g, R, 120, -10, 4, ['#ff5252', '#ffeb3b', '#ff80ab', '#ffffff']);
    rocks(g, R, 10, '#8d8d8d');
    // hanging vines
    for (let i = 0; i < 6; i++) { const x = (i % 2 ? 1 : -1) * (3.5 + i), z = -4 - i; const v = mesh(cyl(0.025, 0.025, 3, 5), clay('#558b2f'), g, [x, 4.2, z]); v.castShadow = false; }
    const cl = clouds(g, R, 5, 16);
    return { group: g, look: { top: '#4aa3e8', bottom: '#d8f1c8', fog: ['#cfe8c0', 18, 60], hemi: ['#f4fff0', '#4f6b3a', 1.2], sun: ['#fff3d0', 2.3], sunPos: [5, 11, 6], exposure: 1.05 }, update: t => cl(t) };
  },

  riverbank(scene) {
    const g = new THREE.Group(), R = rng(21); scene.add(g);
    // near bank on the left (x < 0.4), river to the right
    const bank = mesh(new THREE.BoxGeometry(60, 2, 90), clay('#7cc35a', 0.95), g, [-29.6, -1, 0]); bank.castShadow = false;
    const edge = mesh(cyl(0.5, 0.5, 90, 12), clay('#a1887f', 0.95), g, [0.25, -0.45, 0]); edge.rotation.x = Math.PI / 2; edge.castShadow = false;
    const bed = mesh(new THREE.PlaneGeometry(80, 90), clay('#5d7f6a', 1), g, [40, -1.2, 0]); bed.rotation.x = -Math.PI / 2;
    const water = mesh(new THREE.PlaneGeometry(60, 90, 1, 1), new THREE.MeshStandardMaterial({ color: '#2aa3d8', roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.88 }), g, [30.4, -0.12, 0], [1, 1, 1], false);
    water.rotation.x = -Math.PI / 2; water.receiveShadow = true;
    // far bank
    const far = mesh(new THREE.BoxGeometry(40, 2, 90), clay('#6ab74f', 0.95), g, [32, -0.9, 0]); far.castShadow = false;
    mountains(g, [[20, -50, 14], [-20, -55, 16], [2, -62, 20]], '#90b4cf');
    hills(g, [[-18, -28, 9, '#5aa944'], [-6, -38, 12, '#6ab74f']]);
    [[-5, -3.5, 1.3], [-9, -6, 1.7], [-12, -2.5, 1.5], [-3, -10, 1.5], [14, -6, 1.8], [16, 0, 1.6], [13, -14, 2]].forEach(a => roundTree(g, ...a));
    palm(g, -7.5, -1.8, 1.1);
    // reeds along the water
    const reeds = [];
    for (let i = 0; i < 60; i++) { const z = -14 + R() * 18, x = 0.2 + R() * 0.7; if (z > -2 && z < 3) continue; reeds.push([x, 0.25, z, 1, 1 + R() * 0.6, 1, 0, 0, (R() - 0.5) * 0.3]); }
    instanced(cyl(0.025, 0.035, 0.9, 5), clay('#689f38'), reeds, g);
    instanced(capsule2(), clay('#6d4c41'), reeds.filter((_, i) => i % 3 === 0).map(p => [p[0], 0.75 * p[4], p[2], 1, 1, 1]), g);
    // lily pads + lotus
    const pads = [];
    for (let i = 0; i < 14; i++) { const x = 1.6 + R() * 8, z = -8 + R() * 10; if (Math.abs(x - 2.4) < 1.3 && z > -1.5) continue; const p = mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.03, 18, 1, false, 0.3, Math.PI * 1.85), clay('#4caf50', 0.7), g, [x, -0.1, z], [1, 1, 1], false); p.base = [x, z, R() * 6]; pads.push(p); if (i % 3 === 0) { mesh(sph(0.11, 12), clay('#f48fb1', 0.6), p, [0, 0.08, 0], [1, 0.8, 1], false); } }
    // ripples
    const rings = Array.from({ length: 5 }, (_, i) => { const r = mesh(new THREE.TorusGeometry(0.5, 0.02, 6, 32), new THREE.MeshBasicMaterial({ color: '#d6f3ff', transparent: true, opacity: 0.6 }), g, [2 + i * 1.6, -0.1, -3 + (i % 3) * 1.8], [1, 1, 1], false); r.rotation.x = Math.PI / 2; return r; });
    bushes(g, R, 14, ['#58b04a', '#69c056'], -12, 4, [3, 8]);
    flowers(g, R, 120, -10, 5, undefined, (x, z) => x < -0.8 && outsideStrip(x, z));
    const cl = clouds(g, R);
    return {
      group: g, water: { x0: 0.4, level: -0.12 },
      look: { top: '#55aaf0', bottom: '#e8f7ff', fog: ['#dff2ff', 22, 70], hemi: ['#ffffff', '#6e8a7a', 1.25], sun: ['#fff1dc', 2.4], sunPos: [6, 10, 7], exposure: 1.05 },
      update: t => {
        cl(t);
        pads.forEach(p => { p.position.y = -0.1 + Math.sin(t * 1.5 + p.base[2]) * 0.015; p.rotation.y = Math.sin(t * 0.4 + p.base[2]) * 0.2; });
        rings.forEach((r, i) => { const k = ((t * 0.35 + i * 0.37) % 1); r.scale.setScalar(0.3 + k * 2.2); r.material.opacity = 0.6 * (1 - k); });
      },
    };
  },

  village(scene) {
    const g = new THREE.Group(), R = rng(31); scene.add(g);
    ground(g, '#a5c46a');
    const yard = mesh(new THREE.CircleGeometry(14, 40), clay('#dcbc84', 0.95), g, [0, 0.01, -2], [1.6, 1, 1]); yard.rotation.x = -Math.PI / 2; yard.castShadow = false;
    const hut = (x, z, s = 1, wall = '#d7a86e', roof = '#b8862f') => {
      const h = new THREE.Group(); h.position.set(x, 0, z); h.scale.setScalar(s); g.add(h);
      mesh(cyl(1.3, 1.35, 1.6, 20), clay(wall, 0.9), h, [0, 0.8, 0]);
      mesh(new THREE.ConeGeometry(1.75, 1.5, 20), clay(roof, 0.95), h, [0, 2.3, 0]);
      mesh(new THREE.TorusGeometry(1.62, 0.08, 6, 24), clay('#9a6f22'), h, [0, 1.58, 0]).rotation.x = Math.PI / 2;
      mesh(rbox(0.7, 1.1, 0.1, 0.05), clay('#6d4c41', 0.8), h, [0, 0.55, 1.3]);
      [-1, 1].forEach(sd => mesh(rbox(0.36, 0.36, 0.08, 0.04), clay('#4e342e'), h, [sd * 0.78, 1.0, 1.05]).rotation.y = sd * 0.6);
      mesh(sph(0.35, 14), clay('#ffffff', 0.8, { emissive: '#ffffff', emissiveIntensity: 0.05 }), h, [0, 0.12, 1.35], [1.2, 0.2, 0.5]);
      return h;
    };
    hut(-6.5, -5, 1.25); hut(6.8, -6, 1.35, '#e0b07a', '#a8782a'); hut(-1, -10, 1.15, '#cf9a60'); hut(11, -2.5, 1.1);
    // well
    const w = new THREE.Group(); w.position.set(-10.5, 0, -1.2); g.add(w);
    mesh(cyl(0.75, 0.8, 0.8, 18), clay('#9e9e9e', 0.9), w, [0, 0.4, 0]); mesh(cyl(0.6, 0.6, 0.05, 18), clay('#1e5e8a', 0.3), w, [0, 0.79, 0]);
    [-1, 1].forEach(s => mesh(cyl(0.06, 0.06, 1.6, 8), clay('#6d4c41'), w, [s * 0.65, 1.3, 0]));
    mesh(new THREE.ConeGeometry(1.0, 0.6, 4), clay('#a1662f'), w, [0, 2.3, 0]).rotation.y = Math.PI / 4;
    mesh(cyl(0.18, 0.15, 0.25, 12), clay('#795548'), w, [0, 1.3, 0]);
    // haystacks, fence, pots
    [[8.5, -11, 1.2], [-9, -9, 1.0], [12.5, -7.5, 0.9]].forEach(([x, z, s]) => mesh(new THREE.ConeGeometry(1.1, 1.6, 16), clay('#e6c35c', 1), g, [x, 0.8 * s, z], [s, s, s]));
    for (let i = 0; i < 18; i++) { const x = -9 + i * 1.1; mesh(rbox(0.12, 0.8, 0.12, 0.03), clay('#8d6e63'), g, [x, 0.4, -14]); }
    mesh(rbox(20, 0.08, 0.08, 0.02), clay('#8d6e63'), g, [0.4, 0.62, -14]); mesh(rbox(20, 0.08, 0.08, 0.02), clay('#8d6e63'), g, [0.4, 0.32, -14]);
    [[-4.2, -3.2], [4.4, -3.3], [-3.6, -3.6]].forEach(([x, z], i) => { mesh(sph(0.3, 16), clay(i % 2 ? '#c0703f' : '#b85c38', 0.7), g, [x, 0.28, z], [1, 0.9, 1]); mesh(cyl(0.14, 0.18, 0.12, 12), clay('#a0522d'), g, [x, 0.58, z]); });
    [[-13, -6, 1.6], [14.5, -10, 1.7], [3.5, -16, 1.8], [-6, -17, 1.9]].forEach(a => roundTree(g, ...a));
    palm(g, 9.6, -1.2, 1.0);
    bushes(g, R, 12, ['#7cb342', '#8bc34a'], -12, 3, [6, 8]);
    flowers(g, R, 80, -9, 4, ['#ff7043', '#ffca28', '#ec407a']);
    mountains(g, [[-26, -55, 12], [22, -58, 15], [0, -64, 18]], '#a3b9cc');
    const cl = clouds(g, R);
    // smoke from a chimney-less hut fire pot
    const smoke = Array.from({ length: 4 }, () => mesh(sph(0.25, 10), new THREE.MeshStandardMaterial({ color: '#eeeeee', transparent: true, opacity: 0.5 }), g, [6.8, 3.2, -6], [1, 1, 1], false));
    return {
      group: g, look: { top: '#6ab8f0', bottom: '#fff1d6', fog: ['#fbefd9', 24, 75], hemi: ['#fffaf0', '#8a7350', 1.25], sun: ['#ffe8c4', 2.5], sunPos: [7, 10, 6], exposure: 1.05 },
      update: t => { cl(t); smoke.forEach((s, i) => { const k = ((t * 0.25 + i / 4) % 1); s.position.set(6.8 + Math.sin(k * 6) * 0.3, 3.3 + k * 3, -6); s.scale.setScalar(0.6 + k * 1.6); s.material.opacity = 0.5 * (1 - k); }); },
    };
  },

  night(scene) {
    const g = new THREE.Group(), R = rng(41); scene.add(g);
    ground(g, '#2f5d3a');
    const path = mesh(new THREE.PlaneGeometry(40, 2.4), clay('#7d6e57', 0.95), g, [0, 0.01, 0.2]); path.rotation.x = -Math.PI / 2; path.castShadow = false;
    hills(g, [[-18, -30, 9, '#22452c'], [14, -34, 11, '#1f4029'], [-4, -42, 13, '#264a30']]);
    [[-5.5, -3.5, 1.4], [6, -4, 1.5], [-9, -7, 1.8], [9.5, -8, 1.9], [-3, -11, 1.6], [3.5, -13, 1.7], [-12, -13, 2.1], [12, -3, 1.4]].forEach((a, i) => roundTree(g, a[0], a[1], a[2], ['#2e6b3a', '#357a42'], '#5d4330'));
    [[-13, -5, 1.4], [13.5, -6, 1.5]].forEach(a => pine(g, ...a, '#24573a'));
    bushes(g, R, 20, ['#2b5e35', '#336b3d']);
    // moon + glow, stars
    const moon = mesh(sph(3.2, 28), new THREE.MeshBasicMaterial({ color: '#fff8dc', fog: false }), g, [16, 26, -70], [1, 1, 1], false);
    const halo = mesh(sph(5.2, 24), new THREE.MeshBasicMaterial({ color: '#fff8dc', transparent: true, opacity: 0.15, fog: false }), g, [16, 26, -71], [1, 1, 1], false);
    const sv = []; for (let i = 0; i < 260; i++) { const a = R() * Math.PI * 2, e = 0.12 + R() * 1.2, r = 150; sv.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, -Math.abs(Math.sin(a) * Math.cos(e) * r)); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 1.4, sizeAttenuation: true, fog: false, transparent: true })); g.add(stars);
    // fireflies
    const flies = Array.from({ length: 22 }, (_, i) => { const m = mesh(sph(0.05, 8), new THREE.MeshBasicMaterial({ color: '#f9ff8a' }), g, [0, 0, 0], [1, 1, 1], false); m.base = [(R() - 0.5) * 18, 0.6 + R() * 2.5, -8 + R() * 10, R() * 6]; return m; });
    const glowM = new THREE.MeshBasicMaterial({ color: '#f9ff8a', transparent: true, opacity: 0.25 });
    flies.forEach(f => mesh(sph(0.16, 8), glowM, f, [0, 0, 0], [1, 1, 1], false));
    flowers(g, R, 80, -10, 4, ['#9fa8da', '#ce93d8', '#ffffff']);
    return {
      group: g, look: { top: '#0d1640', bottom: '#2b3a7a', fog: ['#1b2750', 16, 60], hemi: ['#9fb4ff', '#1d2b1f', 1.0], sun: ['#c9d8ff', 1.5], sunPos: [-5, 10, 6], exposure: 1.15 },
      update: t => {
        stars.material.opacity = 0.75 + Math.sin(t * 2) * 0.2;
        halo.scale.setScalar(1 + Math.sin(t * 1.3) * 0.03);
        flies.forEach((f, i) => { const [x, y, z, p] = f.base; f.position.set(x + Math.sin(t * 0.6 + p) * 1.2, y + Math.sin(t * 0.9 + p * 2) * 0.4, z + Math.cos(t * 0.5 + p) * 0.8); f.visible = Math.sin(t * 2.3 + p * 3) > -0.4; });
      },
    };
  },
};

function capsule2() { return new THREE.CapsuleGeometry(0.05, 0.18, 4, 8); }

// Apply a world's lighting/sky to the shared stage.
export function applyLook(st, look) {
  st.sky.material.uniforms.top.value.set(look.top);
  st.sky.material.uniforms.bottom.value.set(look.bottom);
  st.scene.fog = look.fog ? new THREE.Fog(look.fog[0], look.fog[1], look.fog[2]) : null;
  st.hemi.color.set(look.hemi[0]); st.hemi.groundColor.set(look.hemi[1]); st.hemi.intensity = look.hemi[2];
  st.sun.color.set(look.sun[0]); st.sun.intensity = look.sun[1]; st.sun.position.set(...look.sunPos);
  st.renderer.toneMappingExposure = look.exposure;
}
