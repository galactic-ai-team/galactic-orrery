import * as THREE from 'three';
import type { PlanetContext, PlanetModule } from './types';
import lumi from './lumi/index';
import gpt6 from './gpt6/index';
import claude from './claude/index';
import gemini from './gemini/index';
import dee from './dee/index';
import nova from './nova/index';

/** Add a planet: create src/planets/<agent>/index.ts and list it here. */
export const planets: PlanetModule[] = [lumi, gpt6, claude, gemini, dee, nova];

interface Mounted {
  module: PlanetModule;
  pivot: THREE.Object3D;
  body: THREE.Object3D;
  phase: number;
}

export class PlanetRegistry {
  private mounted: Mounted[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private downAt = new THREE.Vector2();

  constructor(
    private ctx: PlanetContext,
    private onSelect?: (p: PlanetModule) => void,
  ) {
    planets.forEach((module, i) => {
      const pivot = new THREE.Object3D();
      pivot.position.copy(ctx.starPosition);
      const body = module.create(ctx);
      body.position.set(module.orbitRadius, 0, 0);
      body.userData.planetId = module.id;
      pivot.add(body);
      pivot.add(makeOrbitLine(module.orbitRadius));
      ctx.scene.add(pivot);
      // Spread starting positions so planets don't line up.
      const phase = (i / planets.length) * Math.PI * 2 + i * 0.7;
      this.mounted.push({ module, pivot, body, phase });
    });

    const el = ctx.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.downAt.set(e.clientX, e.clientY));
    el.addEventListener('pointerup', (e) => {
      // Ignore drags (OrbitControls) — only treat near-stationary releases as clicks.
      if (this.downAt.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 5) return;
      this.handleClick(e.clientX, e.clientY);
    });
  }

  private handleClick(x: number, y: number) {
    const rect = this.ctx.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.ctx.camera);
    const hits = this.raycaster.intersectObjects(this.mounted.map((m) => m.body), true);
    for (const hit of hits) {
      if (hit.object.type === 'Points') continue;
      let o: THREE.Object3D | null = hit.object;
      while (o && o.userData.planetId === undefined) o = o.parent;
      const m = this.mounted.find((mm) => mm.body === o);
      if (m) {
        m.module.onClick?.();
        this.onSelect?.(m.module);
        return;
      }
    }
  }

  update(dt: number, t: number) {
    for (const m of this.mounted) {
      m.pivot.rotation.y = m.phase + t * m.module.orbitSpeed;
      m.module.update(dt, t);
    }
  }

  dispose() {
    for (const m of this.mounted) {
      m.module.dispose?.();
      this.ctx.scene.remove(m.pivot);
    }
    this.mounted = [];
  }
}

function makeOrbitLine(radius: number): THREE.LineLoop {
  const pts: THREE.Vector3[] = [];
  const n = 256;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  return new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x3a5a80, transparent: true, opacity: 0.25 }),
  );
}
