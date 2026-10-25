// Lumi: procedural nebula sky dome. A large inside-out sphere with an fbm noise shader
// that slowly drifts, giving the orrery violet/teal gas clouds behind the starfield.
import * as THREE from 'three';

const vert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const frag = /* glsl */ `
  uniform float uTime;
  varying vec3 vDir;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float t = uTime * 0.01;
    float n1 = fbm(d * 2.2 + vec3(t, 0.0, -t));
    float n2 = fbm(d * 4.5 - vec3(0.0, t * 1.7, t));
    // Concentrate gas in a tilted band, like a galactic plane.
    float band = exp(-pow(dot(d, normalize(vec3(0.25, 1.0, 0.1))) * 2.4, 2.0));
    float density = smoothstep(0.35, 0.85, n1) * (0.35 + 0.65 * band);
    vec3 violet = vec3(0.32, 0.12, 0.55);
    vec3 teal = vec3(0.05, 0.35, 0.45);
    vec3 rose = vec3(0.55, 0.15, 0.30);
    vec3 col = mix(violet, teal, smoothstep(0.3, 0.7, n2));
    col = mix(col, rose, smoothstep(0.65, 0.9, n1 * n2 * 1.6));
    gl_FragColor = vec4(col * density * 0.55, 1.0);
  }
`;

export function makeNebula(radius = 1500): { mesh: THREE.Mesh; update: (t: number) => void } {
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), material);
  mesh.renderOrder = -10;
  return {
    mesh,
    update(t: number) {
      material.uniforms.uTime.value = t;
    },
  };
}
