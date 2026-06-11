// Find the structurally important moments: long-held high notes (melodic anchors).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Midi } = require("@tonejs/midi");

const buf = readFileSync(new URL("../public/arabesque.mid", import.meta.url));
const midi = new Midi(buf);
const bpm = midi.header.tempos[0]?.bpm ?? 120;
const barDur = (60 / bpm) * (midi.header.timeSignatures[0]?.timeSignature[0] ?? 4);

const noteName = (m) => {
  const n = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${n[m % 12]}${Math.floor(m / 12) - 1}`;
};

const all = midi.tracks.flatMap((t, ti) =>
  t.notes.map((n) => ({
    time: n.time,
    duration: n.duration,
    midi: n.midi,
    velocity: n.velocity,
    track: ti,
  })),
);
all.sort((a, b) => a.time - b.time);

// Melodic anchors: top 5% longest notes that are also above median pitch.
const pitchesSorted = [...all].map((n) => n.midi).sort((a, b) => a - b);
const medPitch = pitchesSorted[Math.floor(pitchesSorted.length / 2)];
const longThresh = [...all]
  .map((n) => n.duration)
  .sort((a, b) => a - b)[Math.floor(all.length * 0.92)];

const anchors = all.filter((n) => n.duration >= longThresh && n.midi >= medPitch);
console.log(`Found ${anchors.length} melodic anchors (dur >= ${longThresh.toFixed(2)}s, pitch >= ${medPitch}):`);
for (const a of anchors) {
  const bar = Math.floor(a.time / barDur) + 1;
  const beat = ((a.time % barDur) / (barDur / 4)).toFixed(2);
  console.log(`  bar ${String(bar).padStart(3)}  beat ${beat.padStart(5)}  ${noteName(a.midi).padEnd(4)}  dur=${a.duration.toFixed(2)}s  vel=${a.velocity.toFixed(2)}  t=${a.time.toFixed(2)}s`);
}

// Bass anchors: top 5% longest low notes (below 25th pitch percentile).
const lowThresh = pitchesSorted[Math.floor(pitchesSorted.length * 0.25)];
const bassThresh = [...all.filter((n) => n.midi <= lowThresh)]
  .map((n) => n.duration)
  .sort((a, b) => a - b);
const longBassThresh = bassThresh[Math.floor(bassThresh.length * 0.85)] ?? 0.5;
const bassAnchors = all.filter((n) => n.midi <= lowThresh && n.duration >= longBassThresh);
console.log(`\n${bassAnchors.length} bass anchors (pitch<=${lowThresh}, dur>=${longBassThresh.toFixed(2)}s):`);
for (const a of bassAnchors) {
  const bar = Math.floor(a.time / barDur) + 1;
  console.log(`  bar ${String(bar).padStart(3)}  ${noteName(a.midi).padEnd(4)}  dur=${a.duration.toFixed(2)}s  t=${a.time.toFixed(2)}s`);
}
