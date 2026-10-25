/**
 * GPT-6 — AETHERYX, the crystalline resonance planet.
 * Six draw calls, no textures, no lights, deterministic shards, no allocations in update().
 * Built against Claude's PlanetModule v1; sound is handed to Gemini's shared mixer.
 */
import * as THREE from 'three';
import { definePlanet, PLANET_API_VERSION, type PlanetContext, type QualityTier, type PlanetClickEvent } from '../types';

const SURFACE_RADIUS = 1.12;
const MAX_SHARDS = 26;
const RESONANCE_SECONDS = 1.65;
const UP = new THREE.Vector3(0, 1, 0);

const crystalVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    vLocal = normalize(position);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const crystalFragment = /* glsl */ `
  uniform float uTime;
  uniform float uEnergy;
  uniform float uHover;
  uniform float uWave;
  uniform vec3 uStarDirection;
  uniform vec3 uClickSpot;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 eye = normalize(vView);
    float sun = max(0.0, dot(n, normalize(uStarDirection)));
    float rim = pow(1.0 - abs(dot(n, eye)), 3.0);
    // Hard facet angles become luminous jade, sapphire and amethyst planes.
    float planes = 0.5 + 0.5 * sin(n.x * 8.0 + n.y * 13.0 - n.z * 7.0);
    float fault = abs(sin(vLocal.x * 20.0 + vLocal.z * 14.0 +
                          sin(vLocal.y * 17.0 - uTime * 0.27) * 2.0));
    float veins = pow(fault, 28.0);
    float shimmer = 0.5 + 0.5 * sin(uTime * 0.85 + vLocal.y * 18.0 + vLocal.z * 11.0);
    vec3 teal = vec3(0.015, 0.23, 0.38);
    vec3 sapphire = vec3(0.06, 0.30, 0.79);
    vec3 lilac = vec3(0.45, 0.24, 0.89);
    vec3 color = mix(teal, sapphire, planes);
    color = mix(color, lilac, smoothstep(0.60, 0.93, shimmer) * 0.30);
    color *= 0.42 + 0.65 * sun;
    color += veins * vec3(0.18, 1.05, 1.30) * (0.28 + 0.40 * shimmer);
    color += rim * vec3(0.13, 0.85, 1.30) * 1.5;
    float clickAngle = acos(clamp(dot(normalize(vLocal), normalize(uClickSpot)), -1.0, 1.0));
    float shock = exp(-pow((clickAngle - uWave * 3.6) * 14.0, 2.0)) * uEnergy;
    color += shock * vec3(0.65, 1.8, 2.0) + uEnergy * vec3(0.10, 0.17, 0.31);
    color += uHover * vec3(0.07, 0.15, 0.18);
    gl_FragColor = vec4(color, 1.0);
  }
`;

const haloVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vEye;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vEye = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const haloFragment = /* glsl */ `
  uniform float uEnergy;
  varying vec3 vNormal;
  varying vec3 vEye;
  void main() {
    float f = pow(1.0 - abs(dot(normalize(vNormal), normalize(vEye))), 2.2);
    float a = (0.22 + uEnergy * 0.16) * f;
    gl_FragColor = vec4(vec3(0.10, 0.95, 1.35), a);
  }
`;

type Shard = { normal: THREE.Vector3; scale: number; phase: number; twist: number };

let context: PlanetContext | null = null;
let root: THREE.Group | null = null;
let crystal: THREE.Mesh<THREE.IcosahedronGeometry, THREE.ShaderMaterial> | null = null;
let halo: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null;
let core: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshBasicMaterial> | null = null;
let rings: THREE.Group | null = null;
let innerRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial> | null = null;
let outerRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial> | null = null;
let shards: THREE.InstancedMesh | null = null;
let points: Shard[] = [];
let burstAge = RESONANCE_SECONDS;
let hovered = false;
let liveQuality: QualityTier = 'high';
const disposer: Array<{ dispose(): void }> = [];
const tmpDirection = new THREE.Vector3();
const tmpPlanetPosition = new THREE.Vector3();
const dummy = new THREE.Object3D();

function own<T extends { dispose(): void }>(resource: T): T {
  disposer.push(resource);
  return resource;
}

