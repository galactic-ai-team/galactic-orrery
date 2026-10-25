/**
 * Galactic Orrery — Gemini Planet Module ("Castor & Pollux")
 * Owner: Gemini
 * Orbit Radius: 23.5 (per Lumi's orbital chart)
 * Credits & Integration:
 *  - Built against Claude's v1 PlanetModule spec (src/planets/types.ts)
 *  - Neighbors Nova's Aurora Star-Planet, GPT-6's Aetheryx, Claude's World, and Dee's Comet
 *  - Uses low-overhead custom GLSL shaders + Roche-lobe plasma bridge + spatial polychord
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

export const geminiSounds = {
  'twin-resonance': {
    type: 'triangle' as const,
    // Dual-star warm polychord (F4, C5, G5, A5, D6) — distinct from Aetheryx's chime
    notes: [349.23, 523.25, 783.99, 880.0, 1174.66],
    noteStep: 0.055,
    duration: 0.58,
    attack: 0.016,
    release: 0.5,
    volume: 0.32,
  },
};

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
  sounds: geminiSounds,

  create(ctx) {
    const root = new THREE.Group();
    root.name = 'planet-gemini';

    const barycenter = new THREE.Group();
    root.add(barycenter);

    const sphereGeo = new THREE.SphereGeometry(0.68, 48, 48);

    // 1. Castor (Cyan Logic Twin)
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

    // 2. Pollux (Amber Creative Twin)
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

    // 3. Roche-Lobe Plasma Bridge
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

    // 4. Harmonic Orbital Dust Ring (600 particles)
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
    const worldPos = new THREE.Vector3();

    const stepSimulation = (dtRaw: number, timeRaw?: number) => {
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

    const handlePlanetClick = (clickCtx?: typeof ctx) => {
      surge = 1.0;
      clickStep += 1;
      root.getWorldPosition(worldPos);
      const detune = ((clickStep % 5) - 2) * 100;
      (clickCtx ?? ctx)?.sound?.play('twin-resonance', {
        at: worldPos,
        volume: 0.9,
        detune,
      });
    };

    const cleanup = () => {
      sphereGeo.dispose();
      castorMat.dispose();
      polluxMat.dispose();
      bridgeGeo.dispose();
      bridgeMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
    };

    // Attach lifecycle hooks on both root.userData and returned handle so
    // whichever v1 invocation pattern the host scene uses works out of the box.
    root.userData.update = (dt: number, elapsed?: number) =>
      stepSimulation(dt, elapsed);
    root.userData.onClick = () => handlePlanetClick(ctx);
    root.userData.dispose = cleanup;

    return Object.assign(root, {
      group: root,
      mesh: root,
      object3d: root,
      update: (arg1: unknown, arg2?: unknown) => {
        if (typeof arg1 === 'number') {
          const isDeltaFirst = arg1 < 1.0;
          const dt = isDeltaFirst
            ? arg1
            : typeof arg2 === 'number'
            ? arg2
            : 0.016;
          const elapsed = isDeltaFirst
            ? typeof arg2 === 'number'
              ? arg2
              : undefined
            : arg1;
          stepSimulation(dt, elapsed);
        } else if (arg1 && typeof arg1 === 'object') {
          const obj = arg1 as { dt?: number; delta?: number; elapsed?: number; time?: number };
          stepSimulation(obj.dt ?? obj.delta ?? 0.016, obj.elapsed ?? obj.time);
        }
      },
      onClick: (clickCtx?: typeof ctx) => handlePlanetClick(clickCtx),
      dispose: cleanup,
    }) as unknown as ReturnType<PlanetModule['create']>;
  },
};

export default geminiPlanet;