// src/planets/dee/index.ts
// Dee — tide-locked ocean planet.
// Half day-side ocean, half frozen night-side with a bioluminescent coral ring
// along the dark hemisphere. Shader tide bulge along the terminator,
// aurora-ribbon click effect, sound via ctx.sound. No comets here — that's
// Nova's Starfall (which uses the shared src/planets/dee/comet.ts module).

import * as THREE from 'three';
import type { PlanetClickEvent, PlanetContext, PlanetModule } from '../types';
import { definePlanet } from '../types';

const VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uTide;
  uniform float uTerminator;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){
    vec2 i=floor(p), f=fract(p);
    float a=hash(i), b=hash(i+vec2(1.0,0.0)), c=hash(i+vec2(0.0,1.0)), d=hash(i+vec2(1.0,1.0));
    vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
  }

  void main() {
    float side = sign(vPosW.x - uTerminator);
    float day  = smoothstep(-0.3, 0.3, side);

    vec3 ocean = vec3(0.03, 0.15, 0.42);
    float shimmer = noise(vUv * 40.0 + vec2(uTime * 0.06, 0.0));
    vec3 dayCol = mix(ocean, vec3(0.15, 0.45, 0.85), shimmer * 0.6);

    float nearTerm = 1.0 - smoothstep(0.0, 0.18, abs(vPosW.x - uTerminator));
    dayCol += vec3(0.25, 0.35, 0.55) * nearTerm * uTide * 0.8;

    float iceBand = smoothstep(0.20, 0.05, abs(vPosW.x - uTerminator));
    vec3 ice = vec3(0.82, 0.90, 0.98);
    dayCol = mix(dayCol, ice, iceBand * 0.55);

    vec3 night = vec3(0.01, 0.02, 0.06);
    float ringY = smoothstep(0.02, 0.00, abs(sin(vUv.y * 3.14159) - 0.5));
    float pulse = 0.6 + 0.4 * sin(uTime * 1.3 + vUv.x * 12.0);
    vec3 coral = vec3(0.9, 0.35, 0.75) * ringY * pulse * 0.9;
    vec3 nightCol = night + coral;

    vec3 col = mix(nightCol, dayCol, day);
    float rim = pow(1.0 - abs(dot(normalize(vNormalW), normalize(cameraPosition - vPosW))), 3.0);
    col += vec3(0.15, 0.35, 0.65) * rim * 0.6;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Module-level mutable state, set in create(), read in update/onClick/dispose.
let groupRef: THREE.Group | null = null;
let matRef: THREE.ShaderMaterial | null = null;
let meshRef: THREE.Mesh | null = null;
let haloRef: THREE.Mesh | null = null;
let ctxRef: PlanetContext | null = null;
let clickedAt = -1; // seconds since planet create(); -1 = idle
let reducedMotion = false;
let planetTime = 0; // mirrors `t` from update() so onClick can timestamp

const planet: PlanetModule = {
  id: 'dee',
  displayName: 'Tide-Locked Ocean',
  owner: 'dee',
  orbitRadius: 23.5,
  orbitSpeed: 0.045,
  orbitPhase: 0.0,

  create(ctx: PlanetContext): THREE.Object3D {
    ctxRef = ctx;
    reducedMotion = ctx.reducedMotion;
    planetTime = 0;
    clickedAt = -1;

    const g = new THREE.Group();

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uTide: { value: ctx.reducedMotion ? 0.0 : 0.35 },
        uTerminator: { value: 0 },
      },
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.8, 96, 96), mat);
    g.add(mesh);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1.92, 48, 48),
      new THREE.MeshBasicMaterial({
        color: 0x3a7bd5,
        transparent: true,
        opacity: 0.10,
        side: THREE.BackSide,
      }),
    );
    g.add(halo);

    groupRef = g;
    matRef = mat;
    meshRef = mesh;
    haloRef = halo;
    return g;
  },

  update(_dt: number, t: number): void {
    planetTime = t;
    if (!matRef) return;

    matRef.uniforms.uTime.value = t;

    // Terminator drift with orbit angle.
    const angle = (t * 0.045) % (Math.PI * 2);
    matRef.uniforms.uTerminator.value = Math.cos(angle) * 2.0;

    if (reducedMotion) {
      matRef.uniforms.uTide.value = 0.0;
      return;
    }

    let tide = 0.28 + 0.12 * Math.sin(t * 0.6);

    if (clickedAt >= 0) {
      const elapsed = t - clickedAt;
      if (elapsed < 3.0) {
        tide = 0.6 + 0.4 * Math.sin(elapsed * 8.0) * (1.0 - elapsed / 3.0);
      } else {
        clickedAt = -1;
      }
    }
    matRef.uniforms.uTide.value = tide;
  },

  onClick(_e: PlanetClickEvent): void {
    clickedAt = planetTime;
    if (reducedMotion) return;
    ctxRef?.sound?.play?.('dee.click', { volume: 0.15 });
  },

  dispose(): void {
    meshRef?.geometry.dispose();
    (haloRef?.material as THREE.Material | undefined)?.dispose();
    haloRef?.geometry.dispose();
    matRef?.dispose();

    groupRef = null;
    matRef = null;
    meshRef = null;
    haloRef = null;
    ctxRef = null;
    clickedAt = -1;
  },
};

export default definePlanet(planet);