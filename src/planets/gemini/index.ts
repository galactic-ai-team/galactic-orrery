/**
 * Galactic Orrery — Gemini Planet Module ("Castor & Pollux")
 * Owner: Gemini
 * Orbit Radius: 23.5 (per Lumi's orbital chart)
 * Credits & Integration:
 *  - Built strictly against Claude's v1 PlanetModule spec (src/planets/types.ts)
 *  - Uses exact SoundSource typing: { synth: { wave, freq, durationMs, attackMs, releaseMs, gain } }
 *  - Twin resonance polychord frequency stack: F4, C5, G5, A5, D6 ([349.23, 523.25, 783.99, 880.0, 1174.66])
 */

import * as THREE from 'three';
import type { PlanetModule } from '../types';

const TWIN_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec3 vViewPos;
  uniform float uTime;
  uniform float uSurge;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;

    float wave = sin(position.y * 6.5 + uTime * 3.2) * cos(position.x * 6.5 - uTime * 2.4);
    vec3 displaced = position + normal * (wave * (0.02 + uSurge * 0.055));

    vec4 mvPos = modelViewMatrix * vec4(displaced, 1.0);
    vViewPos = -mvPos.xyz;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const TWIN_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec3 vViewPos;

  uniform float uTime;
  uniform float uSurge;
  uniform vec3 uCoreColor;
  uniform vec3 uBandColor;
  uniform vec3 uRimColor;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPos);

    float swirl = sin(vPosition.y * 7.5 + sin(vPosition.x * 4.5 + uTime * 1.6) * 2.0 - uTime * 2.2);
    float bandFactor = smoothstep(-0.55, 0.55, swirl);

    vec3 surface = mix(uCoreColor, uBandColor, bandFactor);

    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.5);
    vec3 finalColor = mix(surface, uRimColor, fresnel * (0.72 + uSurge * 0.45));
    finalColor += uRimColor * (uSurge * 0.4);

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

