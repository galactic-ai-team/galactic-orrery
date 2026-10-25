// src/planets/perf.ts — per-planet performance budget + static audit (owner: Claude)
//
// Budgets are per planet, sized so six planets + star + bloom hold 60fps on a
// mid-range phone at "low" and a laptop iGPU at "high".
// The registry should call auditPlanet() after create() in dev and log the
// result; CI can run the same audit headlessly.

import type { Material, Object3D, Texture } from "three";
import type { QualityTier } from "./types";

export interface PerfBudget {
  drawCalls: number;
  triangles: number;
  points: number;
  textureMB: number;
  lights: number;
}

export const PERF_BUDGET: Record<QualityTier, PerfBudget> = {
  low:  { drawCalls: 6,  triangles: 20_000, points: 5_000,  textureMB: 4,  lights: 0 },
  high: { drawCalls: 12, triangles: 80_000, points: 30_000, textureMB: 16, lights: 0 },
};

export interface PlanetAudit {
  drawCalls: number;
  triangles: number;
  points: number;
  textureMB: number;
  lights: number;
  violations: string[];
}

type Drawable = Object3D & {
  geometry?: { index: { count: number } | null; attributes: { position?: { count: number } } };
  material?: Material | Material[];
  count?: number; // InstancedMesh
  isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isLight?: boolean;
  isInstancedMesh?: boolean;
};

export function auditPlanet(root: Object3D, quality: QualityTier): PlanetAudit {
  const budget = PERF_BUDGET[quality];
  const textures = new Set<Texture>();
  let drawCalls = 0, triangles = 0, points = 0, lights = 0;

  root.traverse((o) => {
    const d = o as Drawable;
    if (d.isLight) { lights++; return; }
    if (!(d.isMesh || d.isPoints || d.isLine) || !d.geometry) return;

    const mats = Array.isArray(d.material) ? d.material : d.material ? [d.material] : [];
    drawCalls += Math.max(mats.length, 1);

    const instances = d.isInstancedMesh ? d.count ?? 1 : 1;
    const verts = d.geometry.index?.count ?? d.geometry.attributes.position?.count ?? 0;
    if (d.isMesh) triangles += (verts / 3) * instances;
    else if (d.isPoints) points += verts * instances;

    for (const m of mats) {
      for (const v of Object.values(m as unknown as Record<string, unknown>)) {
        if (v && (v as Texture).isTexture) textures.add(v as Texture);
      }
      const uniforms = (m as { uniforms?: Record<string, { value: unknown }> }).uniforms;
      for (const u of Object.values(uniforms ?? {})) {
        if (u?.value && (u.value as Texture).isTexture) textures.add(u.value as Texture);
      }
    }
  });

  let bytes = 0;
  for (const t of textures) {
    const img = t.image as { width?: number; height?: number } | undefined;
    if (img?.width && img?.height) bytes += img.width * img.height * 4 * (t.generateMipmaps ? 4 / 3 : 1);
  }
  const textureMB = Math.round((bytes / 1_048_576) * 10) / 10;

  const audit = { drawCalls, triangles: Math.round(triangles), points, textureMB, lights };
  const violations = (Object.keys(budget) as (keyof PerfBudget)[])
    .filter((k) => audit[k] > budget[k])
    .map((k) => `${k} ${audit[k]} > ${budget[k]} (${quality})`);

  return { ...audit, violations };
}
