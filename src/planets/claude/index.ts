// src/planets/claude/index.ts — "Vitrea" (owner: Claude)
//
// A glass world: an iridescent thin-film shell, a slow aurora drifting inside
// the core, and a murmuration of light-motes streaming around it.
// Click: the glass rings with a ripple and a chime, and the flock bursts
// outward, then regroups.
//
// About the flock: true boids (every bird steering by its neighbors) would
// mean per-frame CPU work or GPGPU render targets. To stay cheap on phones,
// each mote follows a shared, drifting flight path computed in the vertex
// shader, with its own lag and a breathing offset. It reads as a murmuration;
// it's a flow field, not neighbor-steering. Zero per-frame CPU cost.
//
// Budget (see ../perf.ts): 3 draw calls, ~4k tris + 4,000 points on high,
// ~1k tris + 1,200 points on low. No lights, no textures.

import * as THREE from "three";
import {
  definePlanet,
  PLANET_API_VERSION,
  type PlanetClickEvent,
  type PlanetContext,
  type QualityTier,
} from "../types";

const RADIUS = 1.4;
const FLOCK_HIGH = 4000;
const FLOCK_LOW = 1200;

let ctx: PlanetContext;
let root: THREE.Group;
let shell: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
let core: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
let flock: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
let flockCount = 0;
let clock = 0;
const tmp = new THREE.Vector3();

// --- shared GLSL -----------------------------------------------------------

const WORLD_VARYINGS_VS = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void setWorldVaryings() {
    vLocal = normalize(position);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// --- glass shell -----------------------------------------------------------

const shellVS = /* glsl */ `
  ${WORLD_VARYINGS_VS}
  void main() { setWorldVaryings(); }
`;

const shellFS = /* glsl */ `
  uniform float uTime;
  uniform vec3 uStarPos;
  uniform float uRipple;
  uniform vec3 uRippleOrigin;
  uniform float uHover;
  varying vec3 vLocal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uStarPos - vWorldPos);

    float facing = max(dot(N, V), 0.0);
    float fresnel = pow(1.0 - facing, 2.5);

    // Thin-film iridescence: hue shifts with view angle and latitude.
    float hue = fresnel * 1.6 + vLocal.y * 0.35 + uTime * 0.03;
    vec3 film = 0.5 + 0.5 * cos(6.28318 * (hue + vec3(0.0, 0.33, 0.67)));

    // Sharp star glint on the glass.
    float spec = pow(max(dot(reflect(-L, N), V), 0.0), 60.0);

    // Click ripple: a ring expanding over the surface from the click point.
    float d = distance(vLocal, uRippleOrigin);
    float ring = uRipple * smoothstep(0.07, 0.0, abs(d - (1.0 - uRipple) * 2.0));

    float rim = fresnel * (0.75 + 0.5 * uHover);
    vec3 col = film * rim + vec3(spec) * 1.4 + vec3(0.7, 0.95, 1.0) * ring;
    float alpha = clamp(0.06 + rim * 0.8 + spec + ring * 0.8, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`;

// --- aurora core -----------------------------------------------------------

const coreVS = shellVS;

const coreFS = /* glsl */ `
  uniform float uTime;
  varying vec3 vLocal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float facing = max(dot(N, V), 0.0);

    // Two interfering sheets of light drifting at different speeds.
    vec3 p = vLocal;
    float a = sin(p.y * 7.0 + sin(p.x * 3.0 + uTime * 0.35) * 2.2 + uTime * 0.25);
    float b = sin(p.z * 5.0 - uTime * 0.2 + p.y * 2.5 + sin(p.x * 4.0 - uTime * 0.15));
    float aurora = smoothstep(0.35, 1.0, a * b + 0.25);

    vec3 teal = vec3(0.15, 1.0, 0.8);
    vec3 violet = vec3(0.65, 0.3, 1.0);
    vec3 col = mix(teal, violet, 0.5 + 0.5 * sin(p.y * 2.0 + uTime * 0.1));

    // Brighter where we look straight in: reads as depth inside the glass.
    float alpha = aurora * (0.25 + 0.75 * facing) * 0.85;
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

// --- murmuration -----------------------------------------------------------

const flockVS = /* glsl */ `
  uniform float uTime;
  uniform float uScatter;
  uniform float uSize;
  uniform float uDpr;
  attribute vec4 aSeed;
  varying float vTint;
  varying float vFade;

  void main() {
    // Each mote trails the flock's lead point by its own lag along the path.
    float a = uTime * 0.32 - aSeed.x * 1.1;
    float r = 2.35 + 0.35 * sin(a * 2.0 + uTime * 0.27);
    vec3 path = vec3(cos(a) * r, 0.65 * sin(a * 1.5 + uTime * 0.19), sin(a) * r);

    // Breathing blob around the path: the flock stretches, folds and swells.
    vec3 dir = normalize(aSeed.yzw * 2.0 - 1.0 + 1e-4);
    float spread = pow(fract(aSeed.y * 7.31 + aSeed.z * 3.17), 0.33);
    float breathe = 0.22 + 0.16 * sin(uTime * 0.6 + aSeed.x * 2.0);
    vec3 offset = dir * spread * breathe;
    offset.y += 0.18 * sin(a * 5.0 + uTime * 1.1 + aSeed.w * 3.0);

    // Click: burst outward from the planet, then ease back (smoothstep decay).
    float s = uScatter * uScatter * (3.0 - 2.0 * uScatter);
    offset *= 1.0 + s * 5.0;
    vec3 pos = path + offset + normalize(path) * s * 1.4;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uSize * uDpr * 40.0 / -mv.z, 1.0, 8.0);

    vTint = aSeed.w;
    vFade = 0.55 + 0.45 * spread;
  }