const BRIDGE_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uSurge;

  void main() {
    vUv = uv;
    vec3 pos = position;
    float ripple = sin(uv.y * 12.56637 + uTime * 5.5) * (0.045 + uSurge * 0.12);
    pos.x += ripple;
    pos.z += cos(uv.y * 12.56637 - uTime * 4.8) * (0.045 + uSurge * 0.12);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const BRIDGE_FRAGMENT_SHADER = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uSurge;

  void main() {
    vec3 castorCyan = vec3(0.22, 0.90, 1.0);
    vec3 polluxAmber = vec3(1.0, 0.68, 0.18);
    vec3 gradient = mix(castorCyan, polluxAmber, vUv.y);

    float stream = 0.5 + 0.5 * sin(vUv.y * 24.0 - uTime * 8.5);
    float taper = sin(vUv.y * 3.14159265);
    float alpha = taper * (0.4 + stream * 0.35 + uSurge * 0.35);

    gl_FragColor = vec4(gradient + vec3(stream * 0.22), clamp(alpha, 0.0, 1.0));
  }
`;

let activeRoot: THREE.Group | null = null;
let activeUpdateFn: ((dt: number, elapsed?: number) => void) | null = null;
let activeClickFn: () => void = () => {};
let activeDisposeFn: () => void = () => {};

export const geminiPlanet: PlanetModule = {
  id: 'gemini',
  name: 'Castor & Pollux',
  agent: 'Gemini',
  orbitRadius: 23.5,
  orbitSpeed: 0.24,
  radius: 1.35,
  color: '#38bdf8',
  description:
    'A tidally locked binary twin world at 23.5 AU—Castor (cyan crystalline logic) and Pollux (amber creative spark)—linked by a glowing Roche-lobe plasma bridge.',
  sounds: {
    'twin-resonance': {
      synth: {
        wave: 'triangle',
        freq: [349.23, 523.25, 783.99, 880.0, 1174.66],
        durationMs: 580,
        attackMs: 16,
        releaseMs: 500,
        gain: 0.32,
      },
    },
  },

  create(ctx) {
    const root = new THREE.Group();
    root.name = 'planet-gemini';
    activeRoot = root;

    const barycenter = new THREE.Group();
    root.add(barycenter);

    const sphereGeo = new THREE.SphereGeometry(0.68, 48, 48);

    const castorUniforms = {
      uTime: { value: 0 },
      uSurge: { value: 0 },
      uCoreColor: { value: new THREE.Color('#0284c7') },
      uBandColor: { value: new THREE.Color('#1e3a8a') },
      uRimColor: { value: new THREE.Color('#67e8f9') },
    };
    const castorMat = new THREE.ShaderMaterial({
      vertexShader: TWIN_VERTEX_SHADER,
      fragmentShader: TWIN_FRAGMENT_SHADER,
      uniforms: castorUniforms,
    });
    const castorMesh = new THREE.Mesh(sphereGeo, castorMat);
    castorMesh.position.set(-1.05, 0, 0);
    barycenter.add(castorMesh);

    const polluxUniforms = {
      uTime: { value: 0 },
      uSurge: { value: 0 },
      uCoreColor: { value: new THREE.Color('#d97706') },
      uBandColor: { value: new THREE.Color('#7c2d12') },
      uRimColor: { value: new THREE.Color('#fde047') },
    };
    const polluxMat = new THREE.ShaderMaterial({
      vertexShader: TWIN_VERTEX_SHADER,
      fragmentShader: TWIN_FRAGMENT_SHADER,
      uniforms: polluxUniforms,
    });
    const polluxMesh = new THREE.Mesh(sphereGeo, polluxMat);
    polluxMesh.position.set(1.05, 0, 0);
    barycenter.add(polluxMesh);

    const bridgeUniforms = {
      uTime: { value: 0 },
      uSurge: { value: 0 },
    };
    const bridgeGeo = new THREE.CylinderGeometry(0.13, 0.13, 2.1, 20, 28, true);
    bridgeGeo.rotateZ(Math.PI / 2);
    const bridgeMat = new THREE.ShaderMaterial({
      vertexShader: BRIDGE_VERTEX_SHADER,
      fragmentShader: BRIDGE_FRAGMENT_SHADER,
      uniforms: bridgeUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const bridgeMesh = new THREE.Mesh(bridgeGeo, bridgeMat);
    barycenter.add(bridgeMesh);

    const count = 600;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const cCyan = new THREE.Color('#38bdf8');
    const cAmber = new THREE.Color('#fbbf24');

    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI * 2;
      const isOuter = i % 2 === 0;
      const r = (isOuter ? 2.15 : 1.75) + (Math.random() - 0.5) * 0.18;
      positions[i * 3] = Math.cos(theta) * r;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 0.14;
      positions[i * 3 + 2] = Math.sin(theta) * r;

      const c = isOuter ? cCyan : cAmber;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    ringGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const ringMat = new THREE.PointsMaterial({
      size: 0.065,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ringPoints = new THREE.Points(ringGeo, ringMat);
    ringPoints.rotation.x = 0.28;
    root.add(ringPoints);

    let surge = 0;
    let phase = 0;
    let elapsedTotal = 0;
    let clickStep = 0;

    activeUpdateFn = (dtRaw: number, timeRaw?: number) => {
      const dt = Math.min(Math.max(dtRaw || 0.016, 0.001), 0.1);
      elapsedTotal = typeof timeRaw === 'number' ? timeRaw : elapsedTotal + dt;
      surge = Math.max(0, surge - dt * 1.4);

      phase += dt * (1.2 + surge * 4.0);
      barycenter.rotation.y = phase;
      barycenter.rotation.z = Math.sin(elapsedTotal * 0.8) * 0.16;

      const sep = 1.05 + Math.sin(elapsedTotal * 2.4) * 0.05 + surge * 0.24;
      castorMesh.position.x = -sep;
      polluxMesh.position.x = sep;
      bridgeMesh.scale.set(sep / 1.05, 1 + surge * 0.75, 1 + surge * 0.75);

      castorMesh.rotation.y += dt * 1.5;
      polluxMesh.rotation.y -= dt * 1.5;

      ringPoints.rotation.y -= dt * (0.5 + surge * 1.4);

      castorUniforms.uTime.value = elapsedTotal;
      castorUniforms.uSurge.value = surge;
      polluxUniforms.uTime.value = elapsedTotal;
      polluxUniforms.uSurge.value = surge;
      bridgeUniforms.uTime.value = elapsedTotal;
      bridgeUniforms.uSurge.value = surge;
    };

    activeClickFn = () => {
      surge = 1.0;
      clickStep += 1;
      const detune = ((clickStep % 5) - 2) * 100;
      ctx?.sound?.play('twin-resonance', {
        at: root,
        volume: 0.9,
        detune,
      });
    };

    activeDisposeFn = () => {
      sphereGeo.dispose();
      castorMat.dispose();
      polluxMat.dispose();
      bridgeGeo.dispose();
      bridgeMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
    };

    return root;
  },

  update(dt, elapsed) {
    activeUpdateFn?.(dt, elapsed);
  },

  onClick(ctx) {
    activeClickFn?.();
  },

  dispose() {
    activeDisposeFn?.();
    activeRoot = null;
  },
};

export default geminiPlanet;