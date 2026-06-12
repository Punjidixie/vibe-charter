// 100% hand-designed Arabesque chart.
//
// Every chart note in this file is an explicit pick(time, lane) call I made
// by reading the MIDI bar by bar. There is NO algorithmic fill, NO salience
// scoring, NO interval-aware lane shaper. Each note's lane is my deliberate
// choice based on:
//   - melodic direction (ascending pitches climb lanes 0->3, descending
//     fall 3->0)
//   - the role of the note in the phrase (anchor, embellishment, bass)
//   - the visual gesture I want the player to trace
//
// MIDI notes not picked become background audio that plays automatically.
//
// Output: public/curated-chart.json

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { applyPedalSustain } from "./pedal.mjs";
const require = createRequire(import.meta.url);
const { Midi } = require("@tonejs/midi");

const buf = readFileSync(new URL("../public/arabesque.mid", import.meta.url));
const midi = new Midi(buf);

// `all` holds wrapper objects (copies of MIDI note fields) - we read
// `duration` from these throughout the build for heuristics like
// `isMelodyAnchored`, so we need a stable snapshot of the original
// durations *before* applying pedal extension. The pedal pass runs
// later, just before output, so the emitted JSON has pedal-extended
// durations but the chart-building heuristics still see the score's
// original durations.
const all = midi.tracks.flatMap((t, ti) =>
  t.notes.map((n) => ({
    time: n.time,
    duration: n.duration,
    midi: n.midi,
    velocity: n.velocity,
    track: ti,
    midiRef: n, // for pedal pass to look up extended duration later
  })),
);
all.sort((a, b) => a.time - b.time || b.midi - a.midi);

const used = new Set();
const chart = [];

// pick(time, lane, opts?) - select the MIDI note nearest `time` (optionally
// restricted by pitch range) and add it to the chart on `lane`. If a pitch
// range is given, picks the closest-in-time note whose pitch falls in that
// range. Each MIDI event can only be picked once.
function pick(time, lane, opts = {}) {
  const window = opts.window ?? 0.10;
  const minP = opts.minP ?? 0;
  const maxP = opts.maxP ?? 127;
  let best = null;
  let bestDist = Infinity;
  for (const n of all) {
    if (used.has(n)) continue;
    if (n.midi < minP || n.midi > maxP) continue;
    const d = Math.abs(n.time - time);
    if (d > window) continue;
    if (d < bestDist) {
      best = n;
      bestDist = d;
    }
  }
  if (!best) {
    console.warn(
      `MISS  t=${time.toFixed(3)}s lane=${lane} pitch=[${minP},${maxP}]`,
    );
    return;
  }
  used.add(best);
  chart.push({ note: best, lane });
}

// Helper: time of (1-indexed bar number, beat position 0-3.99).
// 120 BPM 4/4: 1 beat = 0.5s, 1 bar = 2.0s. Bar 1 starts at t=0.
const BEAT = 0.5;
const BAR = 2.0;
function t(bar, beat) {
  return (bar - 1) * BAR + beat * BEAT;
}

// ============================================================
// SECTION A1: Opening arpeggios (bars 1-3)
// The arpeggio figure IS the melody here. Chart it as a sweeping
// gesture: ascending lanes 0->3, peak, then mirror descent 3->0.
// ============================================================

// Bar 1: silent pickup (no chart notes - players watch the song start)

// Bar 2: rising C#-major arpeggio C#4-G#5, then descending mirror
pick(t(2, 0.00), 0); // C#4
pick(t(2, 0.43), 1); // E4
pick(t(2, 0.77), 2); // A4
pick(t(2, 1.07), 3); // C#5
pick(t(2, 1.65), 3); // F#5 (continued climb at top lane)
pick(t(2, 1.95), 3); // G#5 PEAK
pick(t(2, 2.54), 2); // B4 (descent)
pick(t(2, 3.07), 1); // D#4
pick(t(2, 3.60), 0); // A3 (bottom)

// Bar 3: F#-minor arpeggio rise, descent into bass anchor
pick(t(3, 0.21), 0); // F#4 (low entry)
pick(t(3, 0.50), 1); // A4
pick(t(3, 0.73), 2); // C#5
pick(t(3, 1.04), 3); // D#5
pick(t(3, 1.40), 3); // E5 (peak)
pick(t(3, 1.91), 1); // G#4 (descent)
pick(t(3, 2.23), 0); // E4
pick(t(3, 3.18), 0); // F#3 (bass arrival, long)

// ============================================================
// SECTION A2: Melody enters above arpeggios (bars 4-6)
// Now the RH has sustained melodic notes (C#5, F#5, A5) on top
// of the arpeggio figure. Chart focuses on the melody plus a
// few selected supporting notes from the arpeggio.
// ============================================================

// Bar 4: C#5 and F#5 melodic anchors with arpeggios beneath
pick(t(4, 0.08), 3, { minP: 71, maxP: 76 }); // C#5 (melody)
pick(t(4, 0.43), 1); // F#4 (arpeggio support)
pick(t(4, 0.78), 2); // A4
pick(t(4, 1.14), 3, { minP: 76 }); // F#5 (melody peak)
pick(t(4, 1.56), 0); // A3 (bass)
pick(t(4, 2.26), 3, { minP: 71 }); // C#5 (melody returns)
pick(t(4, 3.07), 0); // D#3 (bass)
pick(t(4, 3.96), 3, { minP: 71 }); // C#5

// Bar 5: F#5 then A5 — building to climax
pick(t(5, 0.27), 1); // F#4
pick(t(5, 0.57), 2); // A4
pick(t(5, 0.85), 3, { minP: 76 }); // F#5 (sustained melody)
pick(t(5, 1.61), 1); // E4
pick(t(5, 2.03), 3, { minP: 79 }); // A5 (NEW MELODIC PEAK)
pick(t(5, 2.76), 2); // C#5
pick(t(5, 3.50), 0); // F#3 (bass)

// Bar 6: A5 SUSTAINED CLIMAX over rising arpeggio underneath
pick(t(6, 0.29), 3, { minP: 79 }); // A5 (the famous high A, 1.89s long!)
pick(t(6, 0.31), 0); // C#4 (arpeggio under A5)
pick(t(6, 0.71), 1); // D#4
pick(t(6, 1.10), 1); // F#4
pick(t(6, 1.55), 2); // A4
pick(t(6, 1.99), 2); // C#5
pick(t(6, 2.57), 2); // D#5
pick(t(6, 3.95), 3, { minP: 79 }); // G#5 (gesture climbs again)

// ============================================================
// SECTION A3: Bridge with descending sequences (bars 7-11)
// The melody descends through C#5, B4, A4 patterns. Chart the
// melodic descent with falling lane patterns.
// ============================================================

// Bar 7: sparse, F#5 sustained melody
pick(t(7, 1.00), 3, { minP: 76 }); // F#5 (long sustained)
pick(t(7, 2.52), 0); // E2 (bass entry)
pick(t(7, 3.74), 3, { minP: 73 }); // E5

// Bar 8: dense descending arpeggio with embedded melody
pick(t(8, 0.16), 3, { minP: 76 }); // F#5
pick(t(8, 0.46), 2); // C#5
pick(t(8, 0.76), 3, { minP: 76 }); // E5
pick(t(8, 1.05), 2); // B4
pick(t(8, 1.31), 3, { minP: 71 }); // C#5
pick(t(8, 1.58), 1); // G#4
pick(t(8, 1.87), 2); // B4
pick(t(8, 2.14), 1); // F#4
pick(t(8, 2.41), 1); // G#4
pick(t(8, 2.71), 0); // E4
pick(t(8, 3.24), 1); // D#4 (long sustained)

// Bar 9: sparser, descending into bass
pick(t(9, 0.17), 0); // C#4
pick(t(9, 1.23), 0); // C#4 (sustained)
pick(t(9, 2.24), 2); // B3 (with E2 bass)
pick(t(9, 3.38), 3, { minP: 73 }); // E5 (melody returns)
pick(t(9, 3.79), 3, { minP: 76 }); // F#5

// Bar 10: parallel to bar 8, descending
pick(t(10, 0.07), 2); // C#5
pick(t(10, 0.39), 3, { minP: 73 }); // E5
pick(t(10, 0.67), 2); // B4
pick(t(10, 0.93), 3, { minP: 71 }); // C#5
pick(t(10, 1.22), 1); // G#4
pick(t(10, 1.48), 2); // B4
pick(t(10, 1.79), 0); // F#4
pick(t(10, 2.07), 1); // G#4
pick(t(10, 2.37), 0); // E4
pick(t(10, 2.64), 2); // G#4 (melodic repetition)
pick(t(10, 2.93), 1); // D#4 (sustained)

// Bar 11: resolving, sparse
pick(t(11, 1.04), 1); // C#4
pick(t(11, 1.90), 2); // B3
pick(t(11, 2.25), 0); // A3
pick(t(11, 2.60), 2); // B3
pick(t(11, 3.01), 1); // C#4

// ============================================================
// SECTION A4: Climbing back up (bars 12-15)
// New melodic line E4 / D#4 / E4 with G#4 anchor, building.
// ============================================================

// Bar 12: E4 / D#4 / E4 / G#4 melodic line
pick(t(12, 0.46), 1); // E4
pick(t(12, 0.85), 1); // D#4
pick(t(12, 1.31), 2); // E4
pick(t(12, 1.76), 1); // C#4
pick(t(12, 2.60), 3, { minP: 67 }); // G#4 (long anchor)
pick(t(12, 3.50), 2); // B3
pick(t(12, 3.92), 1); // G#3

// Bar 13: E4 / D#4 / E4 / G#4 / F#4 ascending sequence
pick(t(13, 0.40), 1); // E4
pick(t(13, 1.17), 2); // D#4
pick(t(13, 1.46), 1); // C#4
pick(t(13, 1.75), 2); // D#4
pick(t(13, 2.11), 3, { minP: 63 }); // E4 (sustained)
pick(t(13, 2.92), 1); // C#4
pick(t(13, 3.35), 3, { minP: 67 }); // G#4
pick(t(13, 3.79), 2); // F#4

// Bar 14: G#4 / E4 / C#5 ascending then climax
pick(t(14, 0.17), 3, { minP: 67 }); // G#4
pick(t(14, 0.55), 1); // E4
pick(t(14, 1.38), 3, { minP: 71 }); // C#5 (long anchor)
pick(t(14, 2.70), 0); // F#3
pick(t(14, 3.05), 2); // A#4
pick(t(14, 3.39), 3, { minP: 71 }); // C#5
pick(t(14, 3.64), 2); // A#4
pick(t(14, 3.95), 3, { minP: 67 }); // G#4