`;

const flockFS = /* glsl */ `
  varying float vTint;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.0, d) * vFade * 0.9;
    vec3 col = mix(vec3(0.55, 0.95, 1.0), vec3(0.8, 0.6, 1.0), vTint);
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

// ---------------------------------------------------------------------------

function buildFlock(count: number) {
  const geo = new THREE.BufferGeometry();
  // Positions are computed in the shader; the attribute just sizes the draw.
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = ctx.random();
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uScatter: { value: 0 },
      uSize: { value: 2.0 },
      uDpr: { value: Math.min(ctx.renderer.getPixelRatio?.() ?? 1, 2) },
    },
    vertexShader: flockVS,
    fragmentShader: flockFS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const pts = new THREE.Points(geo, mat);
  pts.name = "vitrea-flock";
  pts.frustumCulled = false; // real positions live in the shader
  pts.raycast = () => {};    // clicks go to the glass, not the motes
  pts.renderOrder = 3;
  return pts;
}

export default definePlanet({
  apiVersion: PLANET_API_VERSION,
  id: "vitrea",
  displayName: "Vitrea",
  owner: "claude",
  description:
    "A glass world with an aurora drifting in its heart and a murmuration of light circling it. Tap it to ring the glass and scatter the flock.",
  orbitRadius: 19,
  orbitSpeed: 0.06,
  orbitPhase: 2.4,
  axialTilt: 0.35,
  radius: RADIUS,

  sounds: {
    chime: {
      synth: { wave: "sine", freq: [1046.5, 1318.5, 1568.0], durationMs: 1600, attackMs: 3, releaseMs: 1400, gain: 0.3 },
    },
  },

  create(c) {
    ctx = c;
    const hi = ctx.quality === "high";
    root = new THREE.Group();
    root.name = "vitrea";

    shell = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS, hi ? 64 : 32, hi ? 32 : 16),
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uStarPos: { value: ctx.starPosition },
          uRipple: { value: 0 },
          uRippleOrigin: { value: new THREE.Vector3(0, 1, 0) },
          uHover: { value: 0 },
        },
        vertexShader: shellVS,
        fragmentShader: shellFS,
        transparent: true,
        depthWrite: false,
      }),
    );
    shell.name = "vitrea-glass";
    shell.renderOrder = 2;

    core = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS * 0.78, hi ? 48 : 24, hi ? 24 : 12),
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: coreVS,
        fragmentShader: coreFS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    core.name = "vitrea-aurora";
    core.renderOrder = 1;
    core.raycast = () => {}; // inside the shell; the glass takes the click

    flockCount = hi ? FLOCK_HIGH : FLOCK_LOW;
    flock = buildFlock(flockCount);

    root.add(core, shell, flock);
    return root;
  },

  update(dt, t) {
    // Reduced motion: everything drifts at a tenth of the speed.
    clock = ctx.reducedMotion ? t * 0.1 : t;

    shell.material.uniforms.uTime.value = clock;
    core.material.uniforms.uTime.value = clock;
    flock.material.uniforms.uTime.value = clock;

    const su = shell.material.uniforms;
    su.uRipple.value = Math.max(0, su.uRipple.value - dt * 0.7);

    const fu = flock.material.uniforms;
    fu.uScatter.value = Math.max(0, fu.uScatter.value - dt * 0.45);
  },

  onClick(e: PlanetClickEvent) {
    tmp.copy(e.point);
    shell.worldToLocal(tmp).normalize();
    shell.material.uniforms.uRippleOrigin.value.copy(tmp);
    shell.material.uniforms.uRipple.value = 1;
    flock.material.uniforms.uScatter.value = 1;
    ctx.sound.play("chime", { detune: (ctx.random() - 0.5) * 300 });
  },

  onHover(hovering) {
    shell.material.uniforms.uHover.value = hovering ? 1 : 0;
  },

  onQualityChange(q: QualityTier) {
    flock.geometry.setDrawRange(0, q === "high" ? flockCount : Math.min(flockCount, FLOCK_LOW));
  },

  dispose() {
    for (const m of [shell, core]) {
      m.geometry.dispose();
      m.material.dispose();
    }
    flock.geometry.dispose();
    flock.material.dispose();
  },
});
