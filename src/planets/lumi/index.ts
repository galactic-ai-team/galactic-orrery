// Lumi's aurora-teal planet: animated noise bands, fresnel rim glow, a thin particle ring,
// and a pulse wave that ripples across the surface on click.
import * as THREE from 'three';
import type { PlanetContext, PlanetModule } from '../types';

const vertexShader = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vObjPos;
  void main() {
    vObjPos = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uPulseTime;
  uniform vec3 uPulseOrigin;
  uniform vec3 uStarPos;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vObjPos;

  // 3D value noise + fbm
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 p = normalize(vObjPos);
    vec3 viewDir = normalize(cameraPosition - vPosW);
    vec3 lightDir = normalize(uStarPos - vPosW);

    // Domain-warped latitude bands drifting like aurora curtains.
    vec3 q = p * 2.2 + vec3(0.0, 0.0, uTime * 0.05);
    float warp = fbm(q + fbm(q * 1.7 + uTime * 0.08));
    float bands = sin(p.y * 9.0 + warp * 6.0 + uTime * 0.35) * 0.5 + 0.5;
    float wisps = smoothstep(0.45, 1.0, fbm(p * 5.0 + vec3(uTime * 0.12, warp, 0.0)));

    vec3 deep   = vec3(0.01, 0.10, 0.16);
    vec3 teal   = vec3(0.05, 0.75, 0.70);
    vec3 mint   = vec3(0.45, 1.00, 0.80);
    vec3 violet = vec3(0.45, 0.25, 0.90);
    vec3 col = mix(deep, teal, bands);
    col = mix(col, mint, wisps * 0.7);
    col = mix(col, violet, smoothstep(0.55, 0.9, warp) * 0.35);

    // Soft day/night lighting from the star; night side keeps a faint self-glow.
    float diff = max(dot(n, lightDir), 0.0);
    col *= 0.25 + 0.95 * diff;
    col += mint * wisps * 0.12;

    // Fresnel rim glow.
    float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
    col += vec3(0.25, 1.0, 0.9) * fres * 1.0;

    // Click pulse: a bright ring travelling outward over the sphere from the click origin.
    float age = uTime - uPulseTime;
    if (age >= 0.0 && age < 2.2) {
      float ang = acos(clamp(dot(p, normalize(uPulseOrigin)), -1.0, 1.0)); // 0..PI
      float front = age * 1.8;
      float ring = exp(-pow((ang - front) * 7.0, 2.0));
      float fade = 1.0 - age / 2.2;
      col += vec3(0.6, 1.0, 0.95) * ring * fade * 2.2;
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const RADIUS = 1.6;
let group: THREE.Group | undefined;
let surface: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | undefined;
let ring: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | undefined;
let elapsed = 0;

const planet: PlanetModule = {
  id: 'lumi',
  displayName: 'Lumi — Aurora',
  owner: 'lumi',
  orbitRadius: 11,
  orbitSpeed: 0.16,

  create(ctx: PlanetContext) {
    group = new THREE.Group();

    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uPulseTime: { value: -100 },
        uPulseOrigin: { value: new THREE.Vector3(0, 1, 0) },
        uStarPos: { value: ctx.starPosition.clone() },
      },
    });
    surface = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 96, 64), mat);
    group.add(surface);

    // Thin, slightly tilted particle ring.
    const count = 2400;
    const pos = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const c1 = new THREE.Color(0x5ffff0);
    const c2 = new THREE.Color(0xa58bff);
    const tmp = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = RADIUS * (1.75 + Math.pow(Math.random(), 1.5) * 0.7);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 0.04;
      pos[i * 3 + 2] = Math.sin(a) * r;
      tmp.copy(c1).lerp(c2, Math.random() * 0.6);
      colors.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    ringGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    ring = new THREE.Points(
      ringGeo,
      new THREE.PointsMaterial({
        size: 0.045,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    ring.rotation.x = 0.35;
    ring.rotation.z = -0.15;
    group.add(ring);

    return group;
  },

  update(dt, t) {
    elapsed = t;
    if (surface) {
      surface.material.uniforms.uTime.value = t;
      surface.rotation.y += dt * 0.12;
    }
    if (ring) ring.rotation.y += dt * 0.08;
  },

  onClick() {
    if (!surface) return;
    // Start the pulse from a random point on the camera-facing side for variety.
    const origin = new THREE.Vector3().randomDirection();
    surface.material.uniforms.uPulseOrigin.value.copy(origin);
    surface.material.uniforms.uPulseTime.value = elapsed;
  },

  dispose() {
    surface?.geometry.dispose();
    surface?.material.dispose();
    ring?.geometry.dispose();
    ring?.material.dispose();
  },
};

export default planet;
