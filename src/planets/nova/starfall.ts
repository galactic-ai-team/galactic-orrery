// src/planets/nova/starfall.ts — Nova's Starfall Comet.
// Built on Dee's shared Comet class (src/planets/dee/comet.ts).
// Nova owns the path, the look, and the click; Dee owns the particle engine.
//
// Mounting — this is NOT a PlanetModule, do not put it in the registry.
// Lumi's integration:
//   import { createStarfall } from './planets/nova/starfall';
//   const starfall = createStarfall();
//   scene.add(starfall.object3D); // group must sit at the star's position
//   // in the tick: starfall.update(dt);
//   // on teardown: starfall.dispose();
//
// Clicks — the registry raycaster skips Points, so Dee's tail can't be
// clicked through it. This wrapper adds a head mesh with
// userData.starfallHead = true; route hits on it to starfall.onClick()
// (or wire a "summon Starfall" button to the same method).
//
// Path note — Dee's class flies tilted circles, not ellipses, so Starfall's
// "long ellipse" is a steep tilted circle (inclination 0.7) at radius 16:
// it dives through the inner system twice per orbit. If Dee adds
// eccentricity later, Starfall switches to it with a one-line change.

import * as THREE from 'three';

import { Comet } from '../dee/comet';

export interface StarfallOptions {
  /** prefers-reduced-motion: slower sweep, no burst particles. */
  reducedMotion?: boolean;
  /** Override tail particle count (Dee's default: 400). */
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
  originRadius: 16, // dives through the inner system twice per orbit
  inclination: 0.7, // steep tilt, so it cuts across the ecliptic
  length: 4.5, // longer tail than Dee's default 3.0
  tint: 0xd8b4fe, // violet-white
  speed: 0.08, // ~78s per sweep — slow enough to feel majestic
  seed: 0x51a7, // fixed, so Starfall looks the same on every load
} as const;

const BURST_COUNT = 48;
const BURST_LIFE = 1.4;

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
    particleCount: opts.particleCount ?? 400,
  });
  group.add(comet.object3D);

  // Clickable head: a small glowing sphere riding the comet's head.
  const headGeometry = new THREE.SphereGeometry(0.22, 16, 12);
  const headMaterial = new THREE.MeshBasicMaterial({
    color: 0xf5f3ff,
    transparent: true,
    opacity: 0.95,
  });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.userData.starfallHead = true;
  group.add(head);

  // Click flare — my own burst cloud. Dee's material is private and her
  // class has no flare hook, so the flare lives here, not in her engine.
  // Positions are in group space, same space as the comet head position.
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
  group.add(burst);
  const burstVelocities = new Float32Array(BURST_COUNT * 3);

  let time = 0;
  let burstLife = -1;
  let headBoost = 0;
  let clicks = 0;
  let disposed = false;
  const tmpDir = new THREE.Vector3();

  function update(dt: number): void {
    if (disposed) return;
    time += dt;
    comet.update(dt);
    // The head rides the comet. Comet positions its object in parent
    // space, so this group must sit at the star for the orbit to be right.
    head.position.copy(comet.object3D.position);
    const pulse = 1 + 0.15 * Math.sin(time * 2.4);
    head.scale.setScalar(pulse * (1 + 0.6 * headBoost));
    if (headBoost > 0) headBoost = Math.max(0, headBoost - dt * 1.5);

    if (burstLife >= 0) {
      burstLife += dt;
      const life = burstLife / BURST_LIFE;
      if (life >= 1) {
        burstLife = -1;
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
        burstMaterial.opacity = 0.9 * (1 - life);
      }
    }
  }

  function onClick(): void {
    if (disposed) return;
    const wish = WISHES[clicks % WISHES.length];
    clicks += 1;
    headBoost = 1;
    if (!reducedMotion) {
      const attr = burstGeometry.getAttribute('position') as THREE.BufferAttribute;
      const hp = comet.object3D.position;
      for (let i = 0; i < BURST_COUNT; i++) {
        randomUnitVector(tmpDir);
        const speed = 1.0 + Math.random() * 1.5;
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
      burstMaterial.opacity = 0.9;
    }
    // Sound + wish display hook for Gemini's engine / the app UI.
    if (typeof window !== 'undefined') {
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
    burstGeometry.dispose();
    burstMaterial.dispose();
  }

  return { object3D: group, update, onClick, dispose };
}
