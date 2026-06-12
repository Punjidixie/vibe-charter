// Audit all four songs: how many MIDI notes are dropped from playback?
import pkg from "@tonejs/midi";
const { Midi } = pkg;
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "public");

const SONGS = [
  { name: "Arabesque", mid: "arabesque.mid", json: "curated-chart.json" },
  { name: "Nocturne", mid: "nocturne.mid", json: "nocturne-chart.json" },
  { name: "Just For Today", mid: "just-for-today.mid", json: "just-for-today.json" },
  { name: "Waltz", mid: "waltz-for-tomorrow.mid", json: "waltz-for-tomorrow.json" },
];

for (const s of SONGS) {
  const midi = new Midi(await readFile(resolve(publicDir, s.mid)));
  const chart = JSON.parse(await readFile(resolve(publicDir, s.json), "utf8"));
  let midiCount = 0;
  for (const t of midi.tracks) midiCount += t.notes.length;
  const total = chart.notes.length + chart.background.length;
  const pct = ((total / midiCount) * 100).toFixed(1);
  console.log(
    `${s.name.padEnd(16)} MIDI=${String(midiCount).padStart(4)}  chart=${String(chart.notes.length).padStart(4)}  bg=${String(chart.background.length).padStart(4)}  played=${String(total).padStart(4)} (${pct}%)  dropped=${midiCount - total}`,
  );
}