// Bar 15: E5 / C#5 / G#5 climbing peak
pick(t(15, 0.76), 3, { minP: 73 }); // E5 (long)
pick(t(15, 1.13), 2); // G#4
pick(t(15, 1.54), 0); // F#3
pick(t(15, 1.96), 1); // C#4
pick(t(15, 2.27), 2); // C#5
pick(t(15, 2.60), 3, { minP: 73 }); // E5
pick(t(15, 2.90), 2); // C#5
pick(t(15, 3.20), 3, { minP: 79 }); // G#5 PEAK

// ============================================================
// SECTION A5: Continuing climb to A5 then descent (bars 16-22)
// ============================================================

// Bar 16: F#5 / G#5 alternating
pick(t(16, 0.43), 3, { minP: 76 }); // F#5
pick(t(16, 0.85), 3, { minP: 79 }); // G#5
pick(t(16, 1.28), 1); // F#4
pick(t(16, 1.65), 2); // A#4
pick(t(16, 2.05), 3, { minP: 76 }); // F#5
pick(t(16, 2.63), 3, { minP: 79 }); // G#5
pick(t(16, 3.08), 1); // E4
pick(t(16, 3.58), 2); // G#4

// Bar 17: sustained F#5 / G#5 climax
pick(t(17, 0.04), 2); // C#5
pick(t(17, 0.07), 3, { minP: 76 }); // F#5
pick(t(17, 0.73), 3, { minP: 79 }); // G#5
pick(t(17, 1.52), 3, { minP: 76 }); // F#5 (very long)
pick(t(17, 2.31), 1); // A#4
pick(t(17, 3.22), 3, { minP: 79 }); // G#5

// Bar 18: A5 + descending arpeggio
pick(t(18, 0.59), 1); // C#4
pick(t(18, 0.60), 3, { minP: 79 }); // A5
pick(t(18, 1.17), 1); // E4
pick(t(18, 1.52), 2); // A4
pick(t(18, 1.90), 2); // C#5
pick(t(18, 2.25), 3, { minP: 73 }); // E5
pick(t(18, 2.81), 3, { minP: 79 }); // G#5
pick(t(18, 3.16), 3, { minP: 73 }); // D#5
pick(t(18, 3.46), 2); // B4
pick(t(18, 3.65), 1); // G#4
pick(t(18, 3.98), 0); // D#4

// Bar 19: F#5 anchor with descending arpeggio
pick(t(19, 0.55), 3, { minP: 76 }); // F#5 (long anchor)
pick(t(19, 0.90), 0); // C#4
pick(t(19, 1.17), 1); // F#4
pick(t(19, 1.48), 2); // A4
pick(t(19, 1.78), 2); // C#5
pick(t(19, 2.43), 3, { minP: 73 }); // E5
pick(t(19, 2.78), 2); // B4
pick(t(19, 3.03), 1); // G#4
pick(t(19, 3.35), 0); // E4

// Bar 20: D#5 / G#5 / B5 climbing
pick(t(20, 0.48), 3, { minP: 73 }); // D#5 (long)
pick(t(20, 0.91), 1); // C#4
pick(t(20, 1.47), 2); // A#4
pick(t(20, 2.31), 3, { minP: 73 }); // E5
pick(t(20, 2.66), 1); // C#4
pick(t(20, 3.20), 3, { minP: 79 }); // G#5
pick(t(20, 3.40), 2); // B4
pick(t(20, 3.77), 3, { minP: 81 }); // B5 PEAK

// Bar 21: D#5 sustained / climbing E5
pick(t(21, 0.31), 0); // G3
pick(t(21, 0.51), 3, { minP: 73 }); // D#5 (very long)
pick(t(21, 1.59), 2); // A#4
pick(t(21, 2.70), 0); // E3
pick(t(21, 3.26), 2); // C#5
pick(t(21, 3.80), 1); // G#4
pick(t(21, 3.83), 3, { minP: 73 }); // E5

// Bar 22: G#5 / B4 / A4 descending pattern
pick(t(22, 0.35), 3, { minP: 79 }); // G#5
pick(t(22, 0.83), 2); // B4 (long)
pick(t(22, 1.22), 0); // A3
pick(t(22, 1.83), 1); // F#4
pick(t(22, 2.17), 2); // B3
pick(t(22, 2.99), 0); // C#3 (bass long)
pick(t(22, 3.57), 3, { minP: 67 }); // A4

// ============================================================
// SECTION B1: Development bars 23-29
// Rolling figure, descending bass with melodic anchors
// ============================================================

// Bar 23
pick(t(23, 0.11), 2); // C#5
pick(t(23, 0.73), 3, { minP: 73 }); // E5
pick(t(23, 1.47), 3, { minP: 67 }); // G#4 (long)
pick(t(23, 1.53), 0); // C3
pick(t(23, 2.31), 1); // G#3
pick(t(23, 2.57), 2); // D#4
pick(t(23, 3.49), 0); // C#3
pick(t(23, 3.85), 2); // A4

// Bar 24
pick(t(24, 0.31), 3, { minP: 71 }); // C#5
pick(t(24, 0.77), 3, { minP: 73 }); // E5
pick(t(24, 1.20), 3, { minP: 79 }); // G#5
pick(t(24, 1.65), 3, { minP: 76 }); // F#5
pick(t(24, 2.21), 3, { minP: 73 }); // D#5 (long)
pick(t(24, 2.25), 0); // C3
pick(t(24, 2.71), 1); // F#3
pick(t(24, 3.73), 2); // G#4

// Bar 25
pick(t(25, 0.81), 0); // B2
pick(t(25, 1.35), 1); // F#4
pick(t(25, 1.91), 2); // A4
pick(t(25, 2.01), 0); // D4
pick(t(25, 2.48), 3, { minP: 71 }); // C#5
pick(t(25, 3.06), 2); // E4 (long)

// Bar 26
pick(t(26, 0.14), 0); // D4
pick(t(26, 1.07), 0); // B2
pick(t(26, 1.48), 1); // F#4
pick(t(26, 1.92), 2); // A4
pick(t(26, 2.30), 3, { minP: 71 }); // C#5
pick(t(26, 2.67), 3, { minP: 73 }); // E5
pick(t(26, 2.98), 3, { minP: 73 }); // D5
pick(t(26, 3.31), 2); // G#4 (long)

// Bar 27
pick(t(27, 0.22), 2); // F#4 (very long)
pick(t(27, 1.26), 0); // E2 (bass)
pick(t(27, 2.35), 0); // F#3
pick(t(27, 2.44), 2); // D4
pick(t(27, 3.81), 0); // A1 (very deep bass, long)
pick(t(27, 3.83), 1); // C#4

// Bar 28: rolling figure
pick(t(28, 0.82), 1); // E3
pick(t(28, 1.19), 1); // G3
pick(t(28, 1.50), 0); // A3
pick(t(28, 1.77), 2); // B3
pick(t(28, 2.04), 1); // A3
pick(t(28, 2.33), 0); // E3
pick(t(28, 2.65), 1); // G3
pick(t(28, 2.90), 1); // A3
pick(t(28, 3.19), 2); // B3
pick(t(28, 3.49), 1); // A3
pick(t(28, 3.98), 0); // G3 (long)

// Bar 29: sparse
pick(t(29, 1.08), 2); // C#4
pick(t(29, 2.08), 3, { minP: 63 }); // E4
pick(t(29, 3.07), 1); // C#4

// ============================================================
// SECTION B2: bars 30-37 — buildup with descending lines and
// rising chromatic figure toward the F#6 climax
// ============================================================

// Bar 30: F#4 anchor + descending B3 line
pick(t(30, 0.07), 0); // D2 (bass)
pick(t(30, 0.09), 3, { minP: 64 }); // F#4 (very long anchor)
pick(t(30, 1.51), 1); // F#3
pick(t(30, 1.95), 2); // B3
pick(t(30, 2.22), 3, { minP: 60 }); // C#4
pick(t(30, 2.55), 2); // B3
pick(t(30, 2.84), 1); // A3
pick(t(30, 3.42), 3, { minP: 60 }); // C#4
pick(t(30, 3.76), 2); // B3

// Bar 31: rising sequence C#4 / F#4 / D#4 / A4 / B4
pick(t(31, 0.04), 1); // A3
pick(t(31, 0.36), 2); // C#4
pick(t(31, 1.23), 1); // F#3
pick(t(31, 1.25), 3, { minP: 64 }); // F#4
pick(t(31, 2.14), 2); // D#4 (long)
pick(t(31, 2.15), 3, { minP: 67 }); // A4
pick(t(31, 3.04), 1); // F#4
pick(t(31, 3.88), 3, { minP: 70 }); // B4

// Bar 32: building, E4 / G#4 / B4 sequence
pick(t(32, 0.72), 2); // G#4
pick(t(32, 1.58), 3, { minP: 70 }); // B4
pick(t(32, 1.58), 1); // E4 (held under)
pick(t(32, 2.35), 2); // G#4
pick(t(32, 3.23), 3, { minP: 71 }); // C#5 (sustained)
pick(t(32, 3.25), 2); // A4

// Bar 33: scalar ascent C#3 / E3 / F#3 / A3 / C#4 / E4 / F#4 / A4 / G#4
pick(t(33, 0.07), 0); // C#3
pick(t(33, 0.41), 0); // E3
pick(t(33, 0.64), 1); // F#3
pick(t(33, 0.88), 1); // A3
pick(t(33, 1.09), 2); // C#4
pick(t(33, 1.35), 2); // E4
pick(t(33, 1.56), 3, { minP: 64 }); // F#4
pick(t(33, 1.80), 3, { minP: 67 }); // A4
pick(t(33, 2.09), 2); // G#4
pick(t(33, 2.35), 3, { minP: 64 }); // F#4
pick(t(33, 2.67), 3, { minP: 63 }); // E4 (long)
pick(t(33, 3.48), 3, { minP: 67 }); // A4

// Bar 34: B4 / G#4 / D#4 chord cluster + C#5 sustained
pick(t(34, 0.42), 3, { minP: 70 }); // B4
pick(t(34, 0.43), 2); // G#4
pick(t(34, 0.44), 1); // D#4
pick(t(34, 1.27), 3, { minP: 71 }); // C#5
pick(t(34, 1.29), 2); // A4
pick(t(34, 2.08), 0); // F#1 (very deep)
pick(t(34, 2.22), 3, { minP: 71 }); // C#5 (very long)
pick(t(34, 3.00), 0); // C#3
pick(t(34, 3.34), 0); // E3
pick(t(34, 3.61), 1); // F#3
pick(t(34, 3.90), 1); // A3

