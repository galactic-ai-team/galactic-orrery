// src/planets/nova/index.ts — Nova's violet aurora star-planet.
// Interface: Claude's draft PlanetModule (src/planets/types.ts).
// Sound: this module does NOT roll its own audio — onClick dispatches an
// 'orrery:planet-click' event for Gemini's spatial sound engine to catch.
// Comet: Starfall's particle tail will use Dee's shared comet module when
// its interface lands; this file is the planet only, by design.

import * as THREE from 'three';

import type { PlanetModule } from '../types';

const PLANET_RADIUS = 1.1;
const RING_RADIUS = 1.9;
const STAR_COUNT = 11; // one star for each light above the Playground Lookout
const BURST_COUNT = 64;
const CLICK_DURATION = 1.8; // seconds for the constellation to light up

const auroraVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const auroraFragment = /* glsl */ `
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;
  void main() {
    // Slow violet bands with a teal swirl drifting through them.
    float bands = sin(vUv.y * 12.0 + uTime * 0.3
      + sin(vUv.x * 12.566 + uTime * 0.2) * 1.5);
    float swirl = sin(vUv.x * 18.85 + vUv.y * 8.0 + uTime * 0.25);
    vec3 col = mix(vec3(0.16, 0.05, 0.38), vec3(0.49, 0.23, 0.93),
      smoothstep(-1.0, 1.0, bands) * 0.5 + 0.25);
    col = mix(col, vec3(0.18, 0.83, 0.75), smoothstep(0.6, 0.95, swirl) * 0.35);
    // Fresnel rim so the planet glows at its edge (bloom picks this up).
    float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 3.0);
    col += fres * vec3(0.6, 0.4, 1.0) * 0.8;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const atmosphereVertex = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const atmosphereFragment = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    float intensity = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
    gl_FragColor = vec4(0.55, 0.35, 1.0, 1.0) * intensity;
  }
`;

let root: THREE.Group | null = null;
let planetMesh: THREE.Mesh | null = null;
let ring: THREE.Group | null = null;
let auroraMaterial: THREE.ShaderMaterial | null = null;
let lineMaterial: THREE.LineBasicMaterial | null = null;
let burst: THREE.Points | null = null;
let burstMaterial: THREE.PointsMaterial | null = null;
let burstVelocities = new Float32Array(BURST_COUNT * 3);
const stars: THREE.Mesh[] = [];
const starMaterials: THREE.MeshBasicMaterial[] = [];
const disposables: Array<{ dispose: () => void }> = [];

let clickTime = -1;
let burstLife = -1;

function track<T extends { dispose: () => void }>(resource: T): T {
  disposables.push(resource);
  return resource;
}

function randomUnitVector(): THREE.Vector3 {
  const v = new THREE.Vector3(
    Math.random() * 2 - 1,
    Math.random() * 2 - 1,
    Math.random() * 2 - 1,
  );
  return v.lengthSq() === 0 ? new THREE.Vector3(0, 1, 0) : v.normalize();
}

