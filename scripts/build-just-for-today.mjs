// Curated chart for "Just For Today" - Punjidixie feat. Hatsune Miku.
//
// Audio model: the OGG recording plays as a continuous backing track. On top
// of it, the MIDI piano + celesta tracks both play through the soundfont. The
// vocal line (track 1, "Celesta") is monophonic and explicitly composer-
// curated, so we chart every vocal note. The piano accompaniment (track 0)
// is much denser - we extract its top voice per onset cluster and add it
// only in spots where the vocal isn't carrying the chart (intro, outro, and
// large vocal gaps), so the play surface never goes dead.

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { applyPedalSustain } from "./pedal.mjs";
const require = createRequire(import.meta.url);
const { Midi } = require("@tonejs/midi");

const inputPath = new URL("../public/just-for-today.mid", import.meta.url);
const midi = new Midi(readFileSync(inputPath));
// Pedal pass runs after chart construction; see applyPedalSustain near
// the bottom. This keeps duration-based heuristics (cluster scoring,
// note prominence) using original score durations.

const noteName = (m) => {
  const n = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${n[m % 12]}${Math.floor(m / 12) - 1}`;
};

const pianoNotes = midi.tracks[0].notes;
const vocalNotes = midi.tracks[1].notes;

let id = 0;
const piano = pianoNotes.map((n) => ({
  id: id++,
  time: n.time,
  duration: n.duration,
  midi: n.midi,
  velocity: n.velocity,
  midiRef: n,
}));
const vocal = vocalNotes.map((n) => ({
  id: id++,
  time: n.time,
  duration: n.duration,
  midi: n.midi,
  velocity: n.velocity,
  midiRef: n,
}));
vocal.sort((a, b) => a.time - b.time);
piano.sort((a, b) => a.time - b.time || b.midi - a.midi);

// ============================================================================
// STEP 1: piano onset clusters and candidate picks
// ============================================================================
//
// For each cluster we always take the TOP voice. For "strong" clusters (a
// chord with a real bass + treble spread) we ALSO take the bass voice -
// that creates a chord-stab on the downbeat, which feels great. The chord-
// stab partner is tagged `chordPartnerOf` so the cross-lane simultaneity
// cleanup later doesn't strip it back out.

const CLUSTER_EPS = 0.05;
const pianoClusters = [];
for (const n of piano) {
  const last = pianoClusters[pianoClusters.length - 1];
  if (last && n.time - last[0].time < CLUSTER_EPS) last.push(n);
  else pianoClusters.push([n]);
}

let chordPairId = 0;
const pianoCandidates = [];
for (const c of pianoClusters) {
  const top = c.reduce((best, n) => (n.midi > best.midi ? n : best));
  const bot = c.reduce((best, n) => (n.midi < best.midi ? n : best));
  // Bass-extend chord clusters with enough size + spread to feel "chordy".
  // Top must be in melody register (>= F4) and bass in real bass register
  // (<= C4) for the chord stab to feel grounded.
  const wantBass =
    c.length >= 4 &&
    top.midi - bot.midi >= 10 &&
    top.midi >= 65 &&
    bot.midi <= 60;
  if (wantBass) {
    const pid = ++chordPairId;
    pianoCandidates.push({ ...top, chordPair: pid });
    pianoCandidates.push({ ...bot, chordPair: pid });
  } else {
    pianoCandidates.push({ ...top, chordPair: 0 });
  }
}
pianoCandidates.sort((a, b) => a.time - b.time || b.midi - a.midi);

// ============================================================================
// STEP 2: filter piano candidates so they don't clash with vocal ONSETS
// ============================================================================
//
// We let piano play even DURING vocal phrases - just not on the exact same
// onset. VOCAL_GUARD is the minimum time delta from a vocal onset that a
// piano note must respect (a tight 70 ms is enough to feel distinct).

const vocalTimes = vocal.map((v) => v.time);
function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function nearestVocalOnsetDelta(t) {
  const i = lowerBound(vocalTimes, t);
  let d = Infinity;
  if (i < vocal.length) d = Math.min(d, Math.abs(vocal[i].time - t));
  if (i > 0) d = Math.min(d, Math.abs(t - vocal[i - 1].time));
  return d;
}

const VOCAL_GUARD = 0.07;
const pianoFiltered = pianoCandidates.filter(
  (p) => nearestVocalOnsetDelta(p.time) >= VOCAL_GUARD,
);

// ============================================================================
// STEP 3: thin piano picks so consecutive (non-chord) notes aren't too close
// ============================================================================
//
// Chord-stab partners (same chordPair > 0) are always kept together.
// Otherwise enforce PIANO_MIN_GAP between consecutive picks.

const PIANO_MIN_GAP = 0.11;
const pianoTrimmed = [];
for (const p of pianoFiltered) {
  const last = pianoTrimmed[pianoTrimmed.length - 1];
  const isChordPartner =
    last && p.chordPair > 0 && p.chordPair === last.chordPair;
  if (last && !isChordPartner && p.time - last.time < PIANO_MIN_GAP) {
    // Prefer the louder / longer note in the collision.
    const lastScore = last.velocity + last.duration * 0.5;
    const pScore = p.velocity + p.duration * 0.5;
    if (pScore > lastScore) pianoTrimmed[pianoTrimmed.length - 1] = p;
    continue;
  }
  pianoTrimmed.push(p);
}

// ============================================================================
// STEP 3: merge vocal + piano picks into chart, lane assignment
// ============================================================================

// Vocal notes carry no chordPair tag; default to 0 so the cleanup pass below
// can compare the tag uniformly without undefined checks.
const vocalForMerge = vocal.map((v) => ({ ...v, chordPair: 0 }));
const merged = [...vocalForMerge, ...pianoTrimmed].sort(
  (a, b) => a.time - b.time || b.midi - a.midi,
);

// Compute rank-based lane boundaries from the merged pitch distribution so
// every lane gets roughly 25% of notes regardless of repeated pitches.
const sortedByPitch = merged.map((n) => n.midi).sort((a, b) => a - b);
const cut = (p) => sortedByPitch[Math.floor(p * sortedByPitch.length)];
const B1 = cut(0.25);
const B2 = cut(0.5);
const B3 = cut(0.75);
console.log(
  `  lane boundaries: <${noteName(B1)} | <${noteName(B2)} | <${noteName(B3)} | >=${noteName(B3)}`,
);

function pitchToLane(m) {
  if (m < B1) return 0;
  if (m < B2) return 1;
  if (m < B3) return 2;
  return 3;
}

const chart = merged.map((n) => ({ note: n, lane: pitchToLane(n.midi) }));

// Interval shaping: avoid 3+ same-lane in a row by nudging in direction
// of melodic motion.
for (let i = 2; i < chart.length; i++) {
  const a = chart[i - 2];
  const b = chart[i - 1];
  const c = chart[i];
  if (a.lane === b.lane && b.lane === c.lane) {
    const dir = c.note.midi > b.note.midi ? 1 : c.note.midi < b.note.midi ? -1 : 0;
    if (dir === 0) {
      c.lane = c.lane === 3 ? 2 : c.lane === 0 ? 1 : c.lane + 1;
    } else {
      const cand = c.lane + dir;
      if (cand >= 0 && cand <= 3) c.lane = cand;
      else c.lane = c.lane - dir;
    }
  }
}

// Same-lane spacing: nudge consecutive same-lane notes apart if they fall
// within MIN_SAME_LANE seconds AND an adjacent lane is free. Tight jacks
// are tiring to tap. If no adjacent lane is free we accept the jack as
// "narrative" rather than cascade-resolving.
const MIN_SAME_LANE = 0.22;
for (let i = 1; i < chart.length; i++) {
  for (let j = i - 1; j >= 0; j--) {
    if (chart[i].note.time - chart[j].note.time > MIN_SAME_LANE) break;
    if (chart[j].lane === chart[i].lane) {
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

// Anti-jack-cluster: limit how many jacks happen in quick succession across
// different lanes. A jack = two same-lane notes within JACK_THRESHOLD; up
// to MAX_JACKS_IN_WINDOW jacks per CLUSTER_WINDOW are fine. When the
// limit is exceeded we nudge the latest jack's second note to another
// lane, only if doing so doesn't create a new same-lane collision.
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
// Strict laneSafe: only nudge to a lane with no neighbor within
// JACK_THRESHOLD. Moves never create a new jack.
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

// Cross-lane simultaneity cleanup: drop the lower-pitch note of any pair
// that lands within SIMUL_THRESHOLD on different lanes - UNLESS they're a
// tagged chord-stab partner (piano top+bass from the same onset cluster).
// Those are intentional chord hits and we keep them.
const SIMUL_THRESHOLD = 0.012;
const toDrop = new Set();
for (let i = 1; i < chart.length; i++) {
  const a = chart[i - 1];
  const b = chart[i];
  if (toDrop.has(a.note.id) || toDrop.has(b.note.id)) continue;
  if (b.note.time - a.note.time >= SIMUL_THRESHOLD) continue;
  if (a.lane === b.lane) continue;
  const isIntentionalChord =
    a.note.chordPair > 0 && a.note.chordPair === b.note.chordPair;
  if (isIntentionalChord) continue;
  toDrop.add(a.note.midi <= b.note.midi ? a.note.id : b.note.id);
}
const finalChart = chart.filter((c) => !toDrop.has(c.note.id));

// ============================================================================
// STEP 4: build output
// ============================================================================

const chartIds = new Set(finalChart.map((c) => c.note.id));
const background = [
  ...piano,
  ...vocal.filter((n) => !chartIds.has(n.id)),
].filter((n) => !chartIds.has(n.id));

// Apply CC 64 sustain now that the chart is finalised, so emitted
// durations reflect pedaling without affecting earlier heuristics.
applyPedalSustain(midi);

const out = {
  format: "just-for-today-rhythm/curated/v1",
  duration: midi.duration,
  notes: finalChart.map((c) => ({
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

const outPath = new URL("../public/just-for-today.json", import.meta.url);
writeFileSync(outPath, JSON.stringify(out));

const lanes = [0, 0, 0, 0];
finalChart.forEach((c) => lanes[c.lane]++);
const nps = finalChart.length / midi.duration;
const vocalChart = finalChart.filter((c) => c.note.id >= vocal[0].id).length;
const pianoChart = finalChart.length - vocalChart;
console.log(`Just For Today chart written: ${outPath.pathname}`);
console.log(
  `  ${finalChart.length} chart notes (${vocalChart} vocal + ${pianoChart} piano, nps=${nps.toFixed(2)})`,
);
console.log(`  ${background.length} background notes`);
console.log(`  lanes (L->R): ${lanes.join(" / ")}`);
console.log(
  `  pitch range: ${noteName(Math.min(...finalChart.map((c) => c.note.midi)))} - ${noteName(Math.max(...finalChart.map((c) => c.note.midi)))}`,
);