// Bar 35: arch of C#4-E4-F#4-A4-G#4-F#4-E4 then a smaller second arch.
// Single voice, lanes balanced across all 4.
pick(t(35, 0.10), 0); // C#4 (low entry)
pick(t(35, 0.38), 1); // E4
pick(t(35, 0.59), 2); // F#4
pick(t(35, 0.86), 3); // A4 (peak)
pick(t(35, 1.15), 2); // G#4
pick(t(35, 1.43), 1); // F#4
pick(t(35, 1.76), 0); // E4 (sustained, base)
pick(t(35, 2.55), 3, { minP: 67 }); // A4 (jump back up)
pick(t(35, 2.82), 0); // C#4
pick(t(35, 3.38), 3, { minP: 70 }); // B4
pick(t(35, 3.67), 1); // D#4

// Bar 36: ascending C#5-D#5-E5-F#5-G#5 climb. The supporting low notes
// pair with each top note - one on the low lane, one on the matching high
// lane, creating an explicit "low-then-high" stairs pattern.
pick(t(36, 0.12), 0); // C#5 - start of ascent (visualized in lane 0)
pick(t(36, 0.39), 0); // E4 support
pick(t(36, 0.96), 1); // D#5
pick(t(36, 1.25), 1); // F#4 support
pick(t(36, 1.81), 2); // E5
pick(t(36, 2.03), 2); // G#4 support
pick(t(36, 2.54), 3); // F#5
pick(t(36, 2.79), 3); // A4 support (lane 3 pair to emphasize approach)
pick(t(36, 3.27), 3, { minP: 79 }); // G#5 PEAK
pick(t(36, 3.54), 2); // B4 (descent starts)

// Bar 37: pre-climax cascade. Alternate top-line notes between lane 3 and
// lane 1 in a zig-zag (high A5/B5/C#6/D#6 on 3, mid C#5/E5/D#5/F#5 on 1).
// No chord stabs - single voice, clear visual zig-zag toward F#6.
pick(t(37, 0.02), 3, { minP: 79 }); // A5
pick(t(37, 0.23), 1); // C#5
pick(t(37, 0.50), 1); // E5
pick(t(37, 0.78), 3, { minP: 82 }); // B5
pick(t(37, 1.03), 1); // D#5
pick(t(37, 1.63), 3, { minP: 84 }); // C#6
pick(t(37, 1.96), 1); // E5
pick(t(37, 2.73), 3, { minP: 86 }); // D#6 (climax approach)
pick(t(37, 3.10), 2); // F#5

// ============================================================
// SECTION B3: THE CLIMAX (bars 38-39)
// F#6 sustained for 1.69 seconds, the highest moment of the
// piece. Chord stab on all 4 lanes simultaneously.
// ============================================================

// Bar 38: F#6 CLIMAX with sustained G#5/B5 chord underneath. Four lanes fire
// at once with explicit pitch->lane mapping (bass left, treble right).
pick(t(38, 0.33), 3, { minP: 89 }); // F#6 SUMMIT (1.69s long!)
pick(t(38, 0.35), 0, { maxP: 35 }); // E1 (deepest bass)
pick(t(38, 0.35), 1, { minP: 75, maxP: 82 }); // G#5 (sustained 2.26s)
pick(t(38, 0.38), 2, { minP: 82, maxP: 86 }); // B5 (sustained 2.10s)
pick(t(38, 2.11), 0); // B2
pick(t(38, 2.74), 0); // E3
pick(t(38, 3.50), 3, { minP: 87 }); // E6 (afterglow)

// Bar 39: settling, scarce
pick(t(39, 0.79), 1); // E4
pick(t(39, 1.46), 2); // G#4
pick(t(39, 2.17), 3, { minP: 73 }); // E5 (very long, 3.64s!)

// ============================================================
// SECTION C: Coda of climax (bars 40-44)
// Sparse aftermath, transitioning into the middle section
// ============================================================

// Bar 40: sparse fade
pick(t(40, 1.06), 1); // E4 (long sustained)

// Bar 41: A4 / F#4 / B3 chord with rising
pick(t(41, 0.37), 2); // A4 (long)
pick(t(41, 0.40), 1); // F#4
pick(t(41, 0.41), 0); // B3
pick(t(41, 1.40), 3, { minP: 73 }); // D5
pick(t(41, 1.68), 1); // C#4
pick(t(41, 2.01), 3, { minP: 73 }); // E5
pick(t(41, 2.72), 2); // C#5

// Bar 42: B4 / C#5 / chord stab
pick(t(42, 0.67), 2); // B4
pick(t(42, 1.50), 2, { maxP: 69 }); // G#4
pick(t(42, 1.50), 3, { minP: 70 }); // B4
pick(t(42, 2.19), 3, { minP: 71 }); // C#5
pick(t(42, 2.84), 0); // C#4
pick(t(42, 2.84), 1); // F#4
pick(t(42, 2.84), 2); // A4

// Bar 43: chord sustained
pick(t(43, 0.10), 2); // F#4 (long)
pick(t(43, 0.12), 1); // D#4 (long)
pick(t(43, 0.14), 0); // A3
pick(t(43, 2.88), 3, { minP: 67 }); // G#4

// Bar 44: F#5 / D5 / B4 chord with E4
pick(t(44, 0.08), 1); // F#4
pick(t(44, 0.10), 0); // D4
pick(t(44, 0.88), 2); // E4
pick(t(44, 1.98), 3, { minP: 76 }); // F#5
pick(t(44, 2.01), 2); // D5
pick(t(44, 2.02), 1); // B4
pick(t(44, 2.02), 0); // F#4

// ============================================================
// SECTION D1: Calmer middle (bars 45-50)
// New material, gentler dynamics
// ============================================================

// Bar 45
pick(t(45, 0.65), 3, { minP: 73 }); // E5
pick(t(45, 2.35), 1); // F#4
pick(t(45, 2.38), 0); // A3
pick(t(45, 2.38), 2); // C#4
// G#5 pickup omitted - the chord on the next downbeat is the focal point.

// Bar 46: chord cluster + B5 highlight
pick(t(46, 0.03), 0, { maxP: 57 }); // A3 (long)
pick(t(46, 0.04), 1, { minP: 60, maxP: 62 }); // C#4 (long)
pick(t(46, 0.04), 2, { minP: 63, maxP: 66 }); // E4 (long)
pick(t(46, 0.04), 3, { minP: 67 }); // A4
pick(t(46, 2.45), 3, { minP: 82 }); // B5 HIGH ACCENT
pick(t(46, 3.70), 3, { minP: 79 }); // A5

// Bar 47
pick(t(47, 0.86), 3, { minP: 76 }); // F#5
pick(t(47, 1.72), 2); // E5
pick(t(47, 2.26), 3, { minP: 73 }); // D5
pick(t(47, 2.52), 1); // C#4
pick(t(47, 2.70), 3, { minP: 73 }); // E5
pick(t(47, 3.26), 2); // C#5
pick(t(47, 3.39), 0); // D4

// Bar 48
pick(t(48, 1.02), 3, { minP: 70 }); // B4
pick(t(48, 1.74), 2); // B4
pick(t(48, 1.78), 1); // G#4
pick(t(48, 2.35), 3, { minP: 71 }); // C#5
pick(t(48, 2.96), 2); // A4
pick(t(48, 2.98), 1); // E4
pick(t(48, 3.03), 0); // F#3

// Bar 49
pick(t(49, 0.28), 2); // F#4
pick(t(49, 0.29), 0); // A3
pick(t(49, 1.49), 1); // D#4
pick(t(49, 2.30), 2); // F#4
pick(t(49, 2.99), 1); // C#4
pick(t(49, 3.00), 2); // F#4
pick(t(49, 3.63), 3, { minP: 67 }); // G#4

// Bar 50
pick(t(50, 0.23), 2); // F#4
pick(t(50, 0.27), 1); // B3
pick(t(50, 0.78), 3, { minP: 63 }); // E4
pick(t(50, 1.22), 1); // B3
pick(t(50, 1.80), 2); // C#4 (long)
pick(t(50, 1.82), 0); // F#2

// ============================================================
// SECTION D2: Middle continues (bars 51-67)
// Slow building, then return
// ============================================================

// Bar 51: long chord
pick(t(51, 0.21), 2); // E4
pick(t(51, 0.21), 0); // A3
pick(t(51, 0.21), 1); // C#4
pick(t(51, 1.52), 3, { minP: 63 }); // E4 (very long)
pick(t(51, 1.54), 0); // B2
pick(t(51, 2.79), 1); // G#3

// Bar 52: very sparse
pick(t(52, 0.02), 0); // E2 (long bass)
pick(t(52, 1.50), 1); // E3
pick(t(52, 3.32), 2); // D3
pick(t(52, 3.80), 3, { minP: 54, maxP: 60 }); // F#3

// Bar 53: rising line
pick(t(53, 0.14), 0); // A3
pick(t(53, 0.45), 1); // C#4
pick(t(53, 0.79), 2); // B3
pick(t(53, 1.35), 0); // G#3
pick(t(53, 1.67), 1); // B3
pick(t(53, 1.92), 2); // D4
pick(t(53, 2.18), 3, { minP: 64 }); // F#4
pick(t(53, 2.45), 3, { minP: 63 }); // E4
pick(t(53, 2.97), 2); // C#4
pick(t(53, 3.23), 3, { minP: 63 }); // E4
pick(t(53, 3.45), 3, { minP: 67 }); // G#4
pick(t(53, 3.72), 3, { minP: 70 }); // B4

// Bar 54: descending then ascending B4 / D5 / F#5 / A5
pick(t(54, 0.22), 3, { minP: 67 }); // G#4
pick(t(54, 0.48), 2); // F#4
pick(t(54, 0.73), 3, { minP: 67 }); // A4
pick(t(54, 0.94), 3, { minP: 71 }); // C#5
pick(t(54, 1.21), 2); // E5 (long arrival)
pick(t(54, 1.43), 1); // D5
pick(t(54, 1.94), 0); // B4
pick(t(54, 2.19), 2); // D5
pick(t(54, 2.46), 3, { minP: 76 }); // F#5
pick(t(54, 2.75), 3, { minP: 79 }); // A5 (long climax)
pick(t(54, 3.66), 1); // D5
pick(t(54, 3.67), 2); // B4

