// Standalone sanity check that re-implements just enough of the chart
// generator's signature to compare densities. We can't import chart.ts
// directly in raw Node ESM because @tonejs/midi is a CJS module without
// an exports map, so named imports require an interop shim. Real app uses
// Vite which handles this automatically.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Midi } = require("@tonejs/midi");
const { buildChart } = require("../dist-check/chart.js");

const buf = readFileSync(new URL("../public/arabesque.mid", import.meta.url));
const midi = new Midi(buf);
console.log(
  `MIDI: ${midi.duration.toFixed(2)}s, ${midi.tracks.length} tracks, ${midi.tracks.reduce(
    (n, t) => n + t.notes.length,
    0,
  )} notes total`,
);

for (const d of ["easy", "normal", "hard"]) {
  const chart = buildChart(midi, d);
  const nps = chart.notes.length / chart.duration;
  const laneDist = [0, 0, 0, 0];
  for (const n of chart.notes) laneDist[n.lane]++;
  const onsets = new Map();
  for (const n of chart.notes) {
    const k = Math.round(n.time * 100);
    onsets.set(k, (onsets.get(k) || 0) + 1);
  }
  const chords = [...onsets.values()].filter((c) => c > 1).length;
  console.log(
    `[${d.padEnd(6)}] notes=${String(chart.notes.length).padStart(4)}  bg=${String(
      chart.background.length,
    ).padStart(4)}  nps=${nps.toFixed(2)}  chordOnsets=${chords}  lanes=${laneDist.join("/")}`,
  );
}
