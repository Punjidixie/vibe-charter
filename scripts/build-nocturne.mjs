// Curated chart for Chopin Nocturne in Eb Op. 9 No. 2.
//
// The Nocturne is structurally simple: a long-breathed melody in the right
// hand floats over a broken-chord left-hand accompaniment. The "chart" we
// want is essentially the melody line, with the accompaniment relegated to
// background. This script extracts the top voice automatically by:
//
// 1. Grouping all notes into onset clusters (within ~60ms).
// 2. For each cluster, picking the highest-pitch note as the candidate.
// 3. Filtering: keep candidate only if it's clearly a melody note - high
//    enough register, prominent enough velocity, or part of an ornamental
//    run (3+ fast successive high notes).
// 4. Lane assignment by pitch banding + interval-aware shaping.

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { applyPedalSustain } from "./pedal.mjs";
const require = createRequire(import.meta.url);
const { Midi } = require("@tonejs/midi");

const inputPath = new URL("../public/nocturne.mid", import.meta.url);
const midi = new Midi(readFileSync(inputPath));
// Pedal application is deferred until *after* chart construction, so the
// melody-detection heuristics see original (non-extended) durations.
// See the applyPedalSustain call near the bottom of this file.

const noteName = (m) => {
  const n = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${n[m % 12]}${Math.floor(m / 12) - 1}`;
};

// Flatten all notes from all tracks.
const all = [];
let id = 0;
midi.tracks.forEach((tr) => {
  for (const n of tr.notes) {
    all.push({
      id: id++,
      time: n.time,
      duration: n.duration,
      midi: n.midi,
      velocity: n.velocity,
      track: 0,
      midiRef: n, // populated by applyPedalSustain after the chart is built
    });
  }
});
all.sort((a, b) => a.time - b.time || b.midi - a.midi);

// ============================================================================
// STEP 1: Identify the melody candidates
// ============================================================================

// Group into onset clusters (notes within 60ms of each other).
const CLUSTER_EPS = 0.06;
const clusters = [];
for (const n of all) {
  const last = clusters[clusters.length - 1];
  if (last && n.time - last[0].time < CLUSTER_EPS) last.push(n);
  else clusters.push([n]);
}

// For each cluster, find the top-voice candidate.
// Top voice = highest pitch in the cluster.
const candidates = [];
for (const cluster of clusters) {
  const top = cluster.reduce((best, n) =>
    n.midi > best.midi ? n : best,
  );
  candidates.push(top);
}

// ============================================================================
// STEP 2: Filter melody notes from non-melodic top notes
// ============================================================================
//
// Not every "top of cluster" note is part of the melody. Some are inner-voice
// notes of the left-hand accompaniment that happen to be the highest in their
// onset (e.g. the top of a broken chord). Real melody notes are either:
//   (a) in the melody register (pitch >= 65), AND prominent (vel >= 0.28), OR
//   (b) part of an ornamental RUN: 3+ notes in pitch range 65+ within 600ms.
//
// We also boost notes that are clearly sustained (duration >= 0.30s) since
// those are almost always melodic anchors.

const MELODY_LOW = 65; // F4 and up
const PROMINENCE_VEL = 0.28;
const ANCHOR_DUR = 0.30;
const RUN_WINDOW = 0.6;
const RUN_MIN = 3;

const isCandidateProminent = (n) =>
  n.midi >= MELODY_LOW &&
  (n.velocity >= PROMINENCE_VEL || n.duration >= ANCHOR_DUR);

// Pass 1: prominent notes.
const keep = new Set();
for (const c of candidates) {
  if (isCandidateProminent(c)) keep.add(c.id);
}

// Pass 2: ornamental runs. Any 3+ consecutive high-register candidates within
// 600ms of each other get rescued, even if individually low-velocity.
for (let i = 0; i < candidates.length; i++) {
  if (candidates[i].midi < MELODY_LOW) continue;
  let j = i;
  while (
    j + 1 < candidates.length &&
    candidates[j + 1].midi >= MELODY_LOW &&
    candidates[j + 1].time - candidates[j].time <= RUN_WINDOW / RUN_MIN
  ) {
    j++;
  }
  if (j - i + 1 >= RUN_MIN) {
    for (let k = i; k <= j; k++) keep.add(candidates[k].id);
  }
  i = j;
}

// Drop any kept note that is RIGHT NEXT to another kept note within 80ms
// (we already cluster within 60ms, but adjacent clusters can land within
// 80ms after the algorithm picks two consecutive top-voice notes that are
// really one event). Keep the higher-pitch one.
const kept = candidates.filter((c) => keep.has(c.id));
kept.sort((a, b) => a.time - b.time || b.midi - a.midi);
const MIN_GAP = 0.08;
const meltrim = [];
for (const n of kept) {
  const prev = meltrim[meltrim.length - 1];
  if (prev && n.time - prev.time < MIN_GAP) {
    if (n.midi > prev.midi) meltrim[meltrim.length - 1] = n;
    continue;
  }
  meltrim.push(n);
}

// ============================================================================
// STEP 3: Lane assignment
// ============================================================================
//
// Pitch banding based on PERCENTILES of the actual melody range, not absolute
// pitch thresholds. This makes lane distribution balanced regardless of what
// register the melody sits in. Quartiles split the melody into 4 equal bands.

const melodyPitches = meltrim.map((n) => n.midi).sort((a, b) => a - b);
const q = (p) => melodyPitches[Math.floor(p * (melodyPitches.length - 1))];
const Q1 = q(0.25);
const Q2 = q(0.5);
const Q3 = q(0.75);
console.log(
  `  pitch quartiles: Q1=${noteName(Q1)} Q2=${noteName(Q2)} Q3=${noteName(Q3)}`,
);

function pitchToLane(midi) {
  if (midi <= Q1) return 0;
  if (midi <= Q2) return 1;
  if (midi <= Q3) return 2;
  return 3;
}

const chart = meltrim.map((n) => ({ note: n, lane: pitchToLane(n.midi) }));

// Interval shaping: avoid 3+ consecutive same-lane picks.
for (let i = 2; i < chart.length; i++) {
  const a = chart[i - 2];
  const b = chart[i - 1];
  const c = chart[i];
  if (a.lane === b.lane && b.lane === c.lane) {
    // Nudge c to an adjacent lane that doesn't double the trend.
    const dir = c.note.midi > b.note.midi ? 1 : c.note.midi < b.note.midi ? -1 : 0;
    if (dir === 0) {
      // Same pitch repeated: alternate to either side.
      c.lane = c.lane === 3 ? 2 : c.lane === 0 ? 1 : c.lane + 1;
    } else {
      const candidate = c.lane + dir;
      if (candidate >= 0 && candidate <= 3) c.lane = candidate;
      else c.lane = c.lane - dir;
    }
  }
}

// Same-lane spacing: nudge consecutive same-lane notes apart if they land
// within MIN_SAME_LANE seconds AND an adjacent lane is free. Tight jacks
// are tiring to tap. If every adjacent lane is taken we accept the jack
// as narrative rather than cascade-resolving.
const MIN_SAME_LANE = 0.22;
for (let i = 1; i < chart.length; i++) {
  for (let j = i - 1; j >= 0; j--) {
    if (chart[i].note.time - chart[j].note.time > MIN_SAME_LANE) break;
    if (chart[j].lane === chart[i].lane) {
      // Try adjacent lanes.
      const original = chart[i].lane;
      const trials = [original + 1, original - 1, original + 2, original - 2]
        .filter((l) => l >= 0 && l <= 3);
      for (const t of trials) {
        let collide = false;
        for (let k = i - 1; k >= 0; k--) {
          if (chart[i].note.time - chart[k].note.time > MIN_SAME_LANE) break;
          if (chart[k].lane === t) { collide = true; break; }
        }
        if (!collide) { chart[i].lane = t; break; }
      }
      break;
    }
  }
}

// Anti-jack-cluster: a single jack is tolerable, but several jacks within
// quick succession across different lanes is tiring. When more than
// MAX_JACKS_IN_WINDOW jacks fall inside CLUSTER_WINDOW seconds, we nudge
// the latest jack's second note to another lane (only if doing so doesn't
// create a new same-lane collision). Iterates until stable.
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
function laneSafe(lane, atIdx) {
  const t = chart[atIdx].note.time;
  for (let k = atIdx - 1; k >= 0; k--) {
    if (t - chart[k].note.time > JACK_THRESHOLD) break;
    if (chart[k].lane === lane) return false;
  }
  for (let k = atIdx + 1; k < chart.length; k++) {
    if (chart[k].note.time - t > JACK_THRESHOLD) break;
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
      if (laneSafe(t, me)) {
        chart[me].lane = t; didChange = true; break;
      }
    }
  }
  if (!didChange) break;
}

// ============================================================================
// STEP 4: Build output
// ============================================================================

const chartIds = new Set(chart.map((c) => c.note.id));
const background = all.filter((n) => !chartIds.has(n.id));

// Chart is now finalised; apply pedal so emitted durations reflect CC 64
// sustain. Heuristics above already ran with original durations.
applyPedalSustain(midi);

const out = {
  format: "nocturne-rhythm/curated/v1",
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

const outPath = new URL("../public/nocturne-chart.json", import.meta.url);
writeFileSync(outPath, JSON.stringify(out));

const lanes = [0, 0, 0, 0];
chart.forEach((c) => lanes[c.lane]++);
const nps = chart.length / midi.duration;
console.log(`Nocturne chart written: ${outPath.pathname}`);
console.log(
  `  ${chart.length} chart notes (nps=${nps.toFixed(2)})`,
);
console.log(`  ${background.length} background notes`);
console.log(`  lanes (L->R): ${lanes.join(" / ")}`);
console.log(`  pitch range: ${noteName(Math.min(...chart.map((c) => c.note.midi)))} - ${noteName(Math.max(...chart.map((c) => c.note.midi)))}`);