// Bar 55: G#5 / F#5 alternating, descending
pick(t(55, 0.09), 3, { minP: 79 }); // G#5
pick(t(55, 0.60), 2); // F#5
pick(t(55, 0.60), 1); // D5
pick(t(55, 0.62), 0); // E3
pick(t(55, 1.06), 3, { minP: 73 }); // E5
pick(t(55, 1.46), 2); // F#5
pick(t(55, 1.46), 3, { minP: 67 }); // A4
pick(t(55, 1.94), 1); // E5
pick(t(55, 2.38), 0); // D5
pick(t(55, 2.82), 2); // C#5
pick(t(55, 3.34), 1); // D5

// Bar 56: descending
pick(t(56, 0.02), 3, { minP: 71 }); // C#5
pick(t(56, 0.56), 2); // B4
pick(t(56, 1.10), 1); // A4
pick(t(56, 2.04), 0); // D3
pick(t(56, 2.36), 1); // F#3
pick(t(56, 2.67), 2); // A3
pick(t(56, 2.92), 0); // F#2
pick(t(56, 3.21), 1); // B3
pick(t(56, 3.71), 0); // G#3

// Bar 57: rising scalar D4 / F#4 / E4 / D4 / C#4 / E4 / G#4 / B4
pick(t(57, 0.04), 0); // B3
pick(t(57, 0.28), 1); // D4
pick(t(57, 0.56), 2); // F#4
pick(t(57, 0.81), 2); // E4
pick(t(57, 1.04), 1); // D4
pick(t(57, 1.32), 0); // C#4
pick(t(57, 1.55), 1); // E4
pick(t(57, 1.79), 2); // G#4
pick(t(57, 2.05), 3, { minP: 70 }); // B4
pick(t(57, 2.29), 3, { minP: 67 }); // A4
pick(t(57, 2.54), 2); // G#4
pick(t(57, 2.77), 1); // F#4
pick(t(57, 3.00), 2); // A4
pick(t(57, 3.21), 3, { minP: 71 }); // C#5
pick(t(57, 3.46), 3, { minP: 73 }); // E5
pick(t(57, 3.69), 2); // D5
pick(t(57, 3.92), 1); // C#5

// Bar 58: B4 / D5 / F#5 / A5 climbing then G#5 / F#5 motif
pick(t(58, 0.19), 2); // B4
pick(t(58, 0.44), 3, { minP: 73 }); // D5
pick(t(58, 0.68), 3, { minP: 76 }); // F#5
pick(t(58, 0.96), 3, { minP: 79 }); // A5 PEAK
pick(t(58, 1.83), 1); // F#4
pick(t(58, 1.84), 2); // B4
pick(t(58, 1.84), 3, { minP: 73 }); // D5
pick(t(58, 2.34), 3, { minP: 79 }); // G#5
pick(t(58, 2.75), 2); // F#5
pick(t(58, 3.16), 3, { minP: 79 }); // G#5
pick(t(58, 3.61), 2); // B4
pick(t(58, 3.92), 3, { minP: 73 }); // D5

// Bar 59: F#5 / A5 / G#5 sustained
pick(t(59, 0.19), 2); // F#5
pick(t(59, 0.47), 3, { minP: 79 }); // A5 (long)
pick(t(59, 1.47), 1); // F#4
pick(t(59, 1.47), 2); // B4
pick(t(59, 1.48), 3, { minP: 73 }); // D5
pick(t(59, 2.10), 3, { minP: 79 }); // G#5
pick(t(59, 2.77), 2); // F#5

// Bar 60: E5 / D5 / E5 / C#5 (descent)
pick(t(60, 0.31), 0); // E3
pick(t(60, 0.60), 1); // D4 (long)
pick(t(60, 0.63), 3, { minP: 73 }); // E5
pick(t(60, 1.22), 3, { minP: 73 }); // D5
pick(t(60, 1.72), 3, { minP: 73 }); // E5
pick(t(60, 2.35), 2); // C#5
pick(t(60, 3.59), 1); // F#4

// Bar 61: B4 / C#5 / A4 / E4 / F#4
pick(t(61, 0.21), 3, { minP: 70 }); // B4
pick(t(61, 0.94), 2); // B4
pick(t(61, 0.94), 1); // F4
pick(t(61, 1.52), 3, { minP: 71 }); // C#5
pick(t(61, 2.13), 2); // A4 (long)
pick(t(61, 2.15), 1); // E4
pick(t(61, 3.60), 2); // F#4

// Bar 62: sparse, D#4 / G#4 / F#4
pick(t(62, 1.27), 1); // D#4
pick(t(62, 2.56), 2); // G#4
pick(t(62, 3.97), 1); // F#4

// Bar 63: chord then F#5 climax
pick(t(63, 0.01), 0); // E2 / B2 cluster
pick(t(63, 0.01), 1); // D4
pick(t(63, 1.08), 2); // E4
pick(t(63, 2.06), 3, { minP: 76 }); // F#5
pick(t(63, 2.08), 2); // D5
pick(t(63, 2.12), 1); // B4

// Bar 64: E5 then descending chord
pick(t(64, 1.18), 3, { minP: 73 }); // E5
pick(t(64, 2.38), 1); // F#4
pick(t(64, 2.42), 0); // A3
pick(t(64, 2.42), 2); // C#4
pick(t(64, 3.15), 2); // E4

// Bar 65: G#5 long + climbing motif
pick(t(65, 0.02), 3, { minP: 79 }); // G#5 (very long)
pick(t(65, 0.07), 2); // A4
pick(t(65, 0.08), 0); // E3
pick(t(65, 0.08), 1); // C#4
pick(t(65, 2.32), 3, { minP: 82 }); // B5 ACCENT
pick(t(65, 3.23), 3, { minP: 79 }); // A5
pick(t(65, 3.93), 2); // F#5

// Bar 66: E5 / D5 / E5 / C#5
pick(t(66, 0.58), 3, { minP: 73 }); // E5
pick(t(66, 0.60), 1); // F#4
pick(t(66, 1.13), 2); // D5
pick(t(66, 1.42), 0); // C#4
pick(t(66, 1.59), 3, { minP: 73 }); // E5
pick(t(66, 2.19), 2); // C#5 (long)
pick(t(66, 2.27), 1); // D4

// Bar 67: B4 / G#4 / C#5 / A4 closing phrase
pick(t(67, 0.63), 2); // B4
pick(t(67, 0.66), 1); // G#4
pick(t(67, 0.69), 0); // F4
pick(t(67, 1.24), 3, { minP: 71 }); // C#5
pick(t(67, 1.89), 2); // A4
pick(t(67, 1.94), 1); // E4
pick(t(67, 3.15), 3, { minP: 67 }); // G#4 (long)

// ============================================================
// SECTION E: Trio / contrasting middle (bars 68-80)
// Modulates, gentler motion, descending sequences
// ============================================================

// Bar 68: D#4 anchor with F#4 / G#4 echoes
pick(t(68, 0.40), 3, { minP: 63 }); // D#4
pick(t(68, 1.18), 2); // F#4
pick(t(68, 1.86), 2); // F#4
pick(t(68, 1.87), 1); // C#4
pick(t(68, 2.48), 3, { minP: 67 }); // G#4
pick(t(68, 3.08), 2); // F#4
pick(t(68, 3.58), 3, { minP: 63 }); // E4

// Bar 69: B3 / C#4 with E3/A3 chord
pick(t(69, 0.03), 2); // B3
pick(t(69, 0.67), 3, { minP: 60 }); // C#4 (long)
pick(t(69, 0.71), 0); // F#2
pick(t(69, 3.30), 1, { maxP: 57 }); // A3
pick(t(69, 3.31), 2, { minP: 60, maxP: 62 }); // C#4
pick(t(69, 3.31), 3, { minP: 63 }); // E4

// Bar 70: E4 sustained, sparse
pick(t(70, 0.73), 3, { minP: 63 }); // E4 (long)
pick(t(70, 0.75), 1); // A3
pick(t(70, 0.75), 2); // B3
pick(t(70, 0.78), 0); // E2
pick(t(70, 2.00), 1); // G#3
pick(t(70, 3.30), 0); // E2

// Bar 71: NEW KEY - G major. C major / G arpeggio
pick(t(71, 0.61), 0); // D3
pick(t(71, 2.27), 3, { minP: 67 }); // G4
pick(t(71, 2.29), 1); // G3
pick(t(71, 2.33), 2); // C4
pick(t(71, 2.75), 3, { minP: 64 }); // F4
pick(t(71, 3.08), 3, { minP: 67 }); // G4
pick(t(71, 3.46), 2); // E4
pick(t(71, 3.46), 1); // A3

// Bar 72: D / F / B / D4 chord cluster
pick(t(72, 1.54), 3, { minP: 62 }); // D4
pick(t(72, 1.56), 1); // F3
pick(t(72, 1.57), 2); // B3
pick(t(72, 2.60), 3, { minP: 60 }); // C4
pick(t(72, 2.63), 1); // C3
pick(t(72, 2.64), 2); // A3
pick(t(72, 3.76), 0); // G3
pick(t(72, 3.79), 1); // F3

// Bar 73: C4 / D4 / F4 / A3
pick(t(73, 1.79), 2); // C4
pick(t(73, 1.81), 1); // A3
pick(t(73, 2.81), 0); // F3
pick(t(73, 2.82), 2); // D4
pick(t(73, 2.85), 1); // B3
pick(t(73, 3.76), 3, { minP: 64 }); // F4
pick(t(73, 3.77), 0); // A3

// Bar 74: G4 / A4 / C5 / D5
pick(t(74, 0.68), 2); // G4
pick(t(74, 0.71), 0); // G3
pick(t(74, 0.72), 1); // C4
pick(t(74, 1.69), 3, { minP: 67 }); // A4
pick(t(74, 1.72), 1); // C4
pick(t(74, 1.73), 2); // F4
pick(t(74, 2.37), 3, { minP: 71 }); // C5
pick(t(74, 3.09), 3, { minP: 73 }); // D5 (long)
pick(t(74, 3.10), 2); // B4

// Bar 75: D3 / F3 / G3 / G4 / C5 / G5 ascending
pick(t(75, 0.35), 0); // D3
pick(t(75, 0.86), 1); // F3
pick(t(75, 1.37), 1); // G3
pick(t(75, 1.40), 2); // G4
pick(t(75, 2.32), 3, { minP: 62 }); // D4
pick(t(75, 2.79), 2); // F4
pick(t(75, 3.31), 1); // E4
pick(t(75, 3.34), 3, { minP: 79 }); // G5

// Bar 76: G5 / E5 / D5 with chord
pick(t(76, 0.20), 3, { minP: 79 }); // G5
pick(t(76, 0.70), 3, { minP: 73 }); // E5 (long)
pick(t(76, 1.67), 2); // A4
pick(t(76, 1.71), 1); // F4
pick(t(76, 2.77), 3, { minP: 73 }); // D5
pick(t(76, 3.81), 2); // E5

