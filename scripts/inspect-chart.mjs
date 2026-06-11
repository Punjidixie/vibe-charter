import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Midi } = require("@tonejs/midi");
const { buildChart } = require("../dist-check/chart.js");

const buf = readFileSync(new URL("../public/arabesque.mid", import.meta.url));
const midi = new Midi(buf);

const noteName = (m) => {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[m % 12]}${Math.floor(m / 12) - 1}`;
};

for (const d of ["easy", "normal", "hard"]) {
  const chart = buildChart(midi, d);
  console.log(`\n=== ${d.toUpperCase()} =====================================`);
  console.log(`Total chart notes: ${chart.notes.length}`);

  // Pitch distribution of chart notes vs background
  const chartPitches = chart.notes
    .flatMap((n) => n.audioNotes.map((a) => a.midi))
    .sort((a, b) => a - b);
  const bgPitches = chart.background.map((n) => n.midi).sort((a, b) => a - b);
  const med = (a) => a[Math.floor(a.length / 2)];
  console.log(
    `  Chart pitch:      median=${med(chartPitches)} (${noteName(med(chartPitches))})  range=${chartPitches[0]}-${chartPitches[chartPitches.length - 1]}`,
  );
  console.log(
    `  Background pitch: median=${med(bgPitches)} (${noteName(med(bgPitches))})  range=${bgPitches[0]}-${bgPitches[bgPitches.length - 1]}`,
  );

  // Duration distribution
  const chartDurs = chart.notes
    .flatMap((n) => n.audioNotes.map((a) => a.duration))
    .sort((a, b) => a - b);
  const bgDurs = chart.background.map((n) => n.duration).sort((a, b) => a - b);
  console.log(
    `  Chart duration:      median=${med(chartDurs).toFixed(3)}s  p90=${chartDurs[Math.floor(chartDurs.length * 0.9)].toFixed(3)}s`,
  );
  console.log(
    `  Background duration: median=${med(bgDurs).toFixed(3)}s  p90=${bgDurs[Math.floor(bgDurs.length * 0.9)].toFixed(3)}s`,
  );

  // Sample first 20 chart notes from somewhere in the middle of the piece (where melody is established)
  console.log(`  First 20 notes after t=20s:`);
  const sample = chart.notes.filter((n) => n.time >= 20).slice(0, 20);
  for (const n of sample) {
    const a = n.audioNotes[0];
    console.log(
      `    t=${n.time.toFixed(2)}s  lane=${n.lane}  pitch=${noteName(a.midi)}(${a.midi})  dur=${a.duration.toFixed(2)}s  vel=${a.velocity.toFixed(2)}`,
    );
  }
}
