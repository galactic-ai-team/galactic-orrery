/**
 * Galactic Orrery — Web Audio 3D Spatial Sound Engine
 * Owner: Gemini
 * Credits & Integration:
 *  - Implements Claude's v1 Planet Sound Hook (src/planets/types.ts)
 *  - Accepts THREE.Object3D, THREE.Vector3, or [x,y,z] for `at` spatial positioning
 *  - Includes 'twin-resonance' as a first-class SoundSource alongside standard waves,
 *    while keeping GPT-6's Aetheryx chime unique via a sub-300Hz default sonar lock.
 */

import type * as THREE from 'three';

export type OscillatorWave = OscillatorType;

export type SoundSourcePreset =
  | OscillatorWave
  | 'twin-resonance'
  | 'chime'
  | 'pulse'
  | 'drone'
  | 'shimmer'
  | 'default'
  | 'default-click'
  | 'click';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface Object3DLike {
  position?: Vec3Like;
  getWorldPosition?: (target: Vec3Like) => Vec3Like;
}

export interface SynthRecipe {
  /** Supports both `type` and `source` / `waveform` across planet modules */
  type?: SoundSourcePreset;
  source?: SoundSourcePreset;
  waveform?: OscillatorWave;
  /** Primary pitch in Hz */
  freq?: number;
  frequency?: number;
  /** Optional target pitch in Hz for pitch glides */
  endFreq?: number;
  frequencyEnd?: number;
  /** Optional multi-note chord or arpeggio frequencies in Hz */
  notes?: number[];
  /** Spacing between notes in seconds (0 = chord, >0 = arpeggio) */
  noteStep?: number;
  /** Total duration in seconds (default 0.35) */
  duration?: number;
  /** Attack ramp in seconds (default 0.012) */
  attack?: number;
  /** Release/decay tail in seconds */
  decay?: number;
  release?: number;
  /** Base gain 0..1 (default 0.28) */
  volume?: number;
  /** Pitch detune in cents */
  detune?: number;
  /** Optional lowpass filter cutoff in Hz */
  filterFreq?: number;
  /** Optional audio file URL */
  url?: string;
}

export type SoundSource = SoundSourcePreset | SynthRecipe | string;
export type SoundDeclaration = SoundSource;

export interface PlaySoundOptions {
  /**
   * Accepts a THREE.Object3D (as required by src/planets/types.ts),
   * a 3D coordinate ({x,y,z} or [x,y,z]), or a numeric time offset in seconds.
   */
  at?: THREE.Object3D | Object3DLike | Vec3Like | [number, number, number] | number;
  /** Volume multiplier (0.0 to 1.0+) */
  volume?: number;
  /** Pitch detune in cents */
  detune?: number;
}

export interface SoundAPI {
  play: (id: string, opts?: PlaySoundOptions) => void;
  register?: (
    sounds: Record<string, SoundDeclaration>,
    namespace?: string
  ) => void;
  playDefaultClick?: (opts?: PlaySoundOptions) => void;
  updateListener?: (camera: THREE.Camera) => void;
  setMuted?: (muted: boolean) => void;
  isMuted?: () => boolean;
  isUnlocked?: () => boolean;
}

/**
 * Shared Default Click Recipe ("Deep-Space Sonar Lock"):
 * Stays below 300 Hz so GPT-6's Aetheryx chime and planetary upper harmonics stay distinct.
 */
export const DEFAULT_ORBIT_CLICK_RECIPE: SynthRecipe = {
  type: 'sine',
  source: 'sine',
  freq: 146.83, // D3 warm sonar body
  endFreq: 110.0, // A2 sub-drop settle
  duration: 0.22,
  attack: 0.006,
  release: 0.19,
  filterFreq: 340,
  volume: 0.3,
};

/**
 * Built-in Named SoundSource Presets (including Gemini's 'twin-resonance')
 */
