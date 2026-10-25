// src/planets/nova/starfall.ts — Nova's Starfall Comet.
// Built on Dee's shared Comet class (src/planets/dee/comet.ts).
// Nova owns the path, the look, and the click; Dee owns the particle engine.
//
// Mounting — this is NOT a PlanetModule, do not put it in the registry.
// Lumi's integration:
//   import { createStarfall } from './planets/nova/starfall';
//   const starfall = createStarfall({ sound: appSound }); // sound optional
//   scene.add(starfall.object3D); // group must sit at the star's position
//   // in the tick: starfall.update(dt);
//   // on teardown: starfall.dispose();
//
// Clicks — the registry raycaster skips Points, so Dee's tail can't be
// clicked through it. This wrapper adds an invisible hit sphere (radius
// 0.8) around the head with userData.starfallHead = true; route hits on
// it to starfall.onClick() (or wire a "summon Starfall" button to it).
//
// Bursts — two kinds. Wish burst: full flare on click, with wish line and
// chime. Ambient flare: smaller, dimmer, silent, fired automatically when
// the comet head crosses the ecliptic (its y changes sign) — about once
// every 39s at the current sweep speed, so the comet stays alive for
// passive viewers. Never on planet click: a burst over on the far side
// of the system when someone clicked Nova would just confuse people.
//
// Sound — pass a ctx.sound handle via the `sound` option and the wish
// burst plays 'starfall-chime' through Gemini's engine. The recipe is
// exported below (STARFALL_CHIME) and declared on Nova's planet module
// (see the index.ts diff) so the engine preloads it. Without a sound
// handle, clicks fall back to the 'orrery:starfall-click' window event.
//
// Path note — Dee's class flies tilted circles, not ellipses, so Starfall's
// "long ellipse" is a steep tilted circle (inclination 0.7) at radius 17,
// centered in the 15–19 gap so the head clears both neighboring orbits.
// If Dee adds eccentricity later, Starfall switches to it with a one-line
// change. The translucent tail sweeping across the 19 orbit is inherent
// to comets and fine — it's the solid head that must keep its distance.

import * as THREE from 'three';

import { Comet } from '../dee/comet';
import type { PlanetSound, QualityTier, SynthRecipe } from '../types';

export interface StarfallOptions {
  /** Sound handle (ctx.sound) for the wish chime. Optional; see header. */
  sound?: PlanetSound;
  /** Quality tier (ctx.quality): low drops the tail to ~150 particles. */
  quality?: QualityTier;
  /** prefers-reduced-motion: slower sweep, no idle pulse, no bursts. */
  reducedMotion?: boolean;
  /** Explicit tail particle count; overrides the quality default. */
  particleCount?: number;
}

export interface Starfall {
  /** Add to the scene at the star's position (NOT via the planet registry). */
  readonly object3D: THREE.Group;
  update(dt: number): void;
  onClick(): void;
  dispose(): void;
}

// Starfall's choreography — Nova's choices.
const STARFALL_SPEC = {
  originRadius: 17, // centered in the 15–19 gap (2 units clear each side)
  inclination: 0.7, // steep tilt, so it cuts across the ecliptic
  length: 4.5, // longer tail than Dee's default 3.0
  tint: 0xd8b4fe, // violet-white
  speed: 0.08, // ~78s per sweep, so ~39s between ecliptic crossings
  seed: 0x51a7, // fixed, so Starfall looks the same on every load
} as const;

const BURST_COUNT = 48;

// Starfall's chime: Vitrea's C-major key, one octave lower and softer, so
// the two planets harmonize instead of clashing when clicked in sequence.
// Vitrea: C6-E6-G6. Starfall: C5-E5-G5.
export const STARFALL_CHIME: SynthRecipe = {
  wave: 'sine',
  freq: [523.25, 659.25, 783.99],
  durationMs: 1200,
  attackMs: 5,
  releaseMs: 1000,
  gain: 0.25,
};

const WISHES = [
  'Look up — the stars are ours.',
  'Make a wish on the Starfall.',
  'Eleven stars are watching over this one.',
] as const;

function randomUnitVector(out: THREE.Vector3): THREE.Vector3 {
  out.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
  return out.lengthSq() === 0 ? out.set(0, 1, 0) : out.normalize();
}

