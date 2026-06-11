import { Midi } from "@tonejs/midi";
import type {
  Chart,
  ChartNote,
  CuratedChartJson,
  Difficulty,
  MidiNote,
} from "./types";
import { assetUrl } from "./assets";

interface DifficultyParams {
  /** Fraction of total notes selected as chart notes (by salience). */
  fraction: number;
  /** Hard max on local density (notes per second in a sliding 1s window). */
  localNpsCap: number;
  /** Add bass anchors on bar downbeats. */
  bassDownbeat: boolean;
  /** Additionally add bass on beat 3 (mid-bar). */
  bassMidbar: boolean;
  /** Max simultaneous chart notes per onset (chord cap). */
  maxLanes: number;
}

const DIFFICULTY_PARAMS: Record<Difficulty, DifficultyParams> = {
  easy: {
    fraction: 0.18,
    localNpsCap: 3,
    bassDownbeat: false,
    bassMidbar: false,
    maxLanes: 1,
  },
  normal: {
    fraction: 0.36,
    localNpsCap: 6,
    bassDownbeat: true,
    bassMidbar: false,
    maxLanes: 2,
  },
  hard: {
    fraction: 0.65,
    localNpsCap: 10,
    bassDownbeat: true,
    bassMidbar: true,
    maxLanes: 3,
  },
};

const CHORD_EPS_SEC = 0.03;
const SAME_LANE_MIN_GAP = 0.085;
const BEAT_SNAP_SEC = 0.04;
const LOCAL_WINDOW_SEC = 1.0;

/** Interval (semitones) at or above which we re-anchor instead of stepping. */
const REANCHOR_INTERVAL = 7;

interface ScoredNote extends MidiNote {
  score: number;
  voice: "melody" | "bass";
}

export async function loadChart(
  midiUrl: string,
  difficulty: Difficulty,
): Promise<Chart> {
  const buf = await fetch(assetUrl(midiUrl)).then((r) => r.arrayBuffer());
  const midi = new Midi(buf);
  return buildChart(midi, difficulty);
}

/**
 * Load a pre-built curated chart from JSON. The JSON carries everything
 * needed to play - chart notes (with audio data) and background notes -
 * so no MIDI parse is required at runtime.
 */
export async function loadCuratedChart(jsonUrl: string): Promise<Chart> {
  const json = (await fetch(assetUrl(jsonUrl)).then((r) =>
    r.json(),
  )) as CuratedChartJson;
  if (
    json.format !== "arabesque-rhythm/curated/v1" &&
    json.format !== "nocturne-rhythm/curated/v1" &&
    json.format !== "just-for-today-rhythm/curated/v1" &&
    json.format !== "waltz-for-tomorrow-rhythm/curated/v1"
  ) {
    throw new Error(`Unknown curated chart format: ${json.format}`);
  }
  let id = 0;
  const notes: ChartNote[] = json.notes.map((n) => ({
    time: n.t,
    lane: n.l,
    audioNotes: [
      {
        id: id++,
        time: n.t,
        duration: n.d,
        midi: n.m,
        velocity: n.v,
        track: 0,
      },
    ],
  }));
  const background: MidiNote[] = json.background.map((n) => ({
    id: id++,
    time: n.t,
    duration: n.d,
    midi: n.m,
    velocity: n.v,
    track: 0,
  }));
  return {
    notes,
    background,
    duration: json.duration,
    // Curated chart isn't tied to a difficulty in the same way; tag it as
    // "normal" so the engine picks a reasonable approach-time default.
    difficulty: "normal",
  };
}

