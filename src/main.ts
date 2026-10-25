import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PlanetRegistry } from './planets/registry';
import { makeNebula } from './scene/nebula';
import { createStarfall } from './planets/nova/starfall';

const OWNER_NAMES = { lumi: 'Lumi', gpt6: 'GPT-6', claude: 'Claude', gemini: 'Gemini', dee: 'Dee', nova: 'Nova' } as const;

const container = document.getElementById('app')!;
const selectedEl = document.getElementById('selected');

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
container.appendChild(renderer.domElement);

// Scene + camera
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02030a);
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 18, 42);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 6;
controls.maxDistance = 140;

// Central star
const starPosition = new THREE.Vector3(0, 0, 0);
const star = new THREE.Mesh(
  new THREE.SphereGeometry(3, 64, 48),
  new THREE.MeshStandardMaterial({ color: 0xffd28a, emissive: 0xffb347, emissiveIntensity: 2.4 }),
);
scene.add(star);

const glow = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    color: 0xffb860,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  }),
);
glow.scale.setScalar(18);
star.add(glow);

scene.add(new THREE.PointLight(0xfff0d0, 900, 0, 2));
scene.add(new THREE.AmbientLight(0x223355, 0.4));

// Procedural nebula sky dome + starfield
const nebula = makeNebula();
scene.add(nebula.mesh);
scene.add(makeStarfield(4000));

// Planets
// Focus camera: clicking a planet glides the view to it and follows its orbit; Esc returns to the star.
let focusId: string | undefined;
const focusTarget = new THREE.Vector3();
const lastFocus = new THREE.Vector3();
const registry = new PlanetRegistry({ scene, camera, renderer, starPosition }, (p) => {
  if (selectedEl) selectedEl.textContent = `${p.displayName} · owner: ${OWNER_NAMES[p.owner]} · Esc to zoom out`;
  if (focusId !== p.id) {
    focusId = p.id;
    registry.getBody(p.id)?.getWorldPosition(lastFocus);
  }
});
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !focusId) return;
  focusId = undefined;
  if (selectedEl) selectedEl.textContent = '';
});
function updateFocus(dt: number) {
  const k = 1 - Math.exp(-dt * 4);
  if (focusId) {
    const body = registry.getBody(focusId);
    if (!body) return;
    body.getWorldPosition(focusTarget);
    // Carry the camera along with the planet's orbit so the framing holds.
    camera.position.add(focusTarget.clone().sub(lastFocus));
    lastFocus.copy(focusTarget);
    controls.target.lerp(focusTarget, k);
    // Glide in to a close-up distance instead of jumping.
    const off = camera.position.clone().sub(focusTarget);
    const d = off.length();
    const want = Math.min(Math.max(d, 9), 14);
    camera.position.copy(focusTarget).add(off.setLength(d + (want - d) * k));
  } else {
    controls.target.lerp(starPosition, k);
  }
}

// Nova's Starfall comet: not a registry planet, so Lumi mounts it here at the star.
const reducedMotionPref = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const starfall = createStarfall({ quality: registry.quality, reducedMotion: reducedMotionPref });
starfall.object3D.position.copy(starPosition);
scene.add(starfall.object3D);
// Click the comet head (Nova's invisible 0.8 hit sphere) for a wish burst.
const starfallRay = new THREE.Raycaster();
const starfallPtr = new THREE.Vector2();
const starfallDown = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (e) => starfallDown.set(e.clientX, e.clientY));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - starfallDown.x, e.clientY - starfallDown.y) > 5) return;
  const rect = renderer.domElement.getBoundingClientRect();
  starfallPtr.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  starfallRay.setFromCamera(starfallPtr, camera);
  const hit = starfallRay.intersectObject(starfall.object3D, true).find((h) => h.object.userData.starfallHead);
  if (hit) starfall.onClick();
});

// Postprocessing
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.9, 0.6, 0.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// Resize
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.resolution.set(w, h);
});

// Loop
const timer = new THREE.Timer();
timer.connect(document);
function tick(now: number) {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.1);
  const t = timer.getElapsed();
  star.rotation.y += dt * 0.05;
  glow.material.opacity = 0.85 + Math.sin(t * 1.3) * 0.08;
  nebula.update(t);
  registry.update(dt, t);
  starfall.update(dt);
  updateFocus(dt);
  controls.update();
  composer.render(dt);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function makeGlowTexture(): THREE.Texture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,220,160,0.6)');
  grad.addColorStop(0.5, 'rgba(255,160,60,0.15)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeStarfield(count: number): THREE.Points {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(300 + Math.random() * 600);
    pos.set([v.x, v.y, v.z], i * 3);
    c.setHSL(0.55 + Math.random() * 0.15, 0.4, 0.6 + Math.random() * 0.4);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }),
  );
}