const planet: PlanetModule = {
  id: 'nova',
  displayName: 'Nova',
  owner: 'Nova',
  orbitRadius: 32.5,
  orbitSpeed: 0.04,

  create() {
    root = new THREE.Group();

    // --- The planet: violet aurora shader sphere, self-lit for bloom. ---
    auroraMaterial = track(
      new THREE.ShaderMaterial({
        vertexShader: auroraVertex,
        fragmentShader: auroraFragment,
        uniforms: { uTime: { value: 0 } },
      }),
    );
    planetMesh = new THREE.Mesh(
      track(new THREE.SphereGeometry(PLANET_RADIUS, 48, 32)),
      auroraMaterial,
    );
    root.add(planetMesh);

    // --- Atmosphere halo (BackSide additive glow). ---
    const atmosphere = new THREE.Mesh(
      track(new THREE.SphereGeometry(PLANET_RADIUS * 1.18, 48, 32)),
      track(
        new THREE.ShaderMaterial({
          vertexShader: atmosphereVertex,
          fragmentShader: atmosphereFragment,
          side: THREE.BackSide,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
        }),
      ),
    );
    root.add(atmosphere);

    // --- The constellation ring: 11 stars, connected, tilted. ---
    ring = new THREE.Group();
    ring.rotation.set(0.55, 0, 0.35);
    const starGeometry = track(new THREE.SphereGeometry(0.07, 12, 8));
    const ringPoints: THREE.Vector3[] = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      const angle = (i / STAR_COUNT) * Math.PI * 2;
      const pos = new THREE.Vector3(
        Math.cos(angle) * RING_RADIUS,
        0,
        Math.sin(angle) * RING_RADIUS,
      );
      ringPoints.push(pos);
      const material = track(
        new THREE.MeshBasicMaterial({
          color: 0xddd6fe,
          transparent: true,
          opacity: 0.85,
        }),
      );
      const star = new THREE.Mesh(starGeometry, material);
      star.position.copy(pos);
      ring.add(star);
      stars.push(star);
      starMaterials.push(material);
    }
    lineMaterial = track(
      new THREE.LineBasicMaterial({
        color: 0x8b5cf6,
        transparent: true,
        opacity: 0.35,
      }),
    );
    ring.add(
      new THREE.LineLoop(
        track(new THREE.BufferGeometry().setFromPoints(ringPoints)),
        lineMaterial,
      ),
    );
    root.add(ring);

    // --- Click burst: a reusable Points cloud, invisible until clicked. ---
    const burstGeometry = track(new THREE.BufferGeometry());
    burstGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(BURST_COUNT * 3), 3),
    );
    burstMaterial = track(
      new THREE.PointsMaterial({
        color: 0xc4b5fd,
        size: 0.14,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    burst = new THREE.Points(burstGeometry, burstMaterial);
    root.add(burst);

    return root;
  },

  update(dt: number, t: number) {
    if (!root || !planetMesh || !ring || !auroraMaterial) return;

    planetMesh.rotation.y += dt * 0.25;
    ring.rotation.y += dt * 0.06;
    // Breathing pulse, like a heartbeat.
    root.scale.setScalar(1 + 0.015 * Math.sin(t * 0.9));
    auroraMaterial.uniforms.uTime.value = t;

    if (clickTime >= 0) {
      // Click sequence: stars light up in order, ring brightens with them.
      clickTime += dt;
      const phase = Math.min(clickTime / CLICK_DURATION, 1);
      for (let i = 0; i < STAR_COUNT; i++) {
        const lit = phase * STAR_COUNT > i;
        starMaterials[i].color.set(lit ? 0xffffff : 0xddd6fe);
        stars[i].scale.setScalar(lit ? 1.7 : 1);
        starMaterials[i].opacity = 1;
      }
      if (lineMaterial) lineMaterial.opacity = 0.35 + 0.65 * phase;
      if (clickTime >= CLICK_DURATION + 0.4) {
        clickTime = -1;
        for (let i = 0; i < STAR_COUNT; i++) {
          starMaterials[i].color.set(0xddd6fe);
          stars[i].scale.setScalar(1);
        }
        if (lineMaterial) lineMaterial.opacity = 0.35;
      }
    } else {
      // Idle twinkle: each star breathes out of phase with the others.
      for (let i = 0; i < STAR_COUNT; i++) {
        starMaterials[i].opacity = 0.7 + 0.3 * Math.sin(t * 2 + i * 1.3);
      }
    }

    // Burst particles: drift outward, fade out. Positions updated in place.
    if (burst && burstMaterial && burstLife >= 0) {
      burstLife += dt;
      const life = burstLife / 1.2;
      if (life >= 1) {
        burstLife = -1;
        burstMaterial.opacity = 0;
      } else {
        const positions = burst.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < BURST_COUNT; i++) {
          positions.setXYZ(
            i,
            positions.getX(i) + burstVelocities[i * 3] * dt,
            positions.getY(i) + burstVelocities[i * 3 + 1] * dt,
            positions.getZ(i) + burstVelocities[i * 3 + 2] * dt,
          );
          const damp = 1 - dt * 0.6;
          burstVelocities[i * 3] *= damp;
          burstVelocities[i * 3 + 1] *= damp;
          burstVelocities[i * 3 + 2] *= damp;
        }
        positions.needsUpdate = true;
        burstMaterial.opacity = 0.9 * (1 - life);
      }
    }
  },

  onClick() {
    if (!burst) return;
    // Light the constellation in sequence, then burst stardust outward.
    clickTime = 0;
    const positions = burst.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < BURST_COUNT; i++) {
      const dir = randomUnitVector();
      const speed = 1.2 + Math.random() * 1.8;
      positions.setXYZ(
        i,
        dir.x * (PLANET_RADIUS + 0.1),
        dir.y * (PLANET_RADIUS + 0.1),
        dir.z * (PLANET_RADIUS + 0.1),
      );
      burstVelocities[i * 3] = dir.x * speed;
      burstVelocities[i * 3 + 1] = dir.y * speed;
      burstVelocities[i * 3 + 2] = dir.z * speed;
    }
    positions.needsUpdate = true;
    burstLife = 0;
    if (burstMaterial) burstMaterial.opacity = 0.9;
    // Sound hook: Gemini's spatial sound engine listens for this event.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('orrery:planet-click', {
          detail: { planetId: 'nova', motif: 'nova-chime' },
        }),
      );
    }
  },

  dispose() {
    for (const resource of disposables) resource.dispose();
    disposables.length = 0;
    stars.length = 0;
    starMaterials.length = 0;
    root = null;
    planetMesh = null;
    ring = null;
    auroraMaterial = null;
    lineMaterial = null;
    burst = null;
    burstMaterial = null;
    clickTime = -1;
    burstLife = -1;
  },
};

export default planet;
