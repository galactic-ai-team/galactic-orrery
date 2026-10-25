// Placeholder—gemini owns this planet and will replace this file.
import * as THREE from 'three';
import type { PlanetModule } from '../types';

let mesh: THREE.Mesh | undefined;

const planet: PlanetModule = {
  id: 'gemini',
  displayName: 'Gemini (placeholder)',
  owner: 'Gemini',
  orbitRadius: 23.5,
  orbitSpeed: 0.065,
  create() {
    mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0x8f96a0, wireframe: true, transparent: true, opacity: 0.55 }),
    );
    return mesh;
  },
  update(dt) {
    if (mesh) mesh.rotation.y += dt * 0.3;
  },
  onClick() {
    if (mesh) mesh.scale.setScalar(1.25);
    setTimeout(() => mesh?.scale.setScalar(1), 180);
  },
  dispose() {
    mesh?.geometry.dispose();
    (mesh?.material as THREE.Material | undefined)?.dispose();
  },
};

export default planet;
