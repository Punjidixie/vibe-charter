import type { Chart, ChartNote, Judgment, JudgmentResult } from "./types";
import { JUDGE_WINDOWS_MS, KEY_FOR_LANE } from "./types";

export interface JudgeEvent {
  kind: "hit" | "miss";
  judgment: Judgment;
  deltaMs: number;
  note: ChartNote;
}

type Listener = (e: JudgeEvent) => void;
type KeyListener = (lane: 0 | 1 | 2 | 3) => void;

export class InputJudge {
  private laneQueues: ChartNote[][] = [[], [], [], []];
  private cursors: [number, number, number, number] = [0, 0, 0, 0];
  /** Lanes currently held by the player (for render highlight). */
  readonly held: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  private listeners: Listener[] = [];
  private keyListeners: KeyListener[] = [];
  private offsetSec = 0;
  private active = false;
  private boundKeyDown = (e: KeyboardEvent) => this.onKeyDown(e);
  private boundKeyUp = (e: KeyboardEvent) => this.onKeyUp(e);

  constructor(chart: Chart) {
    for (const n of chart.notes) this.laneQueues[n.lane].push(n);
    for (const q of this.laneQueues) q.sort((a, b) => a.time - b.time);
  }

  setOffsetMs(ms: number): void {
    this.offsetSec = ms / 1000;
  }

  onJudge(fn: Listener): void {
    this.listeners.push(fn);
  }

  onKeyHit(fn: KeyListener): void {
    this.keyListeners.push(fn);
  }

  attach(): void {
    if (this.active) return;
    this.active = true;
    window.addEventListener("keydown", this.boundKeyDown);
    window.addEventListener("keyup", this.boundKeyUp);
  }

  detach(): void {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener("keydown", this.boundKeyDown);
    window.removeEventListener("keyup", this.boundKeyUp);
    this.held[0] = this.held[1] = this.held[2] = this.held[3] = false;
  }

  /**
   * Update tick - call once per frame with the current uncorrected song time.
   * Any chart notes that have aged past the Good window become auto-misses.
   */
  tick(songTime: number): void {
    const goodSec = JUDGE_WINDOWS_MS.good / 1000;
    const cutoff = songTime - goodSec;
    for (let lane = 0; lane < 4; lane++) {
      const q = this.laneQueues[lane];
      while (this.cursors[lane] < q.length && q[this.cursors[lane]].time < cutoff) {
        const note = q[this.cursors[lane]];
        this.cursors[lane]++;
        this.emit({
          kind: "miss",
          judgment: "miss",
          deltaMs: (songTime - note.time) * 1000,
          note,
        });
      }
    }
  }

  /**
   * Pending (un-judged) chart notes per lane - the renderer reads this to
   * draw remaining note bars.
   */
  pendingByLane(lane: 0 | 1 | 2 | 3): ChartNote[] {
    return this.laneQueues[lane].slice(this.cursors[lane]);
  }

  /**
   * Reset cursors so that all notes with time >= toTime are pending again.
   * Notes just before toTime are also kept pending (within 50ms) so the
   * player isn't auto-missed on a note they could still hit when seeking.
   */
  seek(toTime: number): void {
    for (let lane = 0; lane < 4; lane++) {
      const q = this.laneQueues[lane];
      let idx = 0;
      while (idx < q.length && q[idx].time < toTime - 0.05) idx++;
      this.cursors[lane] = idx;
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;
    const lane = KEY_FOR_LANE.indexOf(e.key.toLowerCase() as typeof KEY_FOR_LANE[number]);
    if (lane < 0) return;
    e.preventDefault();
    this.held[lane] = true;
    for (const fn of this.keyListeners) fn(lane as 0 | 1 | 2 | 3);
  }

  private onKeyUp(e: KeyboardEvent): void {
    const lane = KEY_FOR_LANE.indexOf(e.key.toLowerCase() as typeof KEY_FOR_LANE[number]);
    if (lane < 0) return;
    this.held[lane] = false;
  }

  /**
   * Called from outside (the engine) with the current song time when a key
   * is pressed. Returns the judgment result if a note was hit, or null for
   * a stray (silent, no penalty).
   */
  tryHit(lane: 0 | 1 | 2 | 3, songTime: number): JudgmentResult | null {
    const effective = songTime + this.offsetSec;
    const q = this.laneQueues[lane];
    const idx = this.cursors[lane];
    if (idx >= q.length) return null;
    const note = q[idx];
    const deltaMs = (effective - note.time) * 1000;
    const abs = Math.abs(deltaMs);
    if (abs > JUDGE_WINDOWS_MS.good) return null; // stray
    let judgment: Judgment = "good";
    if (abs <= JUDGE_WINDOWS_MS.perfect) judgment = "perfect";
    else if (abs <= JUDGE_WINDOWS_MS.great) judgment = "great";
    this.cursors[lane]++;
    const result: JudgmentResult = { judgment, deltaMs, note };
    this.emit({ kind: "hit", judgment, deltaMs, note });
    return result;
  }

  private emit(e: JudgeEvent): void {
    for (const fn of this.listeners) fn(e);
  }
}
