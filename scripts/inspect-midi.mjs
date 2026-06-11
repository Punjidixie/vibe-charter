import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Midi } = require("@tonejs/midi");

const buf = readFileSync(new URL("../public/arabesque.mid", import.meta.url));
const midi = new Midi(buf);

console.log(`Tempos:`, midi.header.tempos.map((t) => `${t.bpm.toFixed(1)}@${t.ticks}`).join(", "));
console.log(`TimeSigs:`, midi.header.timeSignatures.map((t) => `${t.timeSignature.join("/")}@bar${t.measures}`).join(", "));
console.log(`PPQ:`, midi.header.ppq);

const allNotes = midi.tracks.flatMap((t, ti) =>
  t.notes.map((n) => ({
    time: n.time,
    duration: n.duration,
    midi: n.midi,
    velocity: n.velocity,
    track: ti,
  })),
);
console.log(`Total notes: ${allNotes.length}`);

const durs = allNotes.map((n) => n.duration).sort((a, b) => a - b);
const pcts = (arr) => [0.1, 0.25, 0.5, 0.75, 0.9].map((p) => arr[Math.floor(arr.length * p)]);
console.log(`Duration percentiles (10/25/50/75/90):`, pcts(durs).map((d) => d.toFixed(3)).join(", "));

const pitches = allNotes.map((n) => n.midi).sort((a, b) => a - b);
console.log(`Pitch percentiles:`, pcts(pitches).join(", "));

const vels = allNotes.map((n) => n.velocity).sort((a, b) => a - b);
console.log(`Velocity percentiles:`, pcts(vels).map((v) => v.toFixed(2)).join(", "));

// Per-track stats - track 0 vs track 1 (probably RH vs LH)
for (let ti = 0; ti < midi.tracks.length; ti++) {
  const t = midi.tracks[ti];
  if (!t.notes.length) continue;
  const ds = t.notes.map((n) => n.duration).sort((a, b) => a - b);
  const ps = t.notes.map((n) => n.midi).sort((a, b) => a - b);
  console.log(
    `Track ${ti} (${t.name || "(no name)"}): ${t.notes.length} notes  durMed=${ds[Math.floor(ds.length / 2)].toFixed(3)}  pitchMed=${ps[Math.floor(ps.length / 2)]}  pitchRange=${ps[0]}-${ps[ps.length - 1]}`,
  );
}

// What does the duration distribution look like coarsely?
const buckets = { "<0.15": 0, "0.15-0.30": 0, "0.30-0.60": 0, "0.60-1.20": 0, ">1.20": 0 };
for (const d of durs) {
  if (d < 0.15) buckets["<0.15"]++;
  else if (d < 0.3) buckets["0.15-0.30"]++;
  else if (d < 0.6) buckets["0.30-0.60"]++;
  else if (d < 1.2) buckets["0.60-1.20"]++;
  else buckets[">1.20"]++;
}
console.log(`Duration buckets:`, JSON.stringify(buckets));
