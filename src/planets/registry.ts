import * as THREE from 'three';
import type { PlanetContext, PlanetModule, QualityTier } from './types';
import { auditPlanet } from './perf';
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
  private upAt = new THREE.Vector2();
  private orbitLines: THREE.LineLoop[] = [];
  private listeners: Array<[keyof HTMLElementEventMap, (e: PointerEvent) => void]> = [];

  private textureLoader = new THREE.TextureLoader();
  private textureCache = new Map<string, Promise<THREE.Texture>>();
  readonly quality: QualityTier;

  constructor(
    private host: RegistryHost,
    private onSelect?: (p: PlanetModule) => void,
  ) {
    this.quality = detectQuality(host.renderer);
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    // No-op until Gemini's spatial sound engine lands; it will implement PlanetSound.
    const sound = { play: () => {} };

    planets.forEach((module, i) => {
      const ctx: PlanetContext = {
        renderer: host.renderer,
        quality: this.quality,
        reducedMotion,
        starPosition: host.starPosition,
        sound,
        loadTexture: (url) => this.loadTexture(url),
        random: seededRandom(module.id),
      };
      const pivot = new THREE.Object3D();
      pivot.position.copy(host.starPosition);
      const body = module.create(ctx);
      body.position.set(module.orbitRadius, 0, 0);
      if (module.axialTilt) body.rotation.z = module.axialTilt;
      body.userData.planetId = module.id;
      pivot.add(body);
      const line = makeOrbitLine(module.orbitRadius);
      this.orbitLines.push(line);
      pivot.add(line);
      host.scene.add(pivot);
      if (import.meta.env.DEV) {
        const audit = auditPlanet(body, this.quality);
        if (audit.violations.length) console.warn(`[perf] ${module.id}:`, audit.violations.join('; '));
      }
      // Use the planet's orbitPhase, or spread starting positions so planets don't line up.
      const phase = module.orbitPhase ?? (i / planets.length) * Math.PI * 2 + i * 0.7;
      this.mounted.push({ module, pivot, body, phase });
    });

    const el = host.renderer.domElement;
    this.listeners = [
      ['pointermove', (e) => this.handleHover(e.clientX, e.clientY)],
      ['pointerdown', (e) => this.downAt.set(e.clientX, e.clientY)],
      ['pointerup', (e) => {
        // Ignore drags (OrbitControls) — only treat near-stationary releases as clicks.
        if (this.downAt.distanceTo(this.upAt.set(e.clientX, e.clientY)) > 5) return;
        this.handleClick(e.clientX, e.clientY);
      }],
    ];
    for (const [type, fn] of this.listeners) el.addEventListener(type, fn as EventListener);
  }

  private hovered?: Mounted;

  private pick(x: number, y: number): { m: Mounted; hit: THREE.Intersection } | undefined {
    const rect = this.host.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.host.camera);
    const hits = this.raycaster.intersectObjects(this.mounted.map((m) => m.body), true);
    for (const hit of hits) {
      if (hit.object.type === 'Points') continue;
      let o: THREE.Object3D | null = hit.object;
      while (o && o.userData.planetId === undefined) o = o.parent;
      const m = this.mounted.find((mm) => mm.body === o);
      if (m) return { m, hit };
    }
    return undefined;
  }

  private handleClick(x: number, y: number) {
    const picked = this.pick(x, y);
    if (!picked) return;
    picked.m.module.onClick?.({ point: picked.hit.point.clone(), object: picked.hit.object });
    this.onSelect?.(picked.m.module);
  }

  private handleHover(x: number, y: number) {
    const m = this.pick(x, y)?.m;
    if (m === this.hovered) return;
    this.hovered?.module.onHover?.(false);
    m?.module.onHover?.(true);
    this.hovered = m;
    this.host.renderer.domElement.style.cursor = m ? 'pointer' : '';
  }

  private loadTexture(url: string): Promise<THREE.Texture> {
    let p = this.textureCache.get(url);
    if (!p) {
      p = this.textureLoader.loadAsync(url);
      this.textureCache.set(url, p);
    }
    return p;
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
      this.host.scene.remove(m.pivot);
    }
    this.mounted = [];
    const el = this.host.renderer.domElement;
    for (const [type, fn] of this.listeners) el.removeEventListener(type, fn as EventListener);
    this.listeners = [];
    el.style.cursor = '';
    this.hovered = undefined;
    for (const line of this.orbitLines) {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.orbitLines = [];
    for (const p of this.textureCache.values()) p.then((t) => t.dispose()).catch(() => {});
    this.textureCache.clear();
  }
}

/** What main.ts hands the registry; planets get a narrower PlanetContext. */
export interface RegistryHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  starPosition: THREE.Vector3;
}

function detectQuality(renderer: THREE.WebGLRenderer): QualityTier {
  const forced = new URLSearchParams(location.search).get('quality');
  if (forced === 'low' || forced === 'high') return forced;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse || renderer.capabilities.maxTextureSize < 8192 ? 'low' : 'high';
}

/** mulberry32 seeded from the planet id, so each planet looks the same on every load. */
function seededRandom(id: string): () => number {
  let a = 2166136261;
  for (let i = 0; i < id.length; i++) a = Math.imul(a ^ id.charCodeAt(i), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