export function buildChart(midi: Midi, difficulty: Difficulty): Chart {
  const params = DIFFICULTY_PARAMS[difficulty];

  const allNotes: MidiNote[] = [];
  let id = 0;
  midi.tracks.forEach((track, ti) => {
    for (const n of track.notes) {
      allNotes.push({
        id: id++,
        time: n.time,
        duration: n.duration,
        midi: n.midi,
        velocity: n.velocity,
        track: ti,
      });
    }
  });
  allNotes.sort((a, b) => a.time - b.time || b.midi - a.midi);

  if (allNotes.length === 0) {
    return { notes: [], background: [], duration: midi.duration, difficulty };
  }

  const beatTimes = buildBeatGrid(midi, allNotes);
  const tsigs = midi.header.timeSignatures;
  const beatsPerBar = (tsigs[0]?.timeSignature?.[0] as number | undefined) ?? 4;

  const pitchesSorted = allNotes.map((n) => n.midi).sort((a, b) => a - b);
  const loPitch = percentile(pitchesSorted, 0.05);
  const hiPitch = percentile(pitchesSorted, 0.95);
  const pitchSpan = Math.max(1, hiPitch - loPitch);

  // ---- 1. Score every note ----
  const scored: ScoredNote[] = allNotes.map((n) => ({
    ...n,
    score: salience(n, loPitch, pitchSpan, beatTimes),
    voice: "melody",
  }));

  // ---- 2. Salience-threshold selection with local density cap ----
  //
  // We sort by score descending and accept notes greedily, rejecting only when
  // a 1s sliding window around the candidate already has too many accepted
  // notes. This keeps whole melodic streams intact (they're all high-salience
  // together) while preventing local jams in fast passages.
  const targetCount = Math.min(
    Math.floor(allNotes.length * params.fraction),
    Math.floor(midi.duration * params.localNpsCap * 0.7),
  );
  const sortedByScore = [...scored].sort((a, b) => b.score - a.score);
  const acceptedTimes: number[] = []; // sorted ascending
  const acceptedIds = new Set<number>();
  for (const n of sortedByScore) {
    if (acceptedIds.size >= targetCount) break;
    if (densityAt(acceptedTimes, n.time, LOCAL_WINDOW_SEC) >= params.localNpsCap)
      continue;
    acceptedIds.add(n.id);
    insertSorted(acceptedTimes, n.time);
  }
  const melodyNotes = scored.filter((n) => acceptedIds.has(n.id));
  for (const n of melodyNotes) n.voice = "melody";

  // ---- 3. Bass anchors on selected beats (Normal/Hard) ----
  const bassNotes: ScoredNote[] = [];
  if (params.bassDownbeat || params.bassMidbar) {
    const bassThreshold = loPitch + pitchSpan * 0.30;
    for (let i = 0; i < beatTimes.length; i++) {
      const beatInBar = i % beatsPerBar;
      const onDownbeat = beatInBar === 0;
      const onMidbar = beatsPerBar >= 4 && beatInBar === Math.floor(beatsPerBar / 2);
      if (!(params.bassDownbeat && onDownbeat) && !(params.bassMidbar && onMidbar))
        continue;
      const t = beatTimes[i];
      const candidates = scored.filter(
        (n) =>
          n.time >= t - 0.06 &&
          n.time <= t + 0.14 &&
          n.midi <= bassThreshold,
      );
      if (!candidates.length) continue;
      candidates.sort((a, b) => a.midi - b.midi);
      const pick = { ...candidates[0], voice: "bass" as const };
      if (!acceptedIds.has(pick.id)) {
        bassNotes.push(pick);
        acceptedIds.add(pick.id);
      }
    }
  }

  // ---- 4. Combine and cluster simultaneous selected notes ----
  const all = [...melodyNotes, ...bassNotes].sort(
    (a, b) => a.time - b.time || a.midi - b.midi,
  );
  const clusters: ScoredNote[][] = [];
  for (const n of all) {
    const last = clusters[clusters.length - 1];
    if (last && n.time - last[0].time < CHORD_EPS_SEC) last.push(n);
    else clusters.push([n]);
  }
  // Cap chord size: keep top-scoring members.
  for (const c of clusters) {
    if (c.length > params.maxLanes) {
      c.sort((a, b) => b.score - a.score);
      c.length = params.maxLanes;
    }
  }

  // ---- 5. Interval-aware lane assignment ----
  //
  // Macro: each note has a "preferred" lane from pitch banding using the
  // selected-note range. Micro: walking through the chart, we shift ±1 lane
  // to reflect melodic motion (so stepwise melody snakes across lanes), and
  // break up jacks (3+ same-lane in 0.5s) by forcing an adjacent lane.
  const selectedFlat = clusters.flat();
  const selPitches = selectedFlat.map((n) => n.midi).sort((a, b) => a - b);
  const selLo = percentile(selPitches, 0.05);
  const selHi = percentile(selPitches, 0.95);
  const selSpan = Math.max(1, selHi - selLo);

  // Build placeholder chartNotes carrying lane=-1 to fill in.
  interface Placeholder {
    time: number;
    audioNote: ScoredNote;
    lane: number;
    isChord: boolean;
  }
  const placeholders: Placeholder[] = [];
  for (const cluster of clusters) {
    const ascending = [...cluster].sort((a, b) => a.midi - b.midi);
    const used = new Set<number>();
    const inChord = ascending.length > 1;
    for (const n of ascending) {
      const ideal = Math.floor(((n.midi - selLo) / selSpan) * 4);
      const preferred = clamp(ideal, 0, 3);
      let lane = -1;
      for (let d = 0; d < 4 && lane < 0; d++) {
        for (const c of d === 0 ? [preferred] : [preferred - d, preferred + d]) {
          if (c >= 0 && c < 4 && !used.has(c)) {
            lane = c;
            break;
          }
        }
      }
      if (lane < 0) continue;
      used.add(lane);
      placeholders.push({ time: n.time, audioNote: n, lane, isChord: inChord });
    }
  }

  // Interval shaping pass: for solo (non-chord) melody notes, shift ±1 lane
  // based on melodic motion and break jacks (3+ same-lane in 0.5s) by
  // forcing an adjacent lane. Chord notes keep pitch-banded assignments.
  let lastMelodyIdx = -1;
  let consecSameLane = 0;
  for (let i = 0; i < placeholders.length; i++) {
    const p = placeholders[i];
    if (p.isChord) {
      lastMelodyIdx = i;
      consecSameLane = 0;
      continue;
    }
    if (p.audioNote.voice === "bass") {
      // Bass stays in left half; keep its preferred lane (clamp to 0..1).
      p.lane = clamp(p.lane, 0, 1);
      continue;
    }

    if (lastMelodyIdx < 0) {
      lastMelodyIdx = i;
      consecSameLane = 1;
      continue;
    }
    const prev = placeholders[lastMelodyIdx];
    const interval = p.audioNote.midi - prev.audioNote.midi;

    let chosen: number;
    if (Math.abs(interval) >= REANCHOR_INTERVAL) {
      chosen = p.lane; // big leap - snap to pitch-band ideal
      consecSameLane = chosen === prev.lane ? consecSameLane + 1 : 1;
    } else if (interval === 0) {
      // Repeated pitch: jack on the prev lane up to a small limit.
      if (consecSameLane >= 3) {
        chosen = breakJack(prev.lane, placeholders, i);
        consecSameLane = 1;
      } else {
        chosen = prev.lane;
        consecSameLane++;
      }
    } else {
      const dir = interval > 0 ? 1 : -1;
      const magnitude = Math.abs(interval) >= 3 ? 2 : 1;
      const stepped = clamp(prev.lane + dir * magnitude, 0, 3);
      // Don't shrink macro: if pitch-band ideal is further in the same
      // direction, prefer that; if interval is small, prefer stepped.
      const idealDir = Math.sign(p.lane - prev.lane);
      if (idealDir === dir && Math.abs(p.lane - prev.lane) >= magnitude) {
        chosen = p.lane;
      } else {
        chosen = stepped;
      }
      consecSameLane = chosen === prev.lane ? consecSameLane + 1 : 1;
    }

    // Avoid colliding with a bass anchor that lives at the same instant on lane 0/1
    // (rare given the chord clustering above already merged simultaneous notes,
    // but a safety net for near-simultaneous bass + melody).
    if (chosen === 0 || chosen === 1) {
      const neighborBass = placeholders
        .slice(Math.max(0, i - 3), i)
        .some(
          (x) =>
            x.audioNote.voice === "bass" &&
            Math.abs(x.time - p.time) < 0.04 &&
            x.lane === chosen,
        );
      if (neighborBass) chosen = clamp(chosen + 1, 0, 3);
    }

    p.lane = chosen;
    lastMelodyIdx = i;
  }

  // ---- 6. Build ChartNote objects ----
  const chartIds = new Set<number>();
  const chartNotes: ChartNote[] = placeholders.map((p) => {
    chartIds.add(p.audioNote.id);
    return {
      time: p.time,
      lane: p.lane as 0 | 1 | 2 | 3,
      audioNotes: [stripScore(p.audioNote)],
    };
  });

  chartNotes.sort((a, b) => a.time - b.time);

  // ---- 7. Drop same-lane chart notes within SAME_LANE_MIN_GAP ----
  const lastByLane = [-Infinity, -Infinity, -Infinity, -Infinity];
  const survived: ChartNote[] = [];
  for (const n of chartNotes) {
    if (n.time - lastByLane[n.lane] < SAME_LANE_MIN_GAP) {
      for (const a of n.audioNotes) chartIds.delete(a.id);
      continue;
    }
    lastByLane[n.lane] = n.time;
    survived.push(n);
  }

  const background = allNotes.filter((n) => !chartIds.has(n.id));

  return {
    notes: survived,
    background,
    duration: midi.duration,
    difficulty,
  };
}

