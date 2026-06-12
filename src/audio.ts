import Soundfont, { type Player } from "soundfont-player";
import type { MidiNote } from "./types";
import { assetUrl } from "./assets";

/**
 * Look-ahead window for streaming MIDI background scheduling, in seconds.
 * Songs with thousands of background notes (e.g. a piano accompaniment)
 * can't be scheduled all up-front - it stalls the audio thread enough to
 * hold the AudioContext clock in pre-roll. So we drip-feed only the next
 * SCHEDULE_LOOKAHEAD seconds and refill at SCHEDULE_INTERVAL.
 */
const SCHEDULE_LOOKAHEAD = 2.0;
const SCHEDULE_INTERVAL_MS = 250;

/**
 * Master gain when the MIDI slider is at 100%. The slider itself stays
 * 0-100 in the UI; this multiplier decides what 100% actually sounds like
 * in WebAudio terms. MusyngKite samples are normalized conservatively
 * (peaks around -6 to -12 dBFS), so we can sit well above unity without
 * clipping in practice.
 */
const MIDI_MAX_GAIN = 2.5;

/**
 * Backing-track gain when the backing slider is at 100%. We deliberately
 * cap below unity - the OGGs are already mastered loud and nobody needs
 * them at full recorded level.
 */
const BACKING_MAX_GAIN = 0.7;

/**
 * Synthetic hall-reverb impulse-response length and decay. ~2.6 s of
 * decaying noise is enough to make a sample-based piano sound like it's
 * sitting in a real room - long enough to bloom under sustain pedal, short
 * enough to not muddy fast passages. Stereo decorrelation between channels
 * gives a natural width.
 */
const REVERB_SECONDS = 2.6;
const REVERB_DECAY_POW = 2.6;

export class AudioEngine {
  readonly ac: AudioContext;
  private piano: Player | null = null;
  /** Gain node the soundfont piano routes through (controls MIDI volume). */
  private midiGain: GainNode;
  /** Gain node the OGG backing track routes through. */
  private backingGain: GainNode;
  /**
   * Convolution reverb on the MIDI bus, with a per-song wet-mix gain. Modeled
   * as a parallel send (midiGain -> reverb -> reverbWet -> destination) so the
   * dry signal is never coloured by the convolver - only the wet "room" is
   * added on top. Soundfont piano samples decay naturally to silence in 3-5 s
   * and have no sympathetic resonance, so without this the pedal extension
   * has nothing to bloom into and the classical pieces sound dry.
   */
  private reverb: ConvolverNode;
  private reverbWet: GainNode;
  private scheduled: { stop: (when?: number) => void }[] = [];
  /** AudioContext time when the song started (seconds). */
  private songStartAc = 0;
  private running = false;
  /** Background notes sorted by time, plus our streaming cursor. */
  private bg: MidiNote[] = [];
  private bgIdx = 0;
  private streamTimer: number | null = null;
  /** Optional backing track buffer (a recorded OGG/MP3 that plays on top of MIDI). */
  private backingBuffer: AudioBuffer | null = null;
  private backingSource: AudioBufferSourceNode | null = null;

  constructor() {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ac = new Ctx();
    this.midiGain = this.ac.createGain();
    this.midiGain.gain.value = 0.85 * MIDI_MAX_GAIN;
    this.midiGain.connect(this.ac.destination);
    this.backingGain = this.ac.createGain();
    this.backingGain.gain.value = 0.55 * BACKING_MAX_GAIN;
    this.backingGain.connect(this.ac.destination);
    // Parallel reverb send from the MIDI bus.
    this.reverb = this.ac.createConvolver();
    this.reverb.buffer = this.makeReverbIR();
    this.reverbWet = this.ac.createGain();
    this.reverbWet.gain.value = 0; // off until a song sets its wet amount
    this.midiGain.connect(this.reverb);
    this.reverb.connect(this.reverbWet);
    this.reverbWet.connect(this.ac.destination);
  }

  /**
   * Set the reverb wet-mix amount, 0..1. Per-song: classical pieces get
   * more space, pop tracks (which carry ambience in the OGG already) get
   * less. Smoothly ramped so changes between songs don't click.
   */
  setReverbAmount(v: number): void {
    const wet = Math.max(0, Math.min(1, v));
    this.reverbWet.gain.setTargetAtTime(wet, this.ac.currentTime, 0.05);
  }