export const BUILTIN_SOUND_SOURCES: Record<string, SynthRecipe> = {
  default: DEFAULT_ORBIT_CLICK_RECIPE,
  'default-click': DEFAULT_ORBIT_CLICK_RECIPE,
  click: DEFAULT_ORBIT_CLICK_RECIPE,
  'twin-resonance': {
    type: 'triangle',
    source: 'twin-resonance',
    // Castor & Pollux warm polychord (F4, C5, G5, A5, D6)
    notes: [349.23, 523.25, 783.99, 880.0, 1174.66],
    noteStep: 0.055,
    duration: 0.58,
    attack: 0.016,
    release: 0.5,
    volume: 0.32,
  },
  chime: {
    type: 'sine',
    freq: 659.25,
    endFreq: 987.77,
    duration: 0.42,
    attack: 0.01,
    release: 0.38,
    volume: 0.26,
  },
  pulse: {
    type: 'triangle',
    freq: 220.0,
    endFreq: 146.83,
    duration: 0.32,
    attack: 0.012,
    release: 0.28,
    volume: 0.28,
  },
  drone: {
    type: 'sawtooth',
    freq: 110.0,
    duration: 0.65,
    attack: 0.04,
    release: 0.55,
    filterFreq: 420,
    volume: 0.22,
  },
  shimmer: {
    type: 'sine',
    notes: [523.25, 659.25, 783.99, 1046.5],
    noteStep: 0.045,
    duration: 0.5,
    attack: 0.015,
    release: 0.42,
    volume: 0.25,
  },
};

const VALID_OSC_WAVES = new Set<OscillatorWave>([
  'sine',
  'square',
  'sawtooth',
  'triangle',
]);

function normalizeOscWave(candidate?: string): OscillatorWave {
  if (candidate && VALID_OSC_WAVES.has(candidate as OscillatorWave)) {
    return candidate as OscillatorWave;
  }
  return 'triangle';
}

export class SpatialSoundEngine implements SoundAPI {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private unlocked = false;
  private muted = false;
  private registry = new Map<string, SoundDeclaration>();
  private bufferCache = new Map<string, AudioBuffer>();
  private loadingUrls = new Set<string>();

  constructor(initialSounds?: Record<string, SoundDeclaration>) {
    for (const [id, preset] of Object.entries(BUILTIN_SOUND_SOURCES)) {
      this.registry.set(id, preset);
    }

    if (initialSounds) {
      this.register(initialSounds);
    }
    this.bindFirstGestureUnlock();
  }