// Bar 77: F5 with A4 / F4
pick(t(77, 2.17), 3, { minP: 76 }); // F5
pick(t(77, 2.23), 2); // A4
pick(t(77, 2.26), 1); // F4

// Bar 78: G5 / F5 / G5 / E5 / G5 (echoing)
pick(t(78, 0.31), 3, { minP: 79 }); // G5
pick(t(78, 0.34), 2); // C5
pick(t(78, 0.77), 2); // F5
pick(t(78, 1.17), 3, { minP: 79 }); // G5
pick(t(78, 1.64), 3, { minP: 73 }); // E5
pick(t(78, 3.79), 3, { minP: 79 }); // G5

// Bar 79: G#5 / F#5 / G#5 / E5 (back to E)
pick(t(79, 1.29), 3, { minP: 79 }); // G#5
pick(t(79, 1.35), 2); // G#4
pick(t(79, 1.91), 2); // F#5
pick(t(79, 2.43), 3, { minP: 79 }); // G#5
pick(t(79, 3.21), 3, { minP: 73 }); // E5

// Bar 80: C#5 / G#5 / D#4
pick(t(80, 0.76), 2); // C#5 (long)
pick(t(80, 2.39), 3, { minP: 79 }); // G#5
pick(t(80, 3.72), 1); // D#4

// ============================================================
// SECTION F1: Recap of A material (bars 81-95)
// Returns to the opening arpeggios with variations
// ============================================================

// Bar 81 (recap of bar 2): C#-major arpeggio C#4-G#5 with A5 melody
// anchor on top. The arpeggio gets a CLEAN ascending sweep 0->1->2->3
// like bar 2; A5 anchor takes lane 3 at its entry, peak G#5 also on
// lane 3 with plenty of separation. Skip the low-velocity E5/D#5
// pickup notes for a tidier shape.
pick(t(81, 1.26), 0); // C#4 (low entry)
pick(t(81, 1.30), 3, { minP: 79 }); // A5 melody anchor (1.20s long)
pick(t(81, 2.00), 0); // E4 (arpeggio restart low)
pick(t(81, 2.39), 1); // A4
pick(t(81, 2.71), 2); // C#5
pick(t(81, 3.33), 2); // F#5 (skip E5 - low velocity 0.24)
pick(t(81, 3.64), 3, { minP: 79 }); // G#5 PEAK

// Bar 82 (recap of bar 3): descending B4-G#4-D#4-B3, then F#5 melody
// anchor, then ascending arpeggio C#4-F#4-A4-C#5-E5, ending with E4.
// Shape: clean DESCENT 3->0, anchor on lane 3, clean ASCENT 0->3,
// brief descent. Skip the redundant C#5/B4 echoes near the end.
pick(t(82, 0.29), 3, { minP: 70 }); // B4 (top of descent)
pick(t(82, 0.53), 2); // G#4
pick(t(82, 0.85), 1); // D#4
pick(t(82, 1.17), 0); // B3 (bottom)
pick(t(82, 1.39), 3, { minP: 76 }); // F#5 melody anchor
pick(t(82, 1.74), 0); // C#4 (arpeggio restart)
pick(t(82, 2.02), 1); // F#4
pick(t(82, 2.30), 2); // A4
pick(t(82, 2.56), 3, { minP: 71 }); // C#5
pick(t(82, 3.07), 3, { minP: 73 }); // E5 (sustained)
pick(t(82, 3.86), 1); // E4 (skip B4 at 3.40 - redundant echo)

// Bar 83 (recap of bar 3 idea): low bass cluster B3-G#3-F#3, then
// arpeggio ascent A3-C#4-C#5-F#4-A4-F#5, then small descent.
// Bass on lane 0 (long anchor), ascent 1->2->3, descent.
pick(t(83, 0.18), 0); // B3
pick(t(83, 0.74), 0); // F#3 (bass anchor, long, skip G#3 quick)
pick(t(83, 1.10), 1); // A3
pick(t(83, 1.40), 2); // C#4
pick(t(83, 1.71), 3, { minP: 71 }); // C#5 melody anchor
pick(t(83, 2.00), 1); // F#4
pick(t(83, 2.35), 2); // A4
pick(t(83, 2.77), 3, { minP: 76 }); // F#5 PEAK
pick(t(83, 3.55), 1); // C#4 (descending, skip A3 at 3.24)
pick(t(83, 3.85), 2); // C#5

// Bar 84 (recap of bar 4): arpeggio F#4-A4-D#3-A3-C#4 with CLIMBING
// melody C#5 -> F#5 -> A5 on lane 3. Three melodic peaks, each on
// lane 3, well-separated. Skip the redundant arpeggio fill notes.
pick(t(84, 0.17), 1); // F#4 (arpeggio low)
pick(t(84, 0.53), 2); // A4
pick(t(84, 0.70), 0); // D#3 (bass)
pick(t(84, 1.35), 1); // C#4 (skip A3 quick)
pick(t(84, 1.60), 3, { minP: 71 }); // C#5 (melody peak 1)
pick(t(84, 2.20), 2); // A4
pick(t(84, 2.48), 3, { minP: 76 }); // F#5 (melody peak 2)
pick(t(84, 3.67), 3, { minP: 79 }); // A5 (melody peak 3, long)

// Bar 85 (recap of bars 5+6 COMPRESSED): pickup A4-C#5, bass B2-F#3,
// then THE A5 CLIMAX (1.83s sustained!) with ascending arpeggio
// C#4-D#4-F#4-A4-C#5 underneath. Pattern: 1,2 entry, 0,0 bass duo,
// 3 CLIMAX, 0->1->2->3 ascending arpeggio (mirrors bar 6 exactly).
pick(t(85, 0.05), 1); // A4 (entry)
pick(t(85, 0.45), 2); // C#5
pick(t(85, 0.81), 0); // B2 (bass)
pick(t(85, 1.19), 0); // F#3 (bass)
pick(t(85, 1.94), 3, { minP: 79 }); // A5 CLIMAX (1.83s)
pick(t(85, 1.95), 0); // C#4 (arpeggio restart, skip overlap)
pick(t(85, 2.34), 1); // D#4
pick(t(85, 2.74), 2); // F#4
pick(t(85, 3.16), 2); // A4
pick(t(85, 3.61), 3, { minP: 71 }); // C#5

// Bar 86: D#5 / G#5 / F#5
pick(t(86, 0.15), 3, { minP: 73 }); // D#5
pick(t(86, 0.72), 2); // C#5
pick(t(86, 1.43), 3, { minP: 79 }); // G#5
pick(t(86, 1.47), 2); // B4
pick(t(86, 2.52), 3, { minP: 76 }); // F#5 (long)

// Bar 87: E5 / F#5 / C#5 / E5 / B4 / C#5 / G#4 descending
pick(t(87, 0.15), 0); // E2
pick(t(87, 1.47), 3, { minP: 73 }); // E5
pick(t(87, 1.91), 3, { minP: 76 }); // F#5
pick(t(87, 2.20), 2); // C#5
pick(t(87, 2.51), 3, { minP: 73 }); // E5
pick(t(87, 2.81), 1); // B4
pick(t(87, 3.07), 2); // C#5
pick(t(87, 3.35), 1); // G#4
pick(t(87, 3.65), 0); // B4
pick(t(87, 3.91), 1); // F#4

// Bar 88: G#4 / E4 / G#4 / D#4 / C#4 lyrical line
pick(t(88, 0.20), 3, { minP: 67 }); // G#4
pick(t(88, 0.50), 1); // E4
pick(t(88, 0.75), 2); // G#4
pick(t(88, 1.04), 1); // D#4 (long)
pick(t(88, 1.52), 0); // G#3
pick(t(88, 1.96), 1); // C#4
pick(t(88, 2.91), 0); // C#4 (long)
pick(t(88, 3.98), 2); // B3

// Bar 89: E5 / F#5 / C#5 / E5 (echoes bar 87)
pick(t(89, 1.29), 3, { minP: 73 }); // E5
pick(t(89, 1.72), 3, { minP: 76 }); // F#5
pick(t(89, 1.98), 2); // C#5
pick(t(89, 2.31), 3, { minP: 73 }); // E5
pick(t(89, 2.63), 2); // B4
pick(t(89, 2.85), 3, { minP: 71 }); // C#5
pick(t(89, 3.14), 1); // G#4
pick(t(89, 3.43), 2); // B4
pick(t(89, 3.71), 1); // F#4

// Bar 90: G#4 / E4 / G#4 / D#4 / C#4 (echoes bar 88)
pick(t(90, 0.11), 3, { minP: 67 }); // G#4
pick(t(90, 0.46), 1); // E4
pick(t(90, 0.75), 2); // G#4
pick(t(90, 1.24), 1); // D#4 (long)
pick(t(90, 1.79), 0); // G#3
pick(t(90, 2.26), 1); // C#4
pick(t(90, 3.10), 0); // C#4 (long)

// Bar 91: B3 / A3 / B3 / C#4 / F#3 / A3 / E4 / D#4 / E4
pick(t(91, 0.18), 1); // B3
pick(t(91, 0.65), 0); // A3
pick(t(91, 1.05), 1); // B3
pick(t(91, 1.46), 2); // C#4
pick(t(91, 1.92), 0); // F#3
pick(t(91, 2.40), 1); // A3
pick(t(91, 2.88), 3, { minP: 63 }); // E4
pick(t(91, 3.27), 2); // D#4
pick(t(91, 3.70), 3, { minP: 63 }); // E4

// Bar 92: C#4 / G#4 / E4 / D#4
pick(t(92, 0.17), 1); // C#4
pick(t(92, 1.26), 3, { minP: 67 }); // G#4 (long)
pick(t(92, 2.11), 1); // B3
pick(t(92, 2.92), 2); // E4
pick(t(92, 3.79), 3, { minP: 63 }); // D#4

// Bar 93: C#4 / D#4 / E4 / C#4 / G#4 / F#4 / G#4 / E4
pick(t(93, 0.21), 1); // C#4
pick(t(93, 0.61), 2); // D#4
pick(t(93, 1.03), 3, { minP: 63 }); // E4 (long)
pick(t(93, 1.83), 1); // C#4
pick(t(93, 2.25), 3, { minP: 67 }); // G#4
pick(t(93, 2.74), 2); // F#4
pick(t(93, 3.15), 3, { minP: 67 }); // G#4
pick(t(93, 3.67), 3, { minP: 63 }); // E4