  /**
   * Build a stereo decorrelated hall IR by generating exponentially-decaying
   * white noise. The two channels use independent noise streams so the wet
   * signal has a natural width without any explicit stereo trickery.
   */
  private makeReverbIR(): AudioBuffer {
    const sr = this.ac.sampleRate;
    const length = Math.max(1, Math.floor(sr * REVERB_SECONDS));
    const ir = this.ac.createBuffer(2, length, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        // (1 - t)^p gives a smooth perceptually-linear-ish decay.
        const env = Math.pow(1 - t, REVERB_DECAY_POW);
        data[i] = (Math.random() * 2 - 1) * env;
      }
    }
    return ir;
  }

  async load(): Promise<void> {
    // Note: `destination` is supported at runtime by soundfont-player but the
    // package's type defs omit it - cast through `as unknown as` to route the
    // piano output through our midiGain (so the MIDI volume slider works).
    this.piano = await Soundfont.instrument(this.ac, "acoustic_grand_piano", {
      soundfont: "MusyngKite",
      format: "mp3",
      destination: this.midiGain,
    } as unknown as Parameters<typeof Soundfont.instrument>[2]);
  }

  /**
   * Live MIDI master volume. `v` is a 0..1 slider fraction (the UI shows
   * it as 0-100%). Internally we scale by MIDI_MAX_GAIN so 100% is well
   * above unity gain - MusyngKite samples are too quiet otherwise.
   */
  setMidiVolume(v: number): void {
    const slider = Math.max(0, Math.min(1, v));
    this.midiGain.gain.setTargetAtTime(
      slider * MIDI_MAX_GAIN,
      this.ac.currentTime,
      0.02,
    );
  }

  /**
   * Live backing-track volume. `v` is a 0..1 slider fraction. Mapped to
   * 0..BACKING_MAX_GAIN, intentionally lower than 1 - the OGGs are loud
   * enough at recorded level that we never need 100% of it.
   */
  setBackingVolume(v: number): void {
    const slider = Math.max(0, Math.min(1, v));
    this.backingGain.gain.setTargetAtTime(
      slider * BACKING_MAX_GAIN,
      this.ac.currentTime,
      0.02,
    );
  }

  /**
   * Load an optional backing track from a URL (typically an OGG/MP3 of a
   * recorded performance). The track plays in parallel with MIDI playback.
   * Pass null to clear any previously loaded backing track.
   */
  async loadBacking(url: string | null): Promise<void> {
    this.backingBuffer = null;
    if (!url) return;
    try {
      const resolved = assetUrl(url);
      const res = await fetch(resolved);
      if (!res.ok) {
        console.warn(`Backing track fetch failed: ${res.status} ${resolved}`);
        return;
      }
      const buf = await res.arrayBuffer();
      // We use MP3 (not OGG) for backing tracks because Safari/iOS don't
      // decode OGG Vorbis via decodeAudioData. If decoding still fails for
      // any reason, the catch below swallows it so the song still plays
      // MIDI-only.
      this.backingBuffer = await this.ac.decodeAudioData(buf);
      console.log(
        `Backing track loaded: ${url} (${this.backingBuffer.duration.toFixed(1)}s)`,
      );
    } catch (err) {
      console.warn("Backing track failed to load/decode:", err);
      this.backingBuffer = null;
    }
  }

  /** Resume the AudioContext - must be called from a user gesture. */
  async resume(): Promise<void> {
    if (this.ac.state !== "running") await this.ac.resume();
  }

  /**
   * Suspend the AudioContext: freezes ac.currentTime, all scheduled notes,
   * and the backing track. Used by pause - everything resumes seamlessly
   * after `resume()` since the audio clock simply stops advancing.
   */
  async suspend(): Promise<void> {
    if (this.ac.state === "running") await this.ac.suspend();
  }

  /**
   * Begin the song: latch a shared clock origin and pre-schedule all
   * background notes. Returns the AudioContext time the song started at.
   */
  startSong(background: MidiNote[]): number {
    if (!this.piano) throw new Error("Audio not loaded");
    if (this.running) this.stopSong();
    this.running = true;
    // Pre-roll gives the player time to read incoming notes and lets the audio
    // graph warm up before t=0.
    this.songStartAc = this.ac.currentTime + 1.5;
    this.installBackground(background, 0);
    this.startBacking(0);
    return this.songStartAc;
  }

  private installBackground(background: MidiNote[], fromTime: number): void {
    this.bg = [...background].sort((a, b) => a.time - b.time);
    this.bgIdx = 0;
    while (this.bgIdx < this.bg.length && this.bg[this.bgIdx].time < fromTime) {
      this.bgIdx++;
    }
    this.pumpBackground();
    if (this.streamTimer != null) window.clearInterval(this.streamTimer);
    this.streamTimer = window.setInterval(
      () => this.pumpBackground(),
      SCHEDULE_INTERVAL_MS,
    );
  }

  private pumpBackground(): void {
    if (!this.piano) return;
    const horizon = this.ac.currentTime + SCHEDULE_LOOKAHEAD;
    while (this.bgIdx < this.bg.length) {
      const n = this.bg[this.bgIdx];
      const when = this.songStartAc + n.time;
      if (when > horizon) break;
      this.bgIdx++;
      if (when < this.ac.currentTime - 0.05) continue;
      const handle = this.piano.play(n.midi, Math.max(when, this.ac.currentTime), {
        duration: Math.max(0.05, n.duration),
        gain: 0.6 + 0.7 * n.velocity,
      });
      if (handle) this.scheduled.push(handle);
    }
    if (this.scheduled.length > 256) {
      this.scheduled = this.scheduled.slice(-256);
    }
  }

  private startBacking(fromTime: number): void {
    if (!this.backingBuffer) return;
    const src = this.ac.createBufferSource();
    src.buffer = this.backingBuffer;
    src.connect(this.backingGain);
    const when = Math.max(this.ac.currentTime, this.songStartAc + Math.max(0, fromTime));
    // If we're seeking past the natural start, use the offset param.
    const offset = Math.max(0, fromTime);
    if (when <= this.ac.currentTime + 0.01) {
      src.start(this.ac.currentTime, offset);
    } else {
      src.start(when, offset);
    }
    this.backingSource = src;
  }

  private stopBacking(): void {
    if (this.backingSource) {
      try {
        this.backingSource.stop();
      } catch {
        // already stopped
      }
      this.backingSource.disconnect();
      this.backingSource = null;
    }
  }

  /**
   * Seek to a new song time. Cancels currently-scheduled background notes
   * and reschedules notes whose start time is in the future relative to
   * `toTime`. Notes that were already partway through when we seeked are
   * skipped (slight gap in long sustains is acceptable for debug seeking).
   */
  seek(toTime: number, background: MidiNote[]): void {
    if (!this.piano) return;
    for (const h of this.scheduled) {
      try {
        h.stop(this.ac.currentTime);
      } catch {
        // already stopped
      }
    }
    this.scheduled = [];
    this.stopBacking();
    // Make songTime() return `toTime` from this point forward.
    this.songStartAc = this.ac.currentTime - toTime;
    this.installBackground(background, toTime);
    this.startBacking(toTime);
  }

  /** Returns seconds since the song started, by the audio clock. */
  songTime(): number {
    return this.ac.currentTime - this.songStartAc;
  }

  /** Triggers a chart-note's underlying MIDI notes immediately. */
  fireChartNote(notes: MidiNote[]): void {
    if (!this.piano) return;
    for (const n of notes) {
      this.piano.play(n.midi, this.ac.currentTime, {
        duration: Math.max(0.08, n.duration),
        gain: 0.7 + 0.7 * n.velocity,
      });
    }
  }

  stopSong(): void {
    this.running = false;
    if (this.streamTimer != null) {
      window.clearInterval(this.streamTimer);
      this.streamTimer = null;
    }
    this.bg = [];
    this.bgIdx = 0;
    for (const h of this.scheduled) {
      try {
        h.stop(this.ac.currentTime);
      } catch {
        // ignore - already stopped or never started
      }
    }
    this.scheduled = [];
    this.piano?.stop();
    this.stopBacking();
  }
}
