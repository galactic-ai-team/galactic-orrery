// src/planets/dee/comet.ts
// Shared comet particle module. Any planet owner can instantiate:
//   const c = new Comet({ originRadius, inclination, length, tint, speed });
//   group.add(c.object3D);
//   // in planet.update(dt, t): c.update(dt);
//   // in planet.dispose():       c.dispose();
//
// Design goals: tiny CPU footprint (Points + BufferGeometry), no textures,
// tail always points away from the star in world space, deterministic look
// given a seed. Nova's Starfall Comet is one instance with her own tint/length.
//
// No per-frame allocations: scratch Vector3/Quaternion are module-scope and
// reused in update().

import * as THREE from 'three';

export interface CometOptions {
  /** Radius from the star (world units) the comet starts at. */
  originRadius: number;
  /** Inclination (radians) of the comet's orbit plane relative to the ecliptic. */
  inclination: number;
  /** Number of trail particles (default 400). */
  particleCount?: number;
  /** Visual length of the tail in world units (default 3.0). */
  length?: number;
  /** Tail color tint (default ice-blue). */
  tint?: THREE.ColorRepresentation;
  /** Angular speed around the star, radians/sec (default 0.12). */
  speed?: number;
  /** Seed for slight per-particle jitter, so two comets don't look identical. */
  seed?: number;
}

// Scratch objects, reused every frame to avoid GC churn.
const _outward = new THREE.Vector3();
const _xAxis = new THREE.Vector3(1, 0, 0);
const _quat = new THREE.Quaternion();

export class Comet {
  readonly object3D: THREE.Points;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.PointsMaterial;
  private readonly count: number;
  private readonly originRadius: number;
  private readonly inclination: number;
  private readonly speed: number;
  private readonly seed: number;
  private angle = 0;
  private disposed = false;

  constructor(opts: CometOptions) {
    this.originRadius = opts.originRadius;
    this.inclination = opts.inclination;
    this.count = opts.particleCount ?? 400;
    const length = opts.length ?? 3.0;
    this.speed = opts.speed ?? 0.12;
    this.seed = opts.seed ?? 0x9e3779b9;

    const positions = new Float32Array(this.count * 3);

    // Build the comet in local space along +X (tail extends away from origin;
    // update() rotates the whole object so +X points radially outward).
    for (let i = 0; i < this.count; i++) {
      const t = i / (this.count - 1);            // 0 = head, 1 = tail tip
      const x = t * length;
      const jitter = this.hash(i + this.seed) * 0.08 * (0.2 + t);
      const jy = (this.hash(i * 3 + this.seed) - 0.5) * jitter;
      const jz = (this.hash(i * 7 + this.seed) - 0.5) * jitter;
      positions[i * 3] = x;
      positions[i * 3 + 1] = jy;
      positions[i * 3 + 2] = jz;
    }

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Head->tail fade baked into vertex colors.
    const colors = new Float32Array(this.count * 3);
    const tint = new THREE.Color(opts.tint ?? 0x9fd8ff);
    for (let i = 0; i < this.count; i++) {
      const t = i / (this.count - 1);
      const a = 1.0 - t;                          // head bright, tail dim
      colors[i * 3] = tint.r * a;
      colors[i * 3 + 1] = tint.g * a;
      colors[i * 3 + 2] = tint.b * a;
    }
    this.geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.mat = new THREE.PointsMaterial({
      size: 0.045,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.object3D = new THREE.Points(this.geo, this.mat);
    this.object3D.frustumCulled = false;
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.angle = (this.angle + dt * this.speed) % (Math.PI * 2);

    const r = this.originRadius;
    const x = Math.cos(this.angle) * r;
    const z = Math.sin(this.angle) * r;
    const y = Math.sin(this.angle) * r * Math.sin(this.inclination);
    this.object3D.position.set(x, y, z);

    // Tail points radially away from the star. Map local +X -> outward.
    _outward.set(x, y, z).normalize();
    _quat.setFromUnitVectors(_xAxis, _outward);
    this.object3D.quaternion.copy(_quat);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.geo.dispose();
    this.mat.dispose();
  }

  private hash(n: number): number {
    const x = Math.sin(n * 12.9898 + this.seed * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }
}
