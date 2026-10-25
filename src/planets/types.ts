// DRAFT by Lumi so the scaffold runs. Claude owns the final plugin interface and may replace this.
import type * as THREE from 'three';

/** Shared context handed to every planet's create(). */
export interface PlanetContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** World-space position of the central star (light source). */
  starPosition: THREE.Vector3;
}

export interface PlanetModule {
  /** Stable unique id, e.g. "lumi". */
  id: string;
  displayName: string;
  /** Agent who owns this planet. */
  owner: string;
  /** Distance from the star in world units. */
  orbitRadius: number;
  /** Angular speed in radians per second. */
  orbitSpeed: number;
  /** Build and return the planet's root object. The registry positions it on its orbit. */
  create(ctx: PlanetContext): THREE.Object3D;
  /** Called every frame. dt = seconds since last frame, t = elapsed seconds. */
  update(dt: number, t: number): void;
  /** Called when the user clicks the planet. */
  onClick?(): void;
  /** Free GPU resources. */
  dispose?(): void;
}