// ---------- helpers ----------

function stripScore(n: ScoredNote): MidiNote {
  const { score: _s, voice: _v, ...rest } = n;
  void _s;
  void _v;
  return rest;
}

interface TempoEvent {
  time: number;
  bpm: number;
}

function buildBeatGrid(midi: Midi, allNotes: MidiNote[]): number[] {
  const tempos: TempoEvent[] = midi.header.tempos.length
    ? midi.header.tempos.map((t) => ({
        time: midi.header.ticksToSeconds(t.ticks),
        bpm: t.bpm,
      }))
    : [{ time: 0, bpm: 120 }];
  tempos.sort((a, b) => a.time - b.time);

  const lastNote = allNotes[allNotes.length - 1];
  const end =
    Math.max(midi.duration, lastNote.time + lastNote.duration) || 1;
  const beats: number[] = [];
  let t = 0;
  let i = 0;
  while (t <= end + 0.1) {
    beats.push(t);
    while (i + 1 < tempos.length && tempos[i + 1].time <= t) i++;
    const bpm = tempos[i].bpm;
    t += 60 / bpm;
    if (beats.length > 1e5) break;
  }
  return beats;
}

function salience(
  n: MidiNote,
  loPitch: number,
  pitchSpan: number,
  beatTimes: number[],
): number {
  const durationScore = Math.log(1 + n.duration) * 2.5;
  const pitchPct = clamp((n.midi - loPitch) / pitchSpan, 0, 1);
  const pitchScore = pitchPct * 1.2;
  const velocityScore = n.velocity * 0.6;
  const onBeat = isNearAnyBeat(n.time, beatTimes, BEAT_SNAP_SEC) ? 0.5 : 0;
  return durationScore + pitchScore + velocityScore + onBeat;
}

