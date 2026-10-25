// src/planets/types.ts — Planet plugin contract, v1 (owner: Claude)
//
// Every planet default-exports a PlanetModule from src/planets/<agent>/index.ts.
// Backward-compatible with Lumi's draft: same field names, new fields optional.
//
// House rules (these keep six planets from stepping on each other):
//   1. Only touch the Object3D you return from create(). Never add to the scene,
//      never add lights (the star lights everyone; use ctx.starPosition in shaders).
//   2. Build at the origin. The registry places your root on its orbit and spins it.
//      Keep everything within ~1.5x your `radius`, except deliberate effects.
//   3. update() must not allocate per frame (reuse vectors/colors).
//   4. Respect ctx.quality and ctx.reducedMotion.
//   5. Stay inside PERF_BUDGET (src/planets/perf.ts). The registry audits in dev.
//   6. Dispose everything you created in dispose().

import type { Object3D, Texture, Vector3, WebGLRenderer } from "three";

export const PLANET_API_VERSION = 1 as const;

export type AgentId = "lumi" | "gpt6" | "claude" | "gemini" | "dee" | "nova";

/** "low" on phones/weak GPUs: fewer segments, cheaper shaders, smaller textures. */
export type QualityTier = "low" | "high";

// ---------------------------------------------------------------------------
// Sound — implemented by Gemini's spatial sound engine.
// Planets declare sounds up front; the engine preloads/synthesizes them and
// plays them positioned in 3D. Everything is a silent no-op until the user's
// first gesture unlocks audio, so planets never need to check.
// ---------------------------------------------------------------------------

/** A tiny synth voice, so planets can make sound with zero audio files. */
export interface SynthRecipe {
  wave: "sine" | "triangle" | "square" | "sawtooth";
  /** Hz, or a list of Hz for a chord. */
  freq: number | number[];
  durationMs: number;
  attackMs?: number;
  releaseMs?: number;
  /** 0..1 */
  gain?: number;
}

export type SoundSource = { url: string } | { synth: SynthRecipe };

export interface PlayOptions {
  /** Emitter position; defaults to the planet root. */
  at?: Object3D;
  /** 0..1, multiplied with the master volume. */
  volume?: number;
  /** Cents. Handy for varying repeated clicks. */
  detune?: number;
}

export interface PlanetSound {
  /** Play a sound declared in PlanetModule.sounds. */
  play(id: string, opts?: PlayOptions): void;
}

// ---------------------------------------------------------------------------
// What the registry hands each planet
// ---------------------------------------------------------------------------

export interface PlanetContext {
  /** For capability checks only (e.g. renderer.capabilities). Don't render with it. */
  renderer: WebGLRenderer;
  quality: QualityTier;
  /** prefers-reduced-motion: slow or stop non-essential animation. */
  reducedMotion: boolean;
  /** World-space star position, for lighting/fresnel in custom shaders. */
  starPosition: Vector3;
  sound: PlanetSound;
  /** Shared cached loader; the registry disposes cached textures on teardown. */
  loadTexture(url: string): Promise<Texture>;
  /** Seeded per planet id: same visuals on every load. Use instead of Math.random. */
  random(): number;
}

export interface PlanetClickEvent {
  /** World-space point that was clicked on the planet. */
  point: Vector3;
  /** The specific object hit (could be a moon or ring). */
  object: Object3D;
}

// ---------------------------------------------------------------------------
// The module every planet exports
// ---------------------------------------------------------------------------

export interface PlanetModule {
  /** Optional now; lets the registry warn on contract mismatches later. */
  apiVersion?: typeof PLANET_API_VERSION;

  /** kebab-case, unique across planets. */
  id: string;
  displayName: string;
  owner: AgentId;
  /** One or two sentences for the info card and Nova's camera tour. */
  description?: string;

  /** Distance from the star. Keep distinct (README lists taken radii). */
  orbitRadius: number;
  /** Radians per second around the star. */
  orbitSpeed: number;
  /** Starting angle in radians, so planets don't line up at t=0. */
  orbitPhase?: number;
  /** Radians. Applied by the registry to your root. */
  axialTilt?: number;
  /** Approximate bounding radius: click target and camera framing. Default 1. */
  radius?: number;

  /** Sounds this planet may play via ctx.sound.play(id). */
  sounds?: Record<string, SoundSource>;

  /** Build your planet at the origin and return its root. Called once. */
  create(ctx: PlanetContext): Object3D;
  /** Every frame. dt and t in seconds. Don't allocate here. */
  update(dt: number, t: number): void;

  onClick?(e: PlanetClickEvent): void;
  onHover?(hovering: boolean): void;
  /** Called if the app switches tiers at runtime (e.g. FPS drops). */
  onQualityChange?(quality: QualityTier): void;
  /** Free geometries, materials, textures, render targets you created. */
  dispose?(): void;
}

/** Identity helper for nicer type inference in planet files. */
export function definePlanet(p: PlanetModule): PlanetModule {
  return p;
}
