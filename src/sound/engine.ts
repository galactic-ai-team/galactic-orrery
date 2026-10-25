/**
 * Galactic Orrery — Web Audio 3D Spatial Sound Engine
 * Owner: Gemini
 * Credits & Integration:
 *  - Implements Claude's v1 Planet Sound Hook (src/planets/types.ts)
 *  - Keeps GPT-6's Aetheryx chime unique by using a low-register Sub-Bass Sonar Lock
 *    as the shared default click sound ('default-click'), leaving upper harmonics clear.
 *  - Supports Nova's Aurora Star-Planet, Dee's Comet, Claude's Planet, Lumi's Orrery,
 *    and Gemini's Castor & Pollux at orbit radius 23.5.
 */

import type * as THREE from 'three';

export type OscillatorWave = OscillatorType;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface SynthRecipe {
  type?: OscillatorWave;
  waveform?: OscillatorWave;
  /** Primary pitch in Hz */
  freq?: number;
  frequency?: number;
  /** Optional target pitch in Hz for pitch glides */
  endFreq?: number;
  frequencyEnd?: number;
  /** Optional multi-note chord or arpeggio frequencies in Hz */
  notes?: number[];
  /** Spacing between notes in seconds (0 = simultaneous chord, >0 = arpeggio) */
  noteStep?: number;
  /** Total duration in seconds (default 0.35) */
  duration?: number;
  /** Attack time in seconds (default 0.012) */
  attack?: number;
  /** Decay/release tail in seconds */
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

export type SoundDeclaration = string | SynthRecipe;

export interface PlaySoundOptions {
  /**
   * 3D world coordinate (THREE.Vector3, {x,y,z}, or [x,y,z]) for HRTF spatialization,
   * OR a numeric schedule delay in seconds.
   */
  at?: Vec3Like | [number, number, number] | number;
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
 * Engineered to stay under 300 Hz so GPT-6's Aetheryx chime and other planetary
 * high-register bells remain 100% distinct.
 */
export const DEFAULT_ORBIT_CLICK_RECIPE: SynthRecipe = {
  type: 'sine',
  freq: 146.83, // D3 warm sonar body
  endFreq: 110.0, // A2 sub-drop settle
  duration: 0.22,
  attack: 0.006,
  release: 0.19,
  filterFreq: 340,
  volume: 0.3,
};

export class SpatialSoundEngine implements SoundAPI {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private unlocked = false;
  private muted = false;
  private registry = new Map<string, SoundDeclaration>();
  private bufferCache = new Map<string, AudioBuffer>();
  private loadingUrls = new Set<string>();

  constructor(initialSounds?: Record<string, SoundDeclaration>) {
    this.registry.set('default', DEFAULT_ORBIT_CLICK_RECIPE);
    this.registry.set('default-click', DEFAULT_ORBIT_CLICK_RECIPE);
    this.registry.set('click', DEFAULT_ORBIT_CLICK_RECIPE);

    if (initialSounds) {
      this.register(initialSounds);
    }
    this.bindFirstGestureUnlock();
  }

  /**
   * Remains strictly silent until the first user gesture (pointerdown, keydown, touchstart).
   */
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
        const url = typeof def === 'string' ? def : def.url;
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
      if (!this.registry.has(id)) {
        this.registry.set(id, def);
      }
      if (namespace) {
        this.registry.set(`${namespace}:${id}`, def);
      } else {
        this.registry.set(id, def);
      }
      const url = typeof def === 'string' ? def : def.url;
      if (url && this.unlocked) {
        this.preloadUrl(url);
      }
    }
  }

  /**
   * Returns a planet-scoped sound interface so each planet's `ctx.sound.play(id, opts)`
   * resolves its own declared sound IDs first before falling back to global IDs.
   */
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

  /**
   * Plays the shared default low-end telescope sonar lock + mechanical gyro tick.
   */
  public playDefaultClick(opts?: PlaySoundOptions): void {
    if (!this.unlocked || this.muted || !this.ctx || !this.masterGain) return;
    const { spatialNode, timeOffset } = this.buildSpatialOutput(opts?.at);
    const startTime = this.ctx.currentTime + timeOffset;

    // 1. Crisp 18ms gyro tumbler transient
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

    // 2. Warm sub-bass sonar lock body
    this.playSynthRecipe(
      DEFAULT_ORBIT_CLICK_RECIPE,
      spatialNode,
      startTime + 0.008,
      opts
    );
  }

  /**
   * Syncs the 3D Web Audio listener with the active Three.js camera each frame.
   */
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

  /**
   * Claude v1 Sound Hook: `ctx.sound.play(id, { at, volume, detune })`
   */
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

    const def = this.registry.get(id);
    if (!def) {
      this.playDefaultClick(opts);
      return;
    }

    const { spatialNode, timeOffset } = this.buildSpatialOutput(opts?.at);
    const startTime = this.ctx.currentTime + timeOffset;

    const url = typeof def === 'string' ? def : def.url;
    if (url) {
      this.playUrlSound(url, spatialNode, startTime, opts);
    } else if (typeof def === 'object') {
      this.playSynthRecipe(def, spatialNode, startTime, opts);
    }
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

    if (at && typeof at === 'object') {
      const x = Array.isArray(at) ? at[0] : at.x;
      const y = Array.isArray(at) ? at[1] : at.y;
      const z = Array.isArray(at) ? at[2] : at.z;

      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        const panner = this.ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 14;
        panner.maxDistance = 260;
        panner.rolloffFactor = 0.85;

        const now = this.ctx.currentTime;
        if ('positionX' in panner && panner.positionX) {
          panner.positionX.setValueAtTime(x, now);
          panner.positionY.setValueAtTime(y, now);
          panner.positionZ.setValueAtTime(z, now);
        } else {
          panner.setPosition(x, y, z);
        }

        panner.connect(this.masterGain);
        return { spatialNode: panner, timeOffset: 0 };
      }
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

    const wave: OscillatorWave = recipe.type ?? recipe.waveform ?? 'sine';
    const baseFreq = recipe.freq ?? recipe.frequency ?? 440;
    const endFreq = recipe.endFreq ?? recipe.frequencyEnd;
    const notes =
      recipe.notes && recipe.notes.length > 0 ? recipe.notes : [baseFreq];
    const step = recipe.noteStep ?? 0.065;

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