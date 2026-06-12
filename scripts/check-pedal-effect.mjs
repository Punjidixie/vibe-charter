// Sanity check: do JSON note durations show the pedal effect?
// Compare median/max duration in the JSON vs the raw MIDI.
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

function quartiles(arr) {
  const a = [...arr].sort((x, y) => x - y);
  if (a.length === 0) return { p25: 0, p50: 0, p75: 0, max: 0 };
  const at = (q) => a[Math.min(a.length - 1, Math.floor(a.length * q))];
  return { p25: at(0.25), p50: at(0.5), p75: at(0.75), max: a[a.length - 1] };
}

for (const s of SONGS) {
  const midi = new Midi(await readFile(resolve(publicDir, s.mid)));
  const chart = JSON.parse(await readFile(resolve(publicDir, s.json), "utf8"));

  const midiDurs = [];
  for (const t of midi.tracks) for (const n of t.notes) midiDurs.push(n.duration);

  const jsonDurs = [
    ...chart.notes.map((n) => n.d),
    ...chart.background.map((n) => n.d),
  ];

  const m = quartiles(midiDurs);
  const j = quartiles(jsonDurs);
  const lift = (
    j.p50 / Math.max(0.001, m.p50)
  ).toFixed(2);
  console.log(
    `${s.name.padEnd(16)} MIDI median=${m.p50.toFixed(3)}s p75=${m.p75.toFixed(3)}s max=${m.max.toFixed(2)}s  →  JSON median=${j.p50.toFixed(3)}s p75=${j.p75.toFixed(3)}s max=${j.max.toFixed(2)}s   (median lift ×${lift})`,
  );
}