// Bar 94: C#5 / A#4 / C#5 / G#4 line
pick(t(94, 0.65), 3, { minP: 71 }); // C#5 (long)
pick(t(94, 1.05), 1); // C#4
pick(t(94, 1.48), 0); // C#3
pick(t(94, 1.92), 0); // F#3
pick(t(94, 2.31), 2); // A#4
pick(t(94, 2.68), 3, { minP: 71 }); // C#5
pick(t(94, 2.91), 2); // A#4
pick(t(94, 3.21), 3, { minP: 67 }); // G#4

// Bar 95: E5 / C#5 / E5 / G#5 climbing
pick(t(95, 0.05), 3, { minP: 73 }); // E5
pick(t(95, 0.41), 2); // G#4
pick(t(95, 0.77), 0); // F#3
pick(t(95, 1.17), 1); // C#4
pick(t(95, 1.50), 2); // C#5
pick(t(95, 1.83), 3, { minP: 73 }); // E5
pick(t(95, 2.10), 2); // C#5
pick(t(95, 2.41), 3, { minP: 79 }); // G#5
pick(t(95, 3.51), 3, { minP: 76 }); // F#5
pick(t(95, 3.94), 3, { minP: 79 }); // G#5

// ============================================================
// SECTION F2: Recap continuation (bars 96-106)
// ============================================================

// Bar 96: F#5/G#5 motif repeats THREE times. Alternate the motif notes
// between lanes 2 (F#5) and 3 (G#5) instead of stacking everything on
// lane 3 - that produces a clean low-mid-high arch twice plus a tail.
pick(t(96, 0.29), 1); // F#4 (arpeggio low)
pick(t(96, 0.99), 2); // F#5 (motif 1 low)
pick(t(96, 1.44), 3, { minP: 79 }); // G#5 (motif 1 high)
pick(t(96, 1.83), 0); // E4 (arpeggio restart)
pick(t(96, 2.22), 1); // G#4
pick(t(96, 2.64), 2); // F#5 (motif 2 low)
pick(t(96, 3.23), 3, { minP: 79 }); // G#5 (motif 2 high)
pick(t(96, 3.88), 2); // F#5 (motif 3 tail - no G#5 followup in this bar)

// Bar 97 (third recurrence of bar 5/6 idea): G#5 anchor then A5
// CLIMAX, then descending arpeggio. Put G#5 on lane 2 so the A5
// climax stands alone on lane 3, then descending arpeggio gives
// a clean 1->2->3 arch twice.
pick(t(97, 0.57), 1); // A#4 (entry low)
pick(t(97, 1.40), 2); // G#5 (anchor, on lane 2 to leave 3 for A5)
pick(t(97, 2.58), 3, { minP: 79 }); // A5 CLIMAX (1.23s long)
pick(t(97, 3.17), 1); // E4 (descent restart)
pick(t(97, 3.58), 2); // A4
pick(t(97, 3.92), 3, { minP: 71 }); // C#5

// Bar 98 (third recurrence of anchor + arpeggio): E5-F#5 climbing to
// G#5 (long anchor), then DESCENDING arpeggio D#5-B4-G#4-D#4-B3, then
// F#5 anchor again with ASCENDING arpeggio C#4-F#4-A4. Shape: clean
// ascent 1->2->3, anchor, descent 2->1->0, anchor, ascent 0->1->2.
pick(t(98, 0.32), 1); // E5 (climb start)
pick(t(98, 0.58), 2); // F#5
pick(t(98, 0.91), 3, { minP: 79 }); // G#5 ANCHOR (long)
pick(t(98, 1.27), 2); // D#5 (descent start)
pick(t(98, 1.63), 1); // B4
pick(t(98, 1.90), 0); // G#4
pick(t(98, 2.23), 0); // D#4 (descent bottom)
pick(t(98, 2.92), 3, { minP: 76 }); // F#5 ANCHOR (long)
pick(t(98, 3.30), 0); // C#4 (arpeggio restart)
pick(t(98, 3.61), 1); // F#4

// Bar 99: C#5 / D#5 / E5 / B4 / G#4 / E4 / B3 / G#3 descent
pick(t(99, 0.31), 1); // C#5
pick(t(99, 0.60), 2); // D#5
pick(t(99, 0.90), 3, { minP: 73 }); // E5
pick(t(99, 1.31), 2); // B4
pick(t(99, 1.59), 1); // G#4
pick(t(99, 1.85), 0); // E4
pick(t(99, 2.19), 1); // B3
pick(t(99, 2.52), 0); // G#3
pick(t(99, 3.09), 3, { minP: 79 }); // A5
pick(t(99, 3.19), 1); // C#4
pick(t(99, 3.92), 2); // A4

// Bar 100: B5 / C#6 / A5 / G#5 / A5 / G#5 / C#5 high register
pick(t(100, 0.27), 2); // C#5
pick(t(100, 0.31), 3, { minP: 82 }); // B5
pick(t(100, 0.92), 3, { minP: 84 }); // C#6 HIGH
pick(t(100, 1.47), 3, { minP: 79 }); // A5
pick(t(100, 1.98), 3, { minP: 79 }); // G#5
pick(t(100, 2.46), 2); // D#5
pick(t(100, 2.49), 3, { minP: 79 }); // A5
pick(t(100, 3.01), 3, { minP: 79 }); // G#5 (long)
pick(t(100, 3.50), 2); // C#5

// Bar 101: F#5 / B4 / E5 high motion
pick(t(101, 0.17), 1); // F#4
pick(t(101, 0.56), 2); // A4
pick(t(101, 0.65), 3, { minP: 76 }); // F#5
pick(t(101, 1.27), 1); // C#4
pick(t(101, 1.58), 3, { minP: 70 }); // B4 (long)
pick(t(101, 1.94), 1); // B3
pick(t(101, 2.29), 2); // E4
pick(t(101, 2.51), 3, { minP: 73 }); // E5
pick(t(101, 3.62), 0); // F#3

// Bar 102: D5 / E5 / F#5 / D5 / C#5 / D5 high register
pick(t(102, 0.17), 3, { minP: 73 }); // D5
pick(t(102, 0.79), 3, { minP: 73 }); // E5
pick(t(102, 0.82), 2); // A4
pick(t(102, 1.33), 3, { minP: 76 }); // F#5
pick(t(102, 1.88), 0); // E3
pick(t(102, 1.96), 3, { minP: 73 }); // D5
pick(t(102, 2.48), 2); // C#5
pick(t(102, 2.61), 1); // C#4
pick(t(102, 2.96), 2, { maxP: 70 }); // G#4
pick(t(102, 2.96), 3, { minP: 73 }); // D5
pick(t(102, 3.48), 2); // C#5 (long)
pick(t(102, 3.96), 1); // F#4

// Bar 103: B4 / E4 / A4 / C#5 / A4
pick(t(103, 0.85), 3, { minP: 70 }); // B4 (long)
pick(t(103, 0.93), 1); // D4
pick(t(103, 1.79), 2); // E4
pick(t(103, 1.84), 0); // C#3
pick(t(103, 2.46), 1); // A3
pick(t(103, 2.84), 1); // C#4
pick(t(103, 2.91), 3, { minP: 67 }); // A4

// Bar 104: D4 / G#4 / A4 / G#4 / C#5 / A4 / F#4
pick(t(104, 0.06), 1); // D4
pick(t(104, 0.62), 2); // G#4
pick(t(104, 1.09), 3, { minP: 67 }); // A4
pick(t(104, 1.54), 2); // G#4
pick(t(104, 2.04), 1); // C#4
pick(t(104, 2.05), 3, { minP: 71 }); // C#5
pick(t(104, 2.58), 3, { minP: 67 }); // A4
pick(t(104, 3.24), 2); // F#4
pick(t(104, 3.60), 1); // F#3

// Bar 105: B3 / E4 / F#4 / E4 / A4 (long sustained)
pick(t(105, 0.23), 1); // B3 (long)
pick(t(105, 0.28), 0); // G#2
pick(t(105, 0.94), 3, { minP: 63 }); // E4
pick(t(105, 1.90), 2); // F#4
pick(t(105, 2.63), 3, { minP: 63 }); // E4
pick(t(105, 3.66), 3, { minP: 67 }); // A4 (long)

// Bar 106: rising scalar C#3 / E3 / F#3 / A3 / B3 / C#4 / E4 / A4 / B4 / C#5
pick(t(106, 0.31), 0); // C#3
pick(t(106, 0.85), 0); // E3
pick(t(106, 1.23), 1); // F#3
pick(t(106, 1.67), 1); // A3
pick(t(106, 2.02), 2); // B3
pick(t(106, 2.36), 2); // C#4
pick(t(106, 2.73), 3, { minP: 63 }); // E4
pick(t(106, 3.06), 3, { minP: 67 }); // A4
pick(t(106, 3.40), 3, { minP: 70 }); // B4
pick(t(106, 3.70), 3, { minP: 71 }); // C#5

// ============================================================
// SECTION G: Coda — high register flourishes (bars 107-119)
// Brilliant cadenza-like passages, then final cadence
// ============================================================

// Bar 107: E5 / A5 / B5 / C#6 / E6 / C#6 / B5 / A5 / E5 / C#5 / B4 / A4 arch
pick(t(107, 0.01), 0); // E5
pick(t(107, 0.38), 1); // A5
pick(t(107, 0.69), 2); // B5
pick(t(107, 0.99), 3, { minP: 84 }); // C#6
pick(t(107, 1.34), 3, { minP: 87 }); // E6 PEAK
pick(t(107, 1.64), 3, { minP: 84 }); // C#6
pick(t(107, 1.96), 2); // B5
pick(t(107, 2.33), 1); // A5
pick(t(107, 2.63), 0); // E5
pick(t(107, 2.93), 1); // C#5
pick(t(107, 3.31), 2); // B4
pick(t(107, 3.70), 3, { minP: 67 }); // A4

// Bar 108: E4 / G#4 chord with ascending scale
pick(t(108, 0.15), 1); // E4
pick(t(108, 0.74), 2); // G#4 (long)
pick(t(108, 1.90), 0); // D#3
pick(t(108, 2.30), 1); // G#3
pick(t(108, 2.70), 2); // B3
pick(t(108, 2.98), 2); // D#4
pick(t(108, 3.34), 3, { minP: 67 }); // G#4
pick(t(108, 3.65), 3, { minP: 70 }); // B4
pick(t(108, 3.98), 3, { minP: 73 }); // D#5