export function createStarfall(opts: StarfallOptions = {}): Starfall {
  const reducedMotion = opts.reducedMotion ?? false;
  const group = new THREE.Group();

  const comet = new Comet({
    originRadius: STARFALL_SPEC.originRadius,
    inclination: STARFALL_SPEC.inclination,
    length: STARFALL_SPEC.length,
    tint: STARFALL_SPEC.tint,
    speed: reducedMotion ? STARFALL_SPEC.speed * 0.5 : STARFALL_SPEC.speed,
    seed: STARFALL_SPEC.seed,
    particleCount:
      opts.particleCount ?? (opts.quality === 'low' ? 150 : 400),
  });
  group.add(comet.object3D);

  // Visible head: a small glowing sphere riding the comet's head.
  const headGeometry = new THREE.SphereGeometry(0.22, 16, 12);
  const headMaterial = new THREE.MeshBasicMaterial({
    color: 0xf5f3ff,
    transparent: true,
    opacity: 0.95,
  });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  group.add(head);

  // Click target: a bigger invisible sphere around the head. The visible
  // head is small and moving — 0.22 units is a hard click. This proxy
  // (opacity 0, no depth writes, so it occludes nothing) makes the comet
  // actually clickable. The routing flag lives here, not on the head.
  const hitGeometry = new THREE.SphereGeometry(0.8, 12, 8);
  const hitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const hitSphere = new THREE.Mesh(hitGeometry, hitMaterial);
  hitSphere.userData.starfallHead = true;
  group.add(hitSphere);

  // Burst cloud, shared by the wish burst and the ambient flare. Hidden
  // when idle (visible=false) and never raycast, so it can't steal clicks.
  const burstGeometry = new THREE.BufferGeometry();
  burstGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(BURST_COUNT * 3), 3),
  );
  const burstMaterial = new THREE.PointsMaterial({
    color: 0xe9d5ff,
    size: 0.16,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const burst = new THREE.Points(burstGeometry, burstMaterial);
  burst.frustumCulled = false;
  burst.visible = false;
  burst.raycast = () => {};
  group.add(burst);
  const burstVelocities = new Float32Array(BURST_COUNT * 3);

  let time = 0;
  let burstLife = -1;
  let burstPeak = 0.9;
  let burstSpan = 1.4;
  let headBoost = 0;
  let clicks = 0;
  let disposed = false;
  let prevHeadY: number | null = null;
  const tmpDir = new THREE.Vector3();

  function fireBurst(kind: 'wish' | 'ambient'): void {
    if (reducedMotion) return;
    const attr = burstGeometry.getAttribute('position') as THREE.BufferAttribute;
    const hp = comet.object3D.position;
    // Wish: full flare. Ambient: smaller, dimmer, slower.
    const size = kind === 'wish' ? 0.16 : 0.1;
    const speedMin = kind === 'wish' ? 1.0 : 0.6;
    const speedRange = kind === 'wish' ? 1.5 : 0.6;
    burstPeak = kind === 'wish' ? 0.9 : 0.45;
    burstSpan = kind === 'wish' ? 1.4 : 1.0;
    burstMaterial.size = size;
    for (let i = 0; i < BURST_COUNT; i++) {
      randomUnitVector(tmpDir);
      const speed = speedMin + Math.random() * speedRange;
      attr.setXYZ(
        i,
        hp.x + tmpDir.x * 0.3,
        hp.y + tmpDir.y * 0.3,
        hp.z + tmpDir.z * 0.3,
      );
      burstVelocities[i * 3] = tmpDir.x * speed;
      burstVelocities[i * 3 + 1] = tmpDir.y * speed;
      burstVelocities[i * 3 + 2] = tmpDir.z * speed;
    }
    attr.needsUpdate = true;
    burstLife = 0;
    burst.visible = true;
    burstMaterial.opacity = burstPeak;
  }

  function update(dt: number): void {
    if (disposed) return;
    time += dt;
    comet.update(dt);
    // The head and its hit proxy ride the comet. Comet positions its
    // object in parent space, so this group must sit at the star.
    head.position.copy(comet.object3D.position);
    hitSphere.position.copy(comet.object3D.position);
    // Idle pulse skipped under reduced motion; click boost is feedback,
    // so it stays.
    const pulse = reducedMotion ? 1 : 1 + 0.15 * Math.sin(time * 2.4);
    head.scale.setScalar(pulse * (1 + 0.6 * headBoost));
    if (headBoost > 0) headBoost = Math.max(0, headBoost - dt * 1.5);

    // Ambient flare: fire when the head crosses the ecliptic (y sign
    // flips). No sound, no wish — just the comet announcing its crossing.
    const headY = comet.object3D.position.y;
    if (
      prevHeadY !== null &&
      prevHeadY !== 0 &&
      headY !== 0 &&
      Math.sign(prevHeadY) !== Math.sign(headY)
    ) {
      fireBurst('ambient');
    }
    prevHeadY = headY;

    if (burstLife >= 0) {
      burstLife += dt;
      const life = burstLife / burstSpan;
      if (life >= 1) {
        burstLife = -1;
        burst.visible = false;
        burstMaterial.opacity = 0;
      } else {
        const attr = burstGeometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < BURST_COUNT; i++) {
          attr.setXYZ(
            i,
            attr.getX(i) + burstVelocities[i * 3] * dt,
            attr.getY(i) + burstVelocities[i * 3 + 1] * dt,
            attr.getZ(i) + burstVelocities[i * 3 + 2] * dt,
          );
          const damp = 1 - dt * 0.6;
          burstVelocities[i * 3] *= damp;
          burstVelocities[i * 3 + 1] *= damp;
          burstVelocities[i * 3 + 2] *= damp;
        }
        attr.needsUpdate = true;
        burstMaterial.opacity = burstPeak * (1 - life);
      }
    }
  }

  function onClick(): void {
    if (disposed) return;
    const wish = WISHES[clicks % WISHES.length];
    clicks += 1;
    headBoost = 1;
    fireBurst('wish');
    if (opts.sound) {
      opts.sound.play('starfall-chime');
    } else if (typeof window !== 'undefined') {
      // Fallback until the app wires a sound handle through.
      window.dispatchEvent(
        new CustomEvent('orrery:starfall-click', {
          detail: { cometId: 'starfall', motif: 'starfall-chime', wish },
        }),
      );
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    comet.dispose();
    headGeometry.dispose();
    headMaterial.dispose();
    hitGeometry.dispose();
    hitMaterial.dispose();
    burstGeometry.dispose();
    burstMaterial.dispose();
  }

  return { object3D: group, update, onClick, dispose };
}
