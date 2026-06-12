import { AudioEngine } from "./audio";
import { InputJudge, type JudgeEvent } from "./input";
import { Renderer } from "./render";
import type { Chart, Judgment, ScoreState, Settings } from "./types";
import { MAX_SCORE, NOTE_WEIGHT } from "./types";

const APPROACH_TIME_BY_DIFFICULTY = {
  easy: 1.75,
  normal: 1.55,
  hard: 1.35,
};

/**
 * Convert a note-speed slider value (4..20, 10 = natural) into the visual
 * approach time in seconds for a given chart difficulty. Faster speed =
 * shorter approach time = notes fall faster (but the song clock and judge
 * windows are unchanged - this is purely visual).
 */
function approachTimeFor(
  difficulty: keyof typeof APPROACH_TIME_BY_DIFFICULTY,
  noteSpeed: number,
): number {
  const base = APPROACH_TIME_BY_DIFFICULTY[difficulty];
  const safeSpeed = Math.max(1, noteSpeed);
  return base * (10 / safeSpeed);
}

export type EngineEvent =
  | { kind: "ready" }
  | { kind: "tick"; songTime: number; preroll: boolean; score: ScoreState }
  | { kind: "judge"; event: JudgeEvent; score: ScoreState }
  | { kind: "finished"; score: ScoreState };

export class GameEngine {
  readonly score: ScoreState;
  private rafId = 0;
  private running = false;
  private paused = false;
  private pauseStartedAt = 0;
  private lastFrame = 0;
  private startedAt = 0;
  private input: InputJudge;
  private audio: AudioEngine;
  private renderer: Renderer;
  private canvas: HTMLCanvasElement;
  private listeners: ((e: EngineEvent) => void)[] = [];
  private finishedFired = false;
  /** Active mouse/pen pointer-id -> lane. Touches use the separate touchLanes map. */
  private pointerLanes = new Map<number, 0 | 1 | 2 | 3>();
  /** Active touch-identifier -> lane. */
  private touchLanes = new Map<number, 0 | 1 | 2 | 3>();
  private pointerAttached = false;
  private boundPointerDown = (e: PointerEvent) => this.onPointerDown(e);
  private boundPointerEnd = (e: PointerEvent) => this.onPointerEnd(e);
  private boundTouchStart = (e: TouchEvent) => this.onTouchStart(e);
  private boundTouchEnd = (e: TouchEvent) => this.onTouchEnd(e);

  constructor(
    canvas: HTMLCanvasElement,
    private chart: Chart,
    settings: Settings,
    audio: AudioEngine,
  ) {
    this.canvas = canvas;
    this.audio = audio;
    this.score = {
      score: 0,
      combo: 0,
      maxCombo: 0,
      counts: { perfect: 0, great: 0, good: 0, miss: 0 },
      totalNotes: chart.notes.length,
    };
    this.renderer = new Renderer(canvas, {
      approachTimeSec: approachTimeFor(chart.difficulty, settings.noteSpeed),
    });
    this.input = new InputJudge(chart);
    this.input.setOffsetMs(settings.offsetMs);
    this.input.onJudge((e) => this.handleJudge(e));
    this.input.onKeyHit((lane) => this.handleKey(lane));
  }

  /** Live-tweak note fall speed. Pure visual; does not affect judgment. */
  setNoteSpeed(noteSpeed: number): void {
    this.renderer.setApproachTime(
      approachTimeFor(this.chart.difficulty, noteSpeed),
    );
  }

  on(fn: (e: EngineEvent) => void): void {
    this.listeners.push(fn);
  }

  async start(): Promise<void> {
    await this.audio.resume();
    this.input.attach();
    this.attachPointerInput();
    this.audio.startSong(this.chart.background);
    this.running = true;
    this.startedAt = performance.now();
    this.lastFrame = this.startedAt;
    this.emit({ kind: "ready" });
    this.rafId = requestAnimationFrame(() => this.loop());
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.input.detach();
    this.detachPointerInput();
    this.audio.stopSong();
  }