// Bar 109: G#5 / B5 reaching up
pick(t(109, 0.32), 3, { minP: 79 }); // G#5
pick(t(109, 0.69), 3, { minP: 82 }); // B5
pick(t(109, 1.06), 2); // B4
pick(t(109, 1.47), 1); // F#4
pick(t(109, 2.34), 0); // D#3
pick(t(109, 2.67), 1); // A3
pick(t(109, 3.09), 2); // B3
pick(t(109, 3.35), 2); // D#4
pick(t(109, 3.75), 3, { minP: 67 }); // A4

// Bar 110: B4 / D#5 / A5 / B5 arch
pick(t(110, 0.13), 2); // B4
pick(t(110, 0.42), 3, { minP: 73 }); // D#5
pick(t(110, 0.91), 3, { minP: 79 }); // A5
pick(t(110, 1.40), 3, { minP: 82 }); // B5
pick(t(110, 1.98), 2); // B4
pick(t(110, 2.70), 0); // E4
pick(t(110, 3.58), 0); // B2

// Bar 111: E6 / F#6 / C#6 / E6 / B5 / C#6 / G#5 / B5 / F#5 / G#5 cascade
pick(t(111, 0.54), 3, { minP: 87 }); // E6
pick(t(111, 1.14), 3, { minP: 89 }); // F#6
pick(t(111, 1.48), 2); // C#6
pick(t(111, 1.89), 3, { minP: 87 }); // E6
pick(t(111, 2.28), 1); // B5
pick(t(111, 2.58), 2); // C#6
pick(t(111, 2.92), 0); // G#5
pick(t(111, 3.27), 1); // B5
pick(t(111, 3.58), 0); // F#5
pick(t(111, 3.92), 1); // G#5

// Bar 112: E5 / G#5 / D#5 / C#5 / C#5
pick(t(112, 0.30), 2); // E5
pick(t(112, 0.65), 3, { minP: 79 }); // G#5
pick(t(112, 1.15), 3, { minP: 73 }); // D#5 (long)
pick(t(112, 1.63), 1); // G#3
pick(t(112, 2.13), 0); // C#4
pick(t(112, 3.23), 2); // C#5 (long)

// Bar 113: B4 / E5 / F#5 / C#5 / E5 / B4 / C#5 / G#4 descent
pick(t(113, 0.58), 2); // B4 (long)
pick(t(113, 1.85), 3, { minP: 73 }); // E5
pick(t(113, 2.22), 3, { minP: 76 }); // F#5
pick(t(113, 2.51), 2); // C#5
pick(t(113, 2.84), 3, { minP: 73 }); // E5
pick(t(113, 3.18), 1); // B4
pick(t(113, 3.41), 2); // C#5
pick(t(113, 3.73), 1); // G#4

// Bar 114: B4 / F#4 / G#4 / E4 / G#4 / D#4 / C#4 / G#3
pick(t(114, 0.04), 3, { minP: 70 }); // B4
pick(t(114, 0.35), 1); // F#4
pick(t(114, 0.70), 2); // G#4
pick(t(114, 1.07), 1); // E4
pick(t(114, 1.35), 2); // G#4
pick(t(114, 1.85), 0); // D#4
pick(t(114, 2.44), 1); // G#3
pick(t(114, 3.00), 0); // C#4
pick(t(114, 3.59), 0); // G#3

// Bar 115: sparse, E3 / C#4 / B3 / C#4
pick(t(115, 0.30), 1); // C#4
pick(t(115, 1.00), 0); // C#3
pick(t(115, 2.05), 0); // E2 (long)
pick(t(115, 2.46), 2); // B3
pick(t(115, 3.40), 0); // B2
pick(t(115, 3.77), 2); // C#4

// Bar 116: G#3 / E3 / E4 / G#3 / F#4 / C#4 / B4 / C#5 closing motif
pick(t(116, 0.09), 0); // G#3
pick(t(116, 0.52), 0); // E3
pick(t(116, 0.90), 2); // E4
pick(t(116, 1.22), 1); // B3
pick(t(116, 1.77), 3, { minP: 64 }); // F#4
pick(t(116, 2.04), 1); // C#4
pick(t(116, 2.40), 0); // E3
pick(t(116, 2.73), 3, { minP: 70 }); // B4
pick(t(116, 3.29), 1); // B3
pick(t(116, 3.60), 3, { minP: 71 }); // C#5
pick(t(116, 3.89), 2); // G#4

// Bar 117: E4 / E5 / B4 / F#5 / C#5 / E4 / B5 / E5 / C#6 ascending tracery
pick(t(117, 0.21), 0); // E4
pick(t(117, 0.52), 3, { minP: 73 }); // E5
pick(t(117, 0.79), 2); // B4
pick(t(117, 1.06), 1); // G#4
pick(t(117, 1.38), 3, { minP: 76 }); // F#5
pick(t(117, 1.67), 2); // C#5
pick(t(117, 2.02), 0); // E4
pick(t(117, 2.29), 3, { minP: 82 }); // B5
pick(t(117, 2.64), 2); // E5
pick(t(117, 2.91), 1); // B4
pick(t(117, 3.21), 3, { minP: 84 }); // C#6
pick(t(117, 3.45), 2); // G#5
pick(t(117, 3.80), 1); // E5

// Bar 118: E6 / B5 / G#5 / F#6 / C#6 / G#6 final flourish then 4-lane chord
pick(t(118, 0.10), 3, { minP: 87 }); // E6
pick(t(118, 0.43), 2); // B5
pick(t(118, 0.74), 1); // G#5
pick(t(118, 1.06), 3, { minP: 89 }); // F#6
pick(t(118, 1.42), 2); // C#6
pick(t(118, 1.86), 3, { minP: 91 }); // G#6 HIGHEST EVER
pick(t(118, 1.89), 2, { minP: 87, maxP: 89 }); // E6
pick(t(118, 1.89), 1, { minP: 82, maxP: 84 }); // B5
pick(t(118, 1.90), 0, { minP: 75, maxP: 77 }); // E5
pick(t(118, 3.42), 3, { minP: 91 }); // G#6 (final chord)
pick(t(118, 3.44), 2); // B5
pick(t(118, 3.44), 1); // E6
pick(t(118, 3.44), 0); // E5

// Bar 119: final sustained chord
pick(t(119, 2.61), 2); // B5
pick(t(119, 2.62), 3, { minP: 91 }); // G#6
pick(t(119, 2.63), 1); // E6
pick(t(119, 2.63), 0); // E5

// Bar 120: closing E (deep pedal)
pick(t(120, 1.76), 0, { minP: 36, maxP: 64 }); // E (low octave)

// ============================================================
// Done picking. Now: complete the arpeggios.
//
// The picks above define the SHAPE of each phrase (start/peak/end lanes,
// chord stabs, anchors). But if I picked only some notes from a continuous
// melodic run, the player hears the run but plays gaps in it - which
// breaks consistency. So: for each pair of consecutive chart notes that
// belong to the same continuous run (no big time gaps, melodic range), add
// every MIDI note between them, with lanes interpolated between my two
// explicit endpoints.
// ============================================================

chart.sort((a, b) => a.note.time - b.note.time);

const RUN_MAX_GAP = 0.30; // sec - notes farther apart aren't part of one run
const RUN_PITCH_MIN = 45; // A2 - exclude very low bass
const RUN_PITCH_MAX = 100;

// A "melody anchor" is a sustained note in the melodic register. When one is
// playing, the music has a separate melodic voice on top of the arpeggios -
// in that case the arpeggios are accompaniment, not the melody, and we
// should NOT fill them in. (Filling them would double-track the player on
// notes the melody has already moved past.)
const ANCHOR_MIN_DURATION = 0.45;
const ANCHOR_MIN_PITCH = 67; // G4 - above the typical arpeggio range

function isMelodyAnchored(t0, t1) {
  for (const n of all) {
    if (n.duration < ANCHOR_MIN_DURATION) continue;
    if (n.midi < ANCHOR_MIN_PITCH) continue;
    // Does this note's playing range overlap [t0, t1]?
    if (n.time + n.duration < t0) continue;
    if (n.time > t1) continue;
    return true;
  }
  return false;
}

const filled = [];
for (let i = 0; i < chart.length - 1; i++) {
  const cur = chart[i];
  const next = chart[i + 1];
  const dt = next.note.time - cur.note.time;

  // Chord stabs (same-time picks): no fill needed.
  if (dt < 0.05) continue;
  // Phrase breaks: don't bridge across them.
  if (dt > 1.5) continue;

  // If a melody anchor is active in this window, the arpeggio is
  // accompaniment - leave it as background.
  if (isMelodyAnchored(cur.note.time, next.note.time)) continue;

  // Unused MIDI notes strictly between cur and next that are part of the
  // SAME melodic line. The note's pitch must fall in the rectangular range
  // [min(cur,next), max(cur,next)] with a 2-semitone slop. This keeps
  // accompaniment in a different register from being dragged into the chart.
  const pLow = Math.min(cur.note.midi, next.note.midi);
  const pHigh = Math.max(cur.note.midi, next.note.midi);
  const between = all
    .filter(
      (n) =>
        !used.has(n) &&
        n.time > cur.note.time + 0.01 &&
        n.time < next.note.time - 0.01 &&
        n.midi >= pLow - 2 &&
        n.midi <= pHigh + 2,
    )
    .sort((a, b) => a.time - b.time);

  if (between.length === 0) continue;

  // Check that the full sequence (cur, ...between, next) is a coherent run
  // with no big time gaps. If any gap exceeds RUN_MAX_GAP, this isn't one
  // continuous arpeggio - skip filling.
  const sequence = [cur.note, ...between, next.note];
  let coherent = true;
  for (let j = 1; j < sequence.length; j++) {
    if (sequence[j].time - sequence[j - 1].time > RUN_MAX_GAP) {
      coherent = false;
      break;
    }
  }
  if (!coherent) continue;

  // Skip any candidate that would land within 80ms of an existing chart
  // note - that creates an accidental chord-stab and looks messy.
  const STAB_THRESHOLD = 0.08;
  const accepted = between.filter(
    (n) =>
      !chart.some((c) => Math.abs(c.note.time - n.time) < STAB_THRESHOLD) &&
      !filled.some((f) => Math.abs(f.note.time - n.time) < STAB_THRESHOLD),
  );
  if (accepted.length === 0) continue;

  // Assign lanes to filled notes. If endpoints share a lane (e.g. both at
  // lane 3 during a peak), alternate with the adjacent lane to keep the
  // line moving visually. Otherwise interpolate linearly.
  const sameLane = cur.lane === next.lane;
  const altLane = cur.lane === 3 ? 2 : cur.lane === 0 ? 1 : cur.lane - 1;

  for (let k = 0; k < accepted.length; k++) {
    let lane;
    if (sameLane) {
      lane = k % 2 === 0 ? altLane : cur.lane;
    } else {
      const frac = (k + 1) / (accepted.length + 1);
      lane = Math.round(cur.lane + (next.lane - cur.lane) * frac);
    }
    used.add(accepted[k]);
    filled.push({ note: accepted[k], lane });
  }
}

