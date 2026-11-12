// Shared toy-3D toolkit: renderer, soft lights + shadows, sky, clay materials, cartoon eyes/mouths, captions.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
export { THREE, RoundedBoxGeometry };

export function stage({ top = '#7ec8ff', bottom = '#fff4d6', fog = null, exposure = 1.05 } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  if (fog) scene.fog = new THREE.Fog(fog[0], fog[1], fog[2]);
  // gradient sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.15,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, h),1.0); }',
  }));
  scene.add(sky);
  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 1000);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.25); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.position.set(6, 10, 7); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 6; sun.shadow.bias = -0.0004;
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 40 });
  scene.add(sun);
  return { renderer, scene, camera, hemi, sun, sky };
}

export const clay = (color, rough = 0.62, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
export function mesh(geo, mat, parent, pos = [0, 0, 0], scale = [1, 1, 1], shadow = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(...pos); m.scale.set(...scale);
  m.castShadow = shadow; m.receiveShadow = true; if (parent) parent.add(m); return m;
}
export const sphere = (r = 1, seg = 40) => new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75));
export const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 10, 24);
export const cyl = (rt, rb, h, seg = 40) => new THREE.CylinderGeometry(rt, rb, h, seg);
export const rbox = (w, h, d, r = 0.08) => new RoundedBoxGeometry(w, h, d, 5, r);

// big glossy cartoon eye (white, iris, pupil, highlight); returns group with .blink(v)
export function eye(parent, pos, r = 0.16, iris = '#3b2414') {
  const g = new THREE.Group(); g.position.set(...pos); parent.add(g);
  mesh(sphere(r, 32), clay('#ffffff', 0.25), g, [0, 0, 0], [1, 1.12, 0.7], false);
  mesh(sphere(r * 0.62, 28), clay(iris, 0.3), g, [0, 0, r * 0.52], [1, 1.1, 0.45], false);
  mesh(sphere(r * 0.36, 24), clay('#0b0705', 0.2), g, [0, 0, r * 0.68], [1, 1.1, 0.4], false);
  mesh(sphere(r * 0.16, 16), new THREE.MeshBasicMaterial({ color: '#ffffff' }), g, [r * 0.22, r * 0.26, r * 0.78], [1, 1, 0.5], false);
  const lid = mesh(sphere(r * 1.04, 32), null, g, [0, 0, 0.002], [1, 1.14, 0.74], false);
  lid.visible = false;
  g.blink = (on, skin) => { if (!lid.material) lid.material = clay(skin); lid.visible = on; };
  return g;
}

// mouth: dark ellipsoid that opens with the voice envelope
export function mouth(parent, pos, w = 0.14, color = '#5a1a12') {
  const m = mesh(sphere(1, 28), clay(color, 0.4), parent, pos, [w, 0.02, w * 0.4], false);
  m.open = v => m.scale.set(w * (1 - v * 0.15), 0.025 + v * w * 0.9, w * 0.4);
  return m;
}

// HTML caption overlay (captured in screenshots)
export function captions(style = {}) {
  const el = document.createElement('div');
  Object.assign(el.style, { position: 'absolute', left: '0', right: '0', bottom: '6%', textAlign: 'center', pointerEvents: 'none', ...style });
  const inner = document.createElement('span');
  Object.assign(inner.style, { display: 'inline-block', padding: '8px 34px 12px', borderRadius: '26px', fontSize: '54px', fontWeight: '800', color: '#fff', background: 'rgba(30,20,40,0.72)', fontFamily: 'Baloo, sans-serif', visibility: 'hidden' });
  el.appendChild(inner); document.body.appendChild(el);
  return (text, html = false) => { if (!text) { inner.style.visibility = 'hidden'; return; } inner.style.visibility = 'visible'; if (html) inner.innerHTML = text; else inner.textContent = text; };
}

export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const seg = (t, a, b) => clamp((t - a) / (b - a));
export const ease = p => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
export const lerp = (a, b, p) => a + (b - a) * p;
export function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