  /**
   * Freeze the game: stop the render loop, detach input, and suspend the
   * AudioContext so songTime and any scheduled audio also freeze. The
   * caller (UI) should show a pause overlay.
   */
  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.input.detach();
    this.detachPointerInput();
    this.pauseStartedAt = performance.now();
    // Fire-and-forget; ac.suspend resolves quickly.
    void this.audio.suspend();
  }

  /**
   * Unfreeze and continue from where we paused. Shifts `startedAt` and
   * `lastFrame` forward by the pause duration so wall-clock effects don't
   * skip ahead - songTime itself is driven by the audio clock which was
   * frozen during suspend, so it resumes naturally.
   */
  async resumeFromPause(): Promise<void> {
    if (!this.paused) return;
    this.paused = false;
    await this.audio.resume();
    const pauseDur = performance.now() - this.pauseStartedAt;
    this.startedAt += pauseDur;
    this.lastFrame = performance.now();
    this.input.attach();
    this.attachPointerInput();
    this.running = true;
    this.rafId = requestAnimationFrame(() => this.loop());
  }

  /** True if the run loop is actively ticking (not paused, not finished). */
  get isRunning(): boolean {
    return this.running;
  }

  /** True if the game is currently in the paused state. */
  get isPaused(): boolean {
    return this.paused;
  }

  /** Jump song playback (and chart visuals) to a new time in seconds. */
  seek(toTime: number): void {
    const clamped = Math.max(0, Math.min(this.chart.duration, toTime));
    this.audio.seek(clamped, this.chart.background);
    this.input.seek(clamped);
    this.renderer.clearEffects();
    this.finishedFired = false;
  }

  /** Total duration in seconds (for the progress bar). */
  get duration(): number {
    return this.chart.duration;
  }

  private loop(): void {
    if (!this.running) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const elapsed = (now - this.startedAt) / 1000;

    const songTime = this.audio.songTime();
    const preroll = songTime < 0;
    if (!preroll) this.input.tick(songTime);
    this.renderer.draw(songTime, this.input, dt, elapsed);

    this.emit({ kind: "tick", songTime, preroll, score: this.score });

    if (!this.finishedFired && songTime > this.chart.duration + 1.5) {
      this.finishedFired = true;
      this.emit({ kind: "finished", score: { ...this.score, counts: { ...this.score.counts } } });
      this.stop();
      return;
    }

    this.rafId = requestAnimationFrame(() => this.loop());
  }

  private handleKey(lane: 0 | 1 | 2 | 3): void {
    const songTime = this.audio.songTime();
    if (songTime < 0) return;
    this.input.tryHit(lane, songTime);
  }

  private handleJudge(e: JudgeEvent): void {
    if (e.kind === "hit") {
      this.audio.fireChartNote(e.note.audioNotes);
      this.applyJudgment(e.judgment, e.note.lane);
      this.renderer.spawnHit(e.note.lane, e.judgment, e.deltaMs);
    } else {
      this.applyJudgment("miss", e.note.lane);
      this.renderer.spawnMiss(e.note.lane);
    }
    this.emit({
      kind: "judge",
      event: e,
      score: { ...this.score, counts: { ...this.score.counts } },
    });
  }

  private applyJudgment(j: Judgment, _lane: 0 | 1 | 2 | 3): void {
    this.score.counts[j]++;
    // Cytus scoring: every note is worth (MAX_SCORE / notesTotal) scaled by
    // the judgment weight. Final running score is rounded only at display.
    const perNote = MAX_SCORE / Math.max(1, this.score.totalNotes);
    this.score.score += perNote * NOTE_WEIGHT[j];
    if (j === "miss") {
      this.score.combo = 0;
    } else {
      this.score.combo++;
      if (this.score.combo > this.score.maxCombo) {
        this.score.maxCombo = this.score.combo;
      }
    }
  }

  private emit(e: EngineEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  /**
   * Wire two input paths on the canvas so taps near the judgment line trigger
   * the corresponding lane:
   *   - Pointer Events for mouse / pen / trackpad (uniform desktop input).
   *   - Raw Touch Events for fingers. On iOS Safari, rapid multi-touch
   *     Pointer Events get dropped during fast arpeggios, while Touch
   *     Events deliver every contact reliably. We preventDefault on
   *     touchstart so synthetic mouse events don't double-fire, and skip
   *     pointerdown with pointerType==='touch' so the same finger isn't
   *     processed by both paths.
   * Multi-touch is supported via per-id lane maps so each finger releases
   * the right lane.
   */
  private attachPointerInput(): void {
    if (this.pointerAttached) return;
    this.pointerAttached = true;
    this.canvas.addEventListener("pointerdown", this.boundPointerDown);
    this.canvas.addEventListener("pointerup", this.boundPointerEnd);
    this.canvas.addEventListener("pointercancel", this.boundPointerEnd);
    this.canvas.addEventListener("pointerleave", this.boundPointerEnd);
    this.canvas.addEventListener("touchstart", this.boundTouchStart, {
      passive: false,
    });
    this.canvas.addEventListener("touchend", this.boundTouchEnd);
    this.canvas.addEventListener("touchcancel", this.boundTouchEnd);
  }

  private detachPointerInput(): void {
    if (!this.pointerAttached) return;
    this.pointerAttached = false;
    this.canvas.removeEventListener("pointerdown", this.boundPointerDown);
    this.canvas.removeEventListener("pointerup", this.boundPointerEnd);
    this.canvas.removeEventListener("pointercancel", this.boundPointerEnd);
    this.canvas.removeEventListener("pointerleave", this.boundPointerEnd);
    this.canvas.removeEventListener("touchstart", this.boundTouchStart);
    this.canvas.removeEventListener("touchend", this.boundTouchEnd);
    this.canvas.removeEventListener("touchcancel", this.boundTouchEnd);
    for (const lane of this.pointerLanes.values()) this.input.releaseLane(lane);
    this.pointerLanes.clear();
    for (const lane of this.touchLanes.values()) this.input.releaseLane(lane);
    this.touchLanes.clear();
  }

  private onPointerDown(e: PointerEvent): void {
    // Fingers are handled by the raw touch path; skip here to prevent the
    // same physical tap from firing twice.
    if (e.pointerType === "touch") return;
    const lane = this.renderer.laneFromPoint(e.clientX, e.clientY);
    if (lane == null) return;
    e.preventDefault();
    this.pointerLanes.set(e.pointerId, lane);
    this.input.pressLane(lane);
  }

  private onPointerEnd(e: PointerEvent): void {
    const lane = this.pointerLanes.get(e.pointerId);
    if (lane == null) return;
    this.pointerLanes.delete(e.pointerId);
    this.input.releaseLane(lane);
  }

  private onTouchStart(e: TouchEvent): void {
    // Suppress synthetic mouse / click events from this touch sequence so
    // the rest of the page doesn't react to taps on lanes.
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const lane = this.renderer.laneFromPoint(t.clientX, t.clientY);
      if (lane == null) continue;
      this.touchLanes.set(t.identifier, lane);
      this.input.pressLane(lane);
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const lane = this.touchLanes.get(t.identifier);
      if (lane == null) continue;
      this.touchLanes.delete(t.identifier);
      this.input.releaseLane(lane);
    }
  }
}

export function computeAccuracy(s: ScoreState): number {
  const judged = s.counts.perfect + s.counts.great + s.counts.good + s.counts.miss;
  if (judged === 0) return 0;
  const weight =
    s.counts.perfect * NOTE_WEIGHT.perfect +
    s.counts.great * NOTE_WEIGHT.great +
    s.counts.good * NOTE_WEIGHT.good;
  return weight / judged;
}

export function computeGrade(s: ScoreState): string {
  const a = computeAccuracy(s);
  if (a >= 0.95) return "S";
  if (a >= 0.9) return "A";
  if (a >= 0.8) return "B";
  if (a >= 0.7) return "C";
  return "D";
}
