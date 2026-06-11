// Dump the MIDI as a per-bar timeline of notes for inspection.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Midi } = require("@tonejs/midi");

const buf = readFileSync(new URL("../public/arabesque.mid", import.meta.url));
const midi = new Midi(buf);

const noteName = (m) => {
  const n = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${n[m % 12]}${Math.floor(m / 12) - 1}`;
};

const bpm = midi.header.tempos[0]?.bpm ?? 120;
const beatDur = 60 / bpm;
const sig = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4];
const beatsPerBar = sig[0];
const barDur = beatDur * beatsPerBar;

console.log(`BPM=${bpm}  ${sig.join("/")}  beatDur=${beatDur.toFixed(3)}s  barDur=${barDur.toFixed(3)}s  totalBars=${Math.ceil(midi.duration / barDur)}`);

const all = midi.tracks.flatMap((t, ti) =>
  t.notes.map((n) => ({
    time: n.time,
    duration: n.duration,
    midi: n.midi,
    velocity: n.velocity,
    track: ti,
  })),
);
all.sort((a, b) => a.time - b.time || a.midi - b.midi);

const lines = [];
let curBar = -1;
for (const n of all) {
  const bar = Math.floor(n.time / barDur);
  const beatInBar = (n.time - bar * barDur) / beatDur;
  if (bar !== curBar) {
    if (curBar >= 0) lines.push("");
    lines.push(`--- BAR ${bar + 1} (t=${(bar * barDur).toFixed(2)}s) ---`);
    curBar = bar;
  }
  const beatStr = beatInBar.toFixed(2).padStart(5);
  const dur = n.duration.toFixed(2).padStart(4);
  const vel = n.velocity.toFixed(2);
  lines.push(`  beat ${beatStr}  ${noteName(n.midi).padEnd(4)} (${n.midi.toString().padStart(2)})  dur=${dur}s  vel=${vel}`);
}

const out = new URL("../scripts/midi-dump.txt", import.meta.url);
writeFileSync(out, lines.join("\n"));
console.log(`Wrote ${lines.length} lines to ${out.pathname}`);
