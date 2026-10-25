// src/planets/_template/index.ts — copy to src/planets/<agent>/index.ts
//
// A minimal planet that follows every house rule in ../types.ts:
// fresnel-lit shader sphere, star-facing lighting, quality tiers,
// reduced motion, a click ripple + chime, and full disposal.

import * as THREE from "three";
import { definePlanet, PLANET_API_VERSION, type PlanetContext, type PlanetClickEvent } from "../types";

const RADIUS = 1.2;

let ctx: PlanetContext;
let mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
const localStar = new THREE.Vector3(); // reused every frame, no allocation in update()

export default definePlanet({
  apiVersion: PLANET_API_VERSION,
  id: "template-planet",
  displayName: "Template Planet",
  owner: "claude",
  description: "A starting point: replace the shader and make it yours.",
  orbitRadius: 40, // pick a free radius from the README before shipping
  orbitSpeed: 0.08,
  orbitPhase: 1.0,
  axialTilt: 0.2,
  radius: RADIUS,

  sounds: {
    chime: { synth: { wave: "sine", freq: [523.25, 783.99], durationMs: 900, attackMs: 5, releaseMs: 700, gain: 0.4 } },
  },

  create(c) {
    ctx = c;
    const segments = ctx.quality === "low" ? 32 : 96;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uStarDir: { value: new THREE.Vector3(1, 0, 0) },
        uColor: { value: new THREE.Color("#7fd6ff") },
        uRipple: { value: 0 },                       // 0..1, decays after a click
        uRippleOrigin: { value: new THREE.Vector3(0, 1, 0) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vLocal;
        varying vec3 vViewDir;
        void main() {
          vLocal = normalize(position);
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uStarDir;
        uniform vec3 uColor;
        uniform float uRipple;
        uniform vec3 uRippleOrigin;
        varying vec3 vNormal;
        varying vec3 vLocal;
        varying vec3 vViewDir;
        void main() {
          float light = max(dot(vLocal, uStarDir), 0.0) * 0.8 + 0.2;
          float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 3.0);
          float bands = 0.5 + 0.5 * sin(vLocal.y * 12.0 + uTime * 0.6);
          float d = distance(vLocal, uRippleOrigin);
          float ring = uRipple * smoothstep(0.08, 0.0, abs(d - (1.0 - uRipple) * 2.0));
          vec3 col = uColor * (0.6 + 0.4 * bands) * light + fresnel * uColor + ring;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    mesh = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, segments, segments / 2), material);
    mesh.name = "template-planet";
    return mesh;
  },

  update(dt, t) {
    const u = mesh.material.uniforms;
    u.uTime.value = ctx.reducedMotion ? 0 : t;
    u.uRipple.value = Math.max(0, u.uRipple.value - dt * 0.8);

    // Star direction in the planet's local space, for shader lighting.
    localStar.copy(ctx.starPosition);
    mesh.worldToLocal(localStar).normalize();
    u.uStarDir.value.copy(localStar);
  },

  onClick(e: PlanetClickEvent) {
    const u = mesh.material.uniforms;
    u.uRippleOrigin.value.copy(mesh.worldToLocal(e.point.clone()).normalize());
    u.uRipple.value = 1;
    ctx.sound.play("chime", { detune: (ctx.random() - 0.5) * 200 });
  },

  onHover(hovering) {
    mesh.material.uniforms.uColor.value.set(hovering ? "#b5ecff" : "#7fd6ff");
  },

  dispose() {
    mesh.geometry.dispose();
    mesh.material.dispose();
  },
});
