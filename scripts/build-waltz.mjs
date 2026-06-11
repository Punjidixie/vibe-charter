// Curated chart for "Waltz For Tomorrow" (ArcAttempt2022.mid).
//
// Structure: 46 tracks all routed to GM piano, but the track names reveal a
// layered electronic-waltz arrangement - C. Bechstein piano arpeggios,
// strings, cellos, celesta, chimera bells, and a couple of chiptune lead
// voices (Square Soft/Softer/Arp, Mellow Poly). Different instruments take
// the melody in different sections, so there's no single "melody track" to
// pull from.
//
// Strategy:
//   1. Flatten all notes from all tracks.
//   2. Cluster onsets (50 ms).
//   3. Pick the TOP voice (highest pitch) per cluster - this naturally
//      tracks whichever instrument is sitting on top at any moment.
//   4. Prominence filter: keep candidate if (a) in melody register AND
//      either loud or sustained, OR (b) part of an ornamental run.
//   5. Same-lane / cross-lane collision cleanup.
//   6. Rank-based pitch banding for balanced lane distribution.

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { Midi } = require("@tonejs/midi");

const inputPath = new URL("../public/waltz-for-tomorrow.mid", import.meta.url);
const midi = new Midi(readFileSync(inputPath));

const noteName = (m) => {
  const n = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${n[m % 12]}${Math.floor(m / 12) - 1}`;
};

// ----------------------------------------------------------------------------
// STEP 1: flatten + cluster
// ----------------------------------------------------------------------------

const all = [];
let id = 0;
midi.tracks.forEach((tr, ti) => {
  for (const n of tr.notes) {
    all.push({
      id: id++,
      time: n.time,
      duration: n.duration,
      midi: n.midi,
      velocity: n.velocity,
      track: ti,
      trackName: tr.name || "",
    });
  }
});
all.sort((a, b) => a.time - b.time || b.midi - a.midi);

const CLUSTER_EPS = 0.05;
const clusters = [];
for (const n of all) {
  const last = clusters[clusters.length - 1];
  if (last && n.time - last[0].time < CLUSTER_EPS) last.push(n);
  else clusters.push([n]);
}

// Top voice candidate per cluster.
const candidates = clusters.map((c) =>
  c.reduce((best, n) => (n.midi > best.midi ? n : best)),
);

// ----------------------------------------------------------------------------
// STEP 2: prominence filter
// ----------------------------------------------------------------------------
//
// A top-voice candidate is "melodic" if:
//   (a) It's in the melody register (>= MELODY_LOW = C4) AND either loud
//       (vel >= PROMINENCE_VEL) or sustained (dur >= ANCHOR_DUR), OR
//   (b) It's part of an ornamental run: 3+ melody-register top-voice
//       candidates within RUN_WINDOW seconds.
//
// Bass / arpeggio-bottom notes that became "top" only because their cluster
// was a single low note get filtered here.

const MELODY_LOW = 60; // C4
const PROMINENCE_VEL = 0.45;
const ANCHOR_DUR = 0.18;
const RUN_WINDOW = 0.45;
const RUN_MIN = 3;

const keep = new Set();
for (const c of candidates) {
  if (
    c.midi >= MELODY_LOW &&
    (c.velocity >= PROMINENCE_VEL || c.duration >= ANCHOR_DUR)
  ) {
    keep.add(c.id);
  }
}

// Ornamental-run rescue: 3+ consecutive melody-register candidates spaced
// within RUN_WINDOW / RUN_MIN of each other get rescued regardless of
// velocity. This keeps arpeggio melody lines intact even when notes are
// individually quiet.
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

// Trim adjacent kept notes within MIN_GAP - if two melody candidates sit
// within 80 ms of each other (happens when two onset clusters straddle the
// CLUSTER_EPS boundary), keep the higher-pitch one.
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

// ----------------------------------------------------------------------------
// STEP 3: lane assignment by rank-based pitch banding
// ----------------------------------------------------------------------------

const sortedByPitch = meltrim
  .map((n) => n.midi)
  .sort((a, b) => a - b);
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

const chart = meltrim.map((n) => ({ note: n, lane: pitchToLane(n.midi) }));

// Interval shaping: avoid 3+ same-lane in a row by nudging in direction of
// melodic motion.
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
// within MIN_SAME_LANE of each other AND an adjacent lane is free. Close-
// together jacks are tiring to tap, so we want them to be the exception
// rather than the rule. If no adjacent lane is free the jack survives as
// "narrative" - we don't force-resolve cascading collisions.
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
          if (chart[k].lane === t) {
            collide = true;
            break;
          }
        }
        if (!collide) {
          chart[i].lane = t;
          break;
        }
      }
      break;
    }
  }
}

// Anti-jack-cluster: a single jack (two same-lane notes within
// JACK_THRESHOLD seconds) is fine, but several jacks in quick succession
// across different lanes is tiring (forces double-taps on every finger).
// When more than MAX_JACKS_IN_WINDOW jacks fall inside CLUSTER_WINDOW,
// we try to nudge the LATEST jack's second note to a different lane -
// only if doing so won't create a new same-lane collision on the
// destination lane. We iterate a few rounds to handle cascades.
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
// Strict laneSafe: nudge only when the destination lane has no neighbor
// within JACK_THRESHOLD - i.e. moves never create a new jack. This makes
// the pass monotonically reduce jacks across all lanes; loose moves that
// "swap" a jack between lanes were tried but tended to chain on the new
// lane.
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
        chart[me].lane = t;
        didChange = true;
        break;
      }
    }
  }
  if (!didChange) break;
}

// ----------------------------------------------------------------------------
// STEP 4: build output
// ----------------------------------------------------------------------------

const chartIds = new Set(chart.map((c) => c.note.id));
const background = all.filter((n) => !chartIds.has(n.id));

const out = {
  format: "waltz-for-tomorrow-rhythm/curated/v1",
  duration: midi.duration,
  notes: chart.map((c) => ({
    t: c.note.time,
    l: c.lane,
    m: c.note.midi,
    d: c.note.duration,
    v: c.note.velocity,
  })),
  background: background.map((n) => ({
    t: n.time,
    m: n.midi,
    d: n.duration,
    v: n.velocity,
  })),
};

const outPath = new URL("../public/waltz-for-tomorrow.json", import.meta.url);
writeFileSync(outPath, JSON.stringify(out));

const lanes = [0, 0, 0, 0];
chart.forEach((c) => lanes[c.lane]++);
const nps = chart.length / midi.duration;
console.log(`Waltz For Tomorrow chart written: ${outPath.pathname}`);
console.log(
  `  ${chart.length} chart notes (nps=${nps.toFixed(2)})`,
);
console.log(`  ${background.length} background notes`);
console.log(`  lanes (L->R): ${lanes.join(" / ")}`);
console.log(
  `  pitch range: ${noteName(Math.min(...chart.map((c) => c.note.midi)))} - ${noteName(Math.max(...chart.map((c) => c.note.midi)))}`,
);

// Per-section density profile for sanity checking.
const sectionEdges = [0, 21.6, 40, 60, 79, 98, 117, 137, midi.duration];
console.log(`  section density:`);
for (let i = 1; i < sectionEdges.length; i++) {
  const lo = sectionEdges[i - 1], hi = sectionEdges[i];
  const n = chart.filter((c) => c.note.time >= lo && c.note.time < hi).length;
  console.log(
    `    ${lo.toFixed(1).padStart(5)}s - ${hi.toFixed(1).padStart(5)}s : ${n.toString().padStart(3)} notes (${(n / (hi - lo)).toFixed(2)} nps)`,
  );
}