chart.push(...filled);
chart.sort((a, b) => a.note.time - b.note.time);

const filledCount = filled.length;

// Second pass: catch high-velocity MELODIC notes in gaps that the first
// pass rejected because they were outside the strict ±2-semitone pitch
// slop. A melodic note jumping above the endpoint register (e.g. an E4-
// G#4-D#4 figure where G#4 is 4 semitones above E4/D#4) is still a clear
// melody beat we shouldn't skip. Require:
//   - velocity >= 0.32 (signifies melodic intent, not accompaniment)
//   - duration >= 0.10s (not a passing grace note)
//   - within 7 semitones of either endpoint (caps register drift)
//   - gap to neighbors >= 0.18s (don't crowd existing picks)
const melodyFilled = [];
for (let i = 0; i < chart.length - 1; i++) {
  const cur = chart[i];
  const next = chart[i + 1];
  const gap = next.note.time - cur.note.time;
  if (gap < 0.18 || gap > 0.45) continue;
  if (isMelodyAnchored(cur.note.time, next.note.time)) continue;

  const candidates = all
    .filter(
      (n) =>
        !used.has(n) &&
        n.time > cur.note.time + 0.05 &&
        n.time < next.note.time - 0.05 &&
        n.velocity >= 0.32 &&
        n.duration >= 0.1 &&
        (Math.abs(n.midi - cur.note.midi) <= 7 ||
          Math.abs(n.midi - next.note.midi) <= 7) &&
        n.midi >= 60,
    )
    .sort((a, b) => b.velocity - a.velocity);

  if (candidates.length === 0) continue;
  const winner = candidates[0];
  // Avoid creating accidental stabs.
  if (
    chart.some((c) => Math.abs(c.note.time - winner.time) < 0.08) ||
    melodyFilled.some((m) => Math.abs(m.note.time - winner.time) < 0.08)
  )
    continue;

  // Lane: pick an adjacent lane to both endpoints to keep visual continuity.
  let lane;
  if (cur.lane === next.lane) {
    lane = cur.lane === 3 ? 2 : cur.lane === 0 ? 1 : cur.lane + 1;
  } else {
    lane = Math.round((cur.lane + next.lane) / 2);
  }
  used.add(winner);
  melodyFilled.push({ note: winner, lane });
}
chart.push(...melodyFilled);
chart.sort((a, b) => a.note.time - b.note.time);

const melodyFilledCount = melodyFilled.length;

// Safety: same-lane collisions within MIN_SAME_LANE seconds. Look back
// through ALL recent notes (not just the immediate previous), since a
// different-lane note can sort between two same-lane notes and hide the
// collision. Bumped from 0.08 to 0.18 so close jacks get redistributed
// when an adjacent lane is free; intentional jacks where the surrounding
// lanes are occupied still survive.
const MIN_SAME_LANE = 0.18;
const laneOccupiedAt = (lane, refTime, excludeIdx) => {
  for (let j = excludeIdx - 1; j >= 0; j--) {
    if (refTime - chart[j].note.time > MIN_SAME_LANE) break;
    if (chart[j].lane === lane) return true;
  }
  return false;
};
for (let i = 1; i < chart.length; i++) {
  if (!laneOccupiedAt(chart[i].lane, chart[i].note.time, i)) continue;
  // Try adjacent lanes, then 2-step neighbors. Pick the first free one.
  const original = chart[i].lane;
  const candidates = [original + 1, original - 1, original + 2, original - 2]
    .filter((l) => l >= 0 && l <= 3);
  for (const c of candidates) {
    if (!laneOccupiedAt(c, chart[i].note.time, i)) {
      chart[i].lane = c;
      break;
    }
  }
}

// Anti-jack-cluster pass: a single jack (two same-lane notes within
// JACK_THRESHOLD seconds) is fine, but multiple jacks in quick succession
// across different lanes is tiring. When more than MAX_JACKS_IN_WINDOW
// jacks fall inside CLUSTER_WINDOW we nudge the latest jack's second note
// to a different lane - only if doing so doesn't create a new same-lane
// collision (using laneOccupiedAt which already enforces MIN_SAME_LANE
// distance) and no new tight jack on the destination lane.
const JACK_THRESHOLD = 0.35;
const CLUSTER_WINDOW = 1.0;
const MAX_JACKS_IN_WINDOW = 2;
function findJackEnds() {
  const ends = [];
  for (let i = 1; i < chart.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (chart[i].note.time - chart[j].note.time > JACK_THRESHOLD) break;
      if (chart[j].lane === chart[i].lane) {
        ends.push({ idx: i, time: chart[i].note.time });
        break;
      }
    }
  }
  return ends;
}
function laneSafeNoJack(lane, atIdx) {
  // Strict: destination lane must have no MIN_SAME_LANE collision AND no
  // jack-distance neighbor within JACK_THRESHOLD. This guarantees the
  // move doesn't create a new jack.
  if (laneOccupiedAt(lane, chart[atIdx].note.time, atIdx)) return false;
  const t = chart[atIdx].note.time;
  for (let k = atIdx + 1; k < chart.length; k++) {
    if (chart[k].note.time - t > JACK_THRESHOLD) break;
    if (chart[k].lane === lane) return false;
  }
  for (let k = atIdx - 1; k >= 0; k--) {
    if (t - chart[k].note.time > JACK_THRESHOLD) break;
    if (chart[k].lane === lane) return false;
  }
  return true;
}
for (let round = 0; round < 4; round++) {
  let didChange = false;
  const ends = findJackEnds();
  for (let e = ends.length - 1; e >= 0; e--) {
    let cluster = 1;
    for (let f = e - 1; f >= 0; f--) {
      if (ends[e].time - ends[f].time > CLUSTER_WINDOW) break;
      cluster++;
    }
    if (cluster <= MAX_JACKS_IN_WINDOW) continue;
    const me = ends[e].idx;
    const original = chart[me].lane;
    const trials = [original + 1, original - 1, original + 2, original - 2]
      .filter((l) => l >= 0 && l <= 3);
    for (const t of trials) {
      if (laneSafeNoJack(t, me)) {
        chart[me].lane = t; didChange = true; break;
      }
    }
  }
  if (!didChange) break;
}

// Cross-lane simultaneity cleanup. The only intentional simultaneous chord
// stabs are the F#6 SUMMIT (bar 38), the bar 46 recap chord, and the
// bar 117-119 endgame finale. Everywhere else, two notes within 25ms on
// different lanes is an accidental coincidence from picks landing close
// together - the user sees these as confusing "two notes at the same time".
// Drop the lower-pitch member of each accidental pair (preserve melody).
const STAB_TIME_WINDOWS = [
  [73.9, 74.4], // Bar 38 F#6 SUMMIT
  [89.9, 90.2], // Bar 46 recap chord
  [234.8, 238.0], // Bar 118-119 endgame finale
];
const inStabWindow = (t) =>
  STAB_TIME_WINDOWS.some(([lo, hi]) => t >= lo && t <= hi);

// Drop accidental cross-lane chord-stabs. Only catch notes within ~12ms -
// that's tight enough that they truly look like ONE chord-stab moment,
// not two consecutive notes very close in time. Larger windows would
// incorrectly drop legitimate consecutive picks (e.g. end of one bar
// touching the start of the next).
const SIMUL_THRESHOLD = 0.012;
const dropped = new Set();
for (let i = 0; i < chart.length; i++) {
  if (dropped.has(i)) continue;
  for (let k = i + 1; k < chart.length; k++) {
    if (dropped.has(k)) continue;
    if (chart[k].note.time - chart[i].note.time > SIMUL_THRESHOLD) break;
    if (chart[i].lane === chart[k].lane) continue;
    if (inStabWindow(chart[i].note.time)) continue;
    const lo = chart[i].note.midi < chart[k].note.midi ? i : k;
    dropped.add(lo);
    if (lo === i) break;
  }
}
const beforeCleanup = chart.length;
// Notes that the simul-cleanup discards must fall back into `background`
// (otherwise they're silently dropped from the audio entirely - they were
// marked `used` when picked, so we have to un-mark them here).
for (const i of dropped) used.delete(chart[i].note);
const cleanedChart = chart.filter((_, i) => !dropped.has(i));
chart.length = 0;
chart.push(...cleanedChart);
const droppedSimul = beforeCleanup - chart.length;

// Build background: every MIDI note not picked.
const background = all.filter((n) => !used.has(n));

// Now that the chart is finalised, apply CC 64 sustain to extend note
// durations for playback. Doing this last (rather than before chart
// construction) keeps the chart-building heuristics - especially
// `isMelodyAnchored`, which gates gap-fills on `duration >= 0.45` -
// unaffected by pedal extension. The pedal modifies the underlying
// MIDI note objects in place, and `c.note.midiRef.duration` below
// reads back the new value.
applyPedalSustain(midi);

const out = {
  format: "arabesque-rhythm/curated/v1",
  duration: midi.duration,
  notes: chart.map((c) => ({
    t: c.note.time,
    l: c.lane,
    m: c.note.midi,
    d: c.note.midiRef.duration,
    v: c.note.velocity,
  })),
  background: background.map((n) => ({
    t: n.time,
    m: n.midi,
    d: n.midiRef.duration,
    v: n.velocity,
  })),
};

const outPath = new URL("../public/curated-chart.json", import.meta.url);
writeFileSync(outPath, JSON.stringify(out));

const counts = [0, 0, 0, 0];
chart.forEach((c) => counts[c.lane]++);
const chordOnsets = (() => {
  let count = 0;
  for (let i = 1; i < chart.length; i++) {
    if (chart[i].note.time - chart[i - 1].note.time < 0.02) count++;
  }
  return count;
})();
console.log(`Curated chart written: ${outPath.pathname}`);
console.log(`  dropped ${droppedSimul} accidental simultaneous pairs`);
console.log(`  recovered ${melodyFilledCount} high-velocity melodic notes`);
console.log(
  `  ${chart.length} chart notes (nps=${(chart.length / midi.duration).toFixed(2)})`,
);
console.log(`    explicit picks: ${chart.length - filledCount}`);
console.log(`    arpeggio gap-fills: ${filledCount}`);
console.log(`  ${background.length} background notes`);
console.log(`  lanes (L->R): ${counts.join(" / ")}`);
console.log(`  chord onsets: ${chordOnsets}`);