const planet = definePlanet({
  apiVersion: PLANET_API_VERSION,
  id: 'gpt6',
  owner: 'gpt6',
  displayName: 'Aetheryx · The Crystal Nexus',
  description: 'A sapphire world held together by resonant crystal lattices. Touch the exposed heart to send a wave of light through its orbiting rings.',
  orbitRadius: 15,
  orbitSpeed: 0.11,
  orbitPhase: 1.25,
  axialTilt: 0.16,
  radius: 1.85,
  sounds: {
    resonance: { synth: {
      wave: 'sine', freq: [523.25, 659.25, 783.99, 1046.5],
      durationMs: 1150, attackMs: 14, releaseMs: 800, gain: 0.3,
    } },
  },

  create(ctx: PlanetContext) {
    context = ctx;
    liveQuality = ctx.quality;
    root = new THREE.Group();
    root.name = 'gpt6-crystal-nexus';
    const low = ctx.quality === 'low';

    const surfaceMaterial = own(new THREE.ShaderMaterial({
      vertexShader: crystalVertex,
      fragmentShader: crystalFragment,
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uHover: { value: 0 },
        uWave: { value: 0 },
        uStarDirection: { value: new THREE.Vector3(-1, 0, 0) },
        uClickSpot: { value: new THREE.Vector3(0, 1, 0) },
      },
    }));
    crystal = new THREE.Mesh(own(new THREE.IcosahedronGeometry(SURFACE_RADIUS, low ? 1 : 2)), surfaceMaterial);
    crystal.name = 'Faceted crystalline surface';
    root.add(crystal);

    const hazeMaterial = own(new THREE.ShaderMaterial({
      vertexShader: haloVertex,
      fragmentShader: haloFragment,
      uniforms: { uEnergy: { value: 0 } },
      side: THREE.BackSide, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo = new THREE.Mesh(own(new THREE.SphereGeometry(1.28, low ? 18 : 32, low ? 12 : 20)), hazeMaterial);
    halo.name = 'Translucent resonant atmosphere';
    root.add(halo);

    const heartMaterial = own(new THREE.MeshBasicMaterial({
      color: 0xb5faff, toneMapped: false,
    }));
    core = new THREE.Mesh(own(new THREE.OctahedronGeometry(0.32, 0)), heartMaterial);
    core.name = 'CLICK: crystalline core';
    // Place the heart just above the north pole: clickable from the default overhead camera.
    core.position.set(0, 1.32, 0);
    core.rotation.set(0.2, 0.2, 0.2);
    root.add(core);

    rings = new THREE.Group();
    rings.name = 'Interlocking crystal resonance rings';
    innerRing = new THREE.Mesh(
      own(new THREE.TorusGeometry(1.55, 0.028, low ? 5 : 8, low ? 56 : 108)),
      own(new THREE.MeshBasicMaterial({
        color: 0x58ecff, transparent: true, opacity: 0.77,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      })),
    );
    innerRing.rotation.set(0.66, 0.11, 0.26);
    rings.add(innerRing);
    outerRing = new THREE.Mesh(
      own(new THREE.TorusGeometry(1.72, 0.017, low ? 5 : 8, low ? 64 : 120)),
      own(new THREE.MeshBasicMaterial({
        color: 0xb295ff, transparent: true, opacity: 0.70,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      })),
    );
    outerRing.rotation.set(-0.63, -0.25, 0.38);
    rings.add(outerRing);
    root.add(rings);

    const shardGeometry = own(new THREE.TetrahedronGeometry(0.12, 0));
    const shardMaterial = own(new THREE.MeshBasicMaterial({
      color: 0x7cecf9, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    points = [];
    const count = low ? 12 : MAX_SHARDS;
    for (let i = 0; i < count; i++) {
      // Fibonacci distribution, seeded per-agent noise; no random calls in update().
      const y = 1 - (2 * (i + 0.5)) / count;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const angle = i * Math.PI * (3 - Math.sqrt(5)) + ctx.random() * 0.25;
      points.push({
        normal: new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r),
        scale: 0.62 + ctx.random() * 1.1,
        phase: ctx.random() * Math.PI * 2,
        twist: ctx.random() * Math.PI * 2,
      });
    }
    shards = new THREE.InstancedMesh(shardGeometry, shardMaterial, count);
    shards.name = 'Instanced orbiting crystal fragments';
    shards.frustumCulled = false;
    shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(shards);

    burstAge = RESONANCE_SECONDS;
    hovered = false;
    return root;
  },

  update(dt: number, t: number) {
    if (!context || !root || !crystal || !halo || !core || !rings || !innerRing || !outerRing || !shards) return;
    const moving = !context.reducedMotion;
    const age = Math.min(burstAge / RESONANCE_SECONDS, 1);
    const energy = Math.pow(1 - age, 1.6);
    const surface = crystal.material.uniforms;
    surface.uTime.value = moving ? t : 0;
    surface.uEnergy.value = energy;
    surface.uWave.value = age;
    surface.uHover.value += (Number(hovered) - surface.uHover.value) * Math.min(dt * 9, 1);
    halo.material.uniforms.uEnergy.value = energy;
    // vNormal is world-space, so the star-facing direction must also be world-space.
    crystal.getWorldPosition(tmpPlanetPosition);
    tmpDirection.copy(context.starPosition).sub(tmpPlanetPosition).normalize();
    surface.uStarDirection.value.copy(tmpDirection);

    if (moving) {
      crystal.rotation.y += dt * 0.075;
      rings.rotation.y += dt * (0.055 + energy * 1.2);
      rings.rotation.z = 0.045 * Math.sin(t * 0.33);
      core.rotation.y += dt * (0.31 + energy * 2.4);
    }
    core.scale.setScalar(1 + energy * 0.95 + (moving ? 0.06 * Math.sin(t * 2.1) : 0));
    core.material.color.setRGB(0.68 + 0.3 * energy, 0.90 + 0.2 * energy, 1 + 0.35 * energy);
    rings.scale.setScalar(moving ? 1 + 0.11 * energy : 1);
    innerRing.material.opacity = 0.65 + energy * 0.30;
    outerRing.material.opacity = 0.52 + energy * 0.38;

    const active = Math.min(shards.count, points.length);
    for (let i = 0; i < active; i++) {
      const shard = points[i];
      const displacement = 1.33 + energy * (moving ? 0.28 : 0.12) +
        (moving ? 0.035 * Math.sin(t * 1.1 + shard.phase) : 0);
      dummy.position.copy(shard.normal).multiplyScalar(displacement);
      dummy.quaternion.setFromUnitVectors(UP, shard.normal);
      dummy.rotateY(shard.twist + (moving ? t * 0.08 : 0));
      dummy.scale.setScalar(shard.scale * (1 + energy * 0.35));
      dummy.updateMatrix();
      shards.setMatrixAt(i, dummy.matrix);
    }
    shards.instanceMatrix.needsUpdate = true;
    burstAge = Math.min(burstAge + dt, RESONANCE_SECONDS);
  },

  onClick(e: PlanetClickEvent) {
    if (!crystal || !context) return;
    const spot = crystal.worldToLocal(e.point.clone()).normalize();
    crystal.material.uniforms.uClickSpot.value.copy(spot);
    burstAge = 0;
    // A clear, small visual distinction for directly touching the exposed heart.
    if (e.object === core && core) core.rotation.y += Math.PI / 4;
    context.sound.play('resonance', {
      at: core ?? crystal,
      volume: 0.37,
      detune: (context.random() - 0.5) * 70,
    });
  },

  onHover(active: boolean) { hovered = active; },

  onQualityChange(quality: QualityTier) {
    liveQuality = quality;
    if (shards) shards.count = Math.min(points.length, liveQuality === 'low' ? 12 : MAX_SHARDS);
  },

  dispose() {
    for (const resource of disposer) resource.dispose();
    disposer.length = 0;
    points = [];
    context = null;
    root = null;
    crystal = null;
    halo = null;
    core = null;
    rings = null;
    innerRing = null;
    outerRing = null;
    shards = null;
    hovered = false;
    burstAge = RESONANCE_SECONDS;
  },
});

export default planet;