function isNearAnyBeat(time: number, beats: number[], tol: number): boolean {
  let lo = 0;
  let hi = beats.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < time - tol) lo = mid + 1;
    else if (beats[mid] > time + tol) hi = mid - 1;
    else return true;
  }
  return false;
}

function densityAt(sortedTimes: number[], t: number, window: number): number {
  const lo = lowerBound(sortedTimes, t - window / 2);
  const hi = lowerBound(sortedTimes, t + window / 2);
  return hi - lo;
}

function insertSorted(arr: number[], v: number): void {
  const i = lowerBound(arr, v);
  arr.splice(i, 0, v);
}

function lowerBound(arr: number[], v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = clamp(Math.floor(p * (sortedAsc.length - 1)), 0, sortedAsc.length - 1);
  return sortedAsc[idx];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function breakJack(
  prevLane: number,
  placeholders: { time: number; lane: number; audioNote: ScoredNote }[],
  i: number,
): number {
  // Pick adjacent lane with lower recent usage.
  const left = prevLane - 1;
  const right = prevLane + 1;
  const leftValid = left >= 0;
  const rightValid = right <= 3;
  if (!leftValid && !rightValid) return prevLane;
  if (!leftValid) return right;
  if (!rightValid) return left;
  const look = placeholders.slice(Math.max(0, i - 6), i);
  const recentLeft = look.filter((p) => p.lane === left).length;
  const recentRight = look.filter((p) => p.lane === right).length;
  return recentLeft <= recentRight ? left : right;
}