  private bindFirstGestureUnlock(): void {
    if (typeof window === 'undefined') return;

    const unlock = () => {
      if (this.unlocked) return;
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;

      if (!this.ctx) {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.muted ? 0 : 0.85;
        this.masterGain.connect(this.ctx.destination);
      }

      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }

      this.unlocked = true;

      for (const [, def] of this.registry) {
        const url = this.extractUrl(def);
        if (url) {
          this.preloadUrl(url);
        }
      }

      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };

    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
  }

  private extractUrl(def: SoundDeclaration): string | undefined {
    if (typeof def === 'string') {
      if (
        def.startsWith('/') ||
        def.startsWith('http://') ||
        def.startsWith('https://') ||
        def.startsWith('data:audio')
      ) {
        return def;
      }
      return undefined;
    }
    return def.url;
  }

  public isUnlocked(): boolean {
    return this.unlocked && this.ctx !== null && this.ctx.state === 'running';
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        muted ? 0 : 0.85,
        this.ctx.currentTime,
        0.02
      );
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public register(
    sounds: Record<string, SoundDeclaration>,
    namespace?: string
  ): void {
    for (const [id, def] of Object.entries(sounds)) {
      const resolvedDef: SoundDeclaration =
        typeof def === 'string' && BUILTIN_SOUND_SOURCES[def]
          ? BUILTIN_SOUND_SOURCES[def]
          : def;

      if (!this.registry.has(id)) {
        this.registry.set(id, resolvedDef);
      }
      if (namespace) {
        this.registry.set(`${namespace}:${id}`, resolvedDef);
      } else {
        this.registry.set(id, resolvedDef);
      }

      const url = this.extractUrl(resolvedDef);
      if (url && this.unlocked) {
        this.preloadUrl(url);
      }
    }
  }

  public forPlanet(
    planetId: string,
    sounds?: Record<string, SoundDeclaration>
  ): SoundAPI {
    if (sounds) {
      this.register(sounds, planetId);
    }
    return {
      play: (id: string, opts?: PlaySoundOptions) => {
        const scopedKey = `${planetId}:${id}`;
        if (this.registry.has(scopedKey)) {
          this.play(scopedKey, opts);
        } else {
          this.play(id, opts);
        }
      },
      register: (newSounds: Record<string, SoundDeclaration>) =>
        this.register(newSounds, planetId),
      playDefaultClick: (opts?: PlaySoundOptions) => this.playDefaultClick(opts),
      updateListener: (camera: THREE.Camera) => this.updateListener(camera),
      setMuted: (muted: boolean) => this.setMuted(muted),
      isMuted: () => this.isMuted(),
      isUnlocked: () => this.isUnlocked(),
    };
  }

  public playDefaultClick(opts?: PlaySoundOptions): void {
    if (!this.unlocked || this.muted || !this.ctx || !this.masterGain) return;
    const { spatialNode, timeOffset } = this.buildSpatialOutput(opts?.at);
    const startTime = this.ctx.currentTime + timeOffset;

    this.playSynthRecipe(
      {
        type: 'triangle',
        freq: 720,
        endFreq: 160,
        duration: 0.025,
        attack: 0.002,
        release: 0.02,
        volume: 0.18,
      },
      spatialNode,
      startTime,
      opts
    );

    this.playSynthRecipe(
      DEFAULT_ORBIT_CLICK_RECIPE,
      spatialNode,
      startTime + 0.008,
      opts
    );
  }

  public updateListener(camera: THREE.Camera): void {
    if (!this.ctx || !this.unlocked) return;
    const listener = this.ctx.listener;
    const pos = camera.position;
    const el = camera.matrixWorld.elements;

    const forwardX = -el[8];
    const forwardY = -el[9];
    const forwardZ = -el[10];
    const upX = el[4];
    const upY = el[5];
    const upZ = el[6];

    const now = this.ctx.currentTime;
    if ('positionX' in listener && listener.positionX) {
      listener.positionX.setTargetAtTime(pos.x, now, 0.03);
      listener.positionY.setTargetAtTime(pos.y, now, 0.03);
      listener.positionZ.setTargetAtTime(pos.z, now, 0.03);
      listener.forwardX.setTargetAtTime(forwardX, now, 0.03);
      listener.forwardY.setTargetAtTime(forwardY, now, 0.03);
      listener.forwardZ.setTargetAtTime(forwardZ, now, 0.03);
      listener.upX.setTargetAtTime(upX, now, 0.03);
      listener.upY.setTargetAtTime(upY, now, 0.03);
      listener.upZ.setTargetAtTime(upZ, now, 0.03);
    } else {
      listener.setPosition(pos.x, pos.y, pos.z);
      listener.setOrientation(forwardX, forwardY, forwardZ, upX, upY, upZ);
    }
  }

  public play(id: string, opts?: PlaySoundOptions): void {
    if (!this.unlocked || this.muted || !this.ctx || !this.masterGain) {
      return;
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
      return;
    }

    if (id === 'default' || id === 'default-click' || id === 'click') {
      this.playDefaultClick(opts);
      return;
    }

    const def = this.registry.get(id) ?? BUILTIN_SOUND_SOURCES[id];
    if (!def) {
      this.playDefaultClick(opts);
      return;
    }

    const { spatialNode, timeOffset } = this.buildSpatialOutput(opts?.at);
    const startTime = this.ctx.currentTime + timeOffset;

    if (typeof def === 'string') {
      const preset = BUILTIN_SOUND_SOURCES[def];
      if (preset) {
        this.playSynthRecipe(preset, spatialNode, startTime, opts);
        return;
      }
      if (VALID_OSC_WAVES.has(def as OscillatorWave)) {
        this.playSynthRecipe(
          { type: def as OscillatorWave, freq: 440, duration: 0.35 },
          spatialNode,
          startTime,
          opts
        );
        return;
      }
      const url = this.extractUrl(def);
      if (url) {
        this.playUrlSound(url, spatialNode, startTime, opts);
        return;
      }
      this.playDefaultClick(opts);
      return;
    }

    if (def.url) {
      this.playUrlSound(def.url, spatialNode, startTime, opts);
      return;
    }

    // If a recipe references a preset in `source` or `type` (e.g. source: 'twin-resonance')
    const presetRef =
      (def.source && BUILTIN_SOUND_SOURCES[def.source]) ||
      (def.type && BUILTIN_SOUND_SOURCES[def.type]);
    const mergedRecipe = presetRef ? { ...presetRef, ...def } : def;

    this.playSynthRecipe(mergedRecipe, spatialNode, startTime, opts);
  }

  private extractCoords(
    at?: PlaySoundOptions['at']
  ): { x: number; y: number; z: number } | null {
    if (!at || typeof at !== 'object') return null;

    if (Array.isArray(at)) {
      return { x: at[0], y: at[1], z: at[2] };
    }

    // Handle THREE.Object3D (has getWorldPosition or .position)
    const maybeObj = at as Object3DLike;
    if (typeof maybeObj.getWorldPosition === 'function') {
      const target = {
        x: 0,
        y: 0,
        z: 0,
        set(nx: number, ny: number, nz: number) {
          this.x = nx;
          this.y = ny;
          this.z = nz;
          return this;
        },
        setFromMatrixPosition(m: { elements: number[] }) {
          this.x = m.elements[12];
          this.y = m.elements[13];
          this.z = m.elements[14];
          return this;
        },
      };
      try {
        maybeObj.getWorldPosition(target as unknown as Vec3Like);
        return { x: target.x, y: target.y, z: target.z };
      } catch {
        if (maybeObj.position) {
          return {
            x: maybeObj.position.x,
            y: maybeObj.position.y,
            z: maybeObj.position.z,
          };
        }
      }
    }

    if (maybeObj.position && typeof maybeObj.position.x === 'number') {
      return {
        x: maybeObj.position.x,
        y: maybeObj.position.y,
        z: maybeObj.position.z,
      };
    }

    const maybeVec = at as Vec3Like;
    if (
      typeof maybeVec.x === 'number' &&
      typeof maybeVec.y === 'number' &&
      typeof maybeVec.z === 'number'
    ) {
      return { x: maybeVec.x, y: maybeVec.y, z: maybeVec.z };
    }

    return null;
  }

  private buildSpatialOutput(
    at?: PlaySoundOptions['at']
  ): { spatialNode: AudioNode; timeOffset: number } {
    if (!this.ctx || !this.masterGain) {
      throw new Error('AudioContext not initialized');
    }

    if (typeof at === 'number') {
      return {
        spatialNode: this.masterGain,
        timeOffset: Math.max(0, at),
      };
    }

    const coords = this.extractCoords(at);
    if (
      coords &&
      Number.isFinite(coords.x) &&
      Number.isFinite(coords.y) &&
      Number.isFinite(coords.z)
    ) {
      const panner = this.ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 14;
      panner.maxDistance = 260;
      panner.rolloffFactor = 0.85;

      const now = this.ctx.currentTime;
      if ('positionX' in panner && panner.positionX) {
        panner.positionX.setValueAtTime(coords.x, now);
        panner.positionY.setValueAtTime(coords.y, now);
        panner.positionZ.setValueAtTime(coords.z, now);
      } else {
        panner.setPosition(coords.x, coords.y, coords.z);
      }

      panner.connect(this.masterGain);
      return { spatialNode: panner, timeOffset: 0 };
    }

    return { spatialNode: this.masterGain, timeOffset: 0 };
  }

  private playSynthRecipe(
    recipe: SynthRecipe,
    destination: AudioNode,
    startTime: number,
    opts?: PlaySoundOptions
  ): void {
    if (!this.ctx) return;

    const wave: OscillatorWave = normalizeOscWave(
      recipe.waveform ?? recipe.type ?? recipe.source
    );
    const baseFreq = recipe.freq ?? recipe.frequency ?? 440;
    const endFreq = recipe.endFreq ?? recipe.frequencyEnd;
    const notes =
      recipe.notes && recipe.notes.length > 0 ? recipe.notes : [baseFreq];
    const step = recipe.noteStep ?? 0.055;

    const duration = Math.max(0.025, recipe.duration ?? 0.36);
    const attack = Math.max(0.003, recipe.attack ?? 0.014);
    const release = Math.max(
      0.018,
      recipe.release ?? recipe.decay ?? duration * 0.78
    );

    const baseVol = recipe.volume ?? 0.28;
    const optVol = opts?.volume ?? 1;
    const peakGain = Math.min(1, Math.max(0.001, baseVol * optVol));
    const totalDetune = (recipe.detune ?? 0) + (opts?.detune ?? 0);

    notes.forEach((noteFreq, idx) => {
      if (!this.ctx) return;
      const noteStart = startTime + idx * step;
      const noteStop = noteStart + attack + release;

      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();

      osc.type = wave;
      osc.frequency.setValueAtTime(Math.max(20, noteFreq), noteStart);
      if (endFreq && notes.length === 1) {
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(20, endFreq),
          noteStop
        );
      }
      if (totalDetune !== 0) {
        osc.detune.setValueAtTime(totalDetune, noteStart);
      }

      env.gain.setValueAtTime(0.0008, noteStart);
      env.gain.linearRampToValueAtTime(
        peakGain / Math.sqrt(notes.length),
        noteStart + attack
      );
      env.gain.exponentialRampToValueAtTime(0.0005, noteStop);

      if (recipe.filterFreq && recipe.filterFreq > 0) {
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(recipe.filterFreq, noteStart);
        osc.connect(filter);
        filter.connect(env);
      } else {
        osc.connect(env);
      }

      env.connect(destination);
      osc.start(noteStart);
      osc.stop(noteStop + 0.02);
    });
  }

  private async preloadUrl(url: string): Promise<AudioBuffer | null> {
    if (this.bufferCache.has(url)) {
      return this.bufferCache.get(url)!;
    }
    if (!this.ctx || this.loadingUrls.has(url)) return null;

    this.loadingUrls.add(url);
    try {
      const res = await fetch(url);
      const arrayBuf = await res.arrayBuffer();
      const audioBuf = await this.ctx.decodeAudioData(arrayBuf);
      this.bufferCache.set(url, audioBuf);
      return audioBuf;
    } catch {
      return null;
    } finally {
      this.loadingUrls.delete(url);
    }
  }

  private playUrlSound(
    url: string,
    destination: AudioNode,
    startTime: number,
    opts?: PlaySoundOptions
  ): void {
    if (!this.ctx) return;
    const cached = this.bufferCache.get(url);
    if (!cached) {
      this.preloadUrl(url).then((buf) => {
        if (buf && this.ctx) {
          this.triggerBuffer(buf, destination, this.ctx.currentTime, opts);
        }
      });
      return;
    }
    this.triggerBuffer(cached, destination, startTime, opts);
  }

  private triggerBuffer(
    buffer: AudioBuffer,
    destination: AudioNode,
    startTime: number,
    opts?: PlaySoundOptions
  ): void {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();

    src.buffer = buffer;
    if (opts?.detune) {
      src.detune.setValueAtTime(opts.detune, startTime);
    }
    gain.gain.setValueAtTime(
      Math.max(0, Math.min(1.5, opts?.volume ?? 0.8)),
      startTime
    );

    src.connect(gain);
    gain.connect(destination);
    src.start(startTime);
  }
}

export const soundEngine = new SpatialSoundEngine();
export default soundEngine;