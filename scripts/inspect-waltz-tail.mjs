import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Midi } = require("@tonejs/midi");

const buf = readFileSync(new URL("../public/waltz-for-tomorrow.mid", import.meta.url));
const midi = new Midi(buf);

console.log(`PPQ: ${midi.header.ppq}`);
console.log(`Duration: ${midi.duration.toFixed(3)} s`);
console.log(`\nTracks:`);
midi.tracks.forEach((t, i) => {
  if (!t.notes.length) return;
  const inst = t.instrument || {};
  const lastT = t.notes[t.notes.length - 1].time;
  console.log(
    `  [${String(i).padStart(2)}] name="${t.name || ""}" inst="${inst.name || "?"}" family="${inst.family || "?"}" prog=${inst.number} ch=${t.channel} notes=${t.notes.length} lastOnset=${lastT.toFixed(3)}s`
  );
});

// Find any track whose name/instrument suggests strings/ensemble
const stringRegex = /string|ensemble|strings|orchestra/i;
const stringTracks = midi.tracks
  .map((t, i) => ({ t, i }))
  .filter(({ t }) => {
    const name = (t.name || "").toLowerCase();
    const inst = (t.instrument?.name || "").toLowerCase();
    const fam = (t.instrument?.family || "").toLowerCase();
    return stringRegex.test(name) || stringRegex.test(inst) || stringRegex.test(fam);
  });

console.log(`\nString-ish tracks: ${stringTracks.length}`);

for (const { t, i } of stringTracks) {
  console.log(`\n=== Track [${i}] "${t.name}" (${t.instrument?.name}) ===`);
  // Group notes into "chords" by onset time within an epsilon
  const eps = 0.03;
  const sorted = [...t.notes].sort((a, b) => a.time - b.time || a.midi - b.midi);
  const chords = [];
  for (const n of sorted) {
    const last = chords[chords.length - 1];
    if (last && Math.abs(n.time - last.time) < eps) {
      last.notes.push(n);
    } else {
      chords.push({ time: n.time, notes: [n] });
    }
  }
  // Print last 6 chords with absolute time + relative time-to-end
  const songEnd = midi.duration;
  const tail = chords.slice(-6);
  for (const c of tail) {
    const pitches = c.notes
      .map((n) => n.midi)
      .sort((a, b) => a - b)
      .map((m) => `${midiName(m)}(${m})`)
      .join(" ");
    const durs = c.notes.map((n) => n.duration);
    const minD = Math.min(...durs).toFixed(3);
    const maxD = Math.max(...durs).toFixed(3);
    const vels = c.notes.map((n) => n.velocity);
    const minV = Math.min(...vels).toFixed(2);
    const maxV = Math.max(...vels).toFixed(2);
    const offset = (songEnd - c.time).toFixed(3);
    console.log(
      `  t=${c.time.toFixed(3)}s  (end - t = ${offset}s)  pitches=[${pitches}]  dur=${minD}..${maxD}s  vel=${minV}..${maxV}`
    );
  }
}

// Also show every track's last 3 notes for general orientation
console.log(`\n--- Last 3 onsets per non-empty track ---`);
midi.tracks.forEach((t, i) => {
  if (!t.notes.length) return;
  const tail = t.notes.slice(-3);
  const summary = tail
    .map(
      (n) =>
        `${n.time.toFixed(3)}s ${midiName(n.midi)}(${n.midi}) d=${n.duration.toFixed(2)}`
    )
    .join("  |  ");
  console.log(`  [${i}] ${t.name || t.instrument?.name || "?"}: ${summary}`);
});

function midiName(m) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const oct = Math.floor(m / 12) - 1;
  return `${names[m % 12]}${oct}`;
}
