/**
 * Surgical fix for Waltz For Tomorrow: the last two String Ensemble chords
 * on track 23 are 0.5 s / 1.1 s ahead of the 1.2 s waltz-bar grid, and
 * their durations were trimmed to 0.4 s. Push them back onto the grid
 * (136.000 s and 137.200 s) and restore the 0.6 s duration.
 *
 * Idempotent: rerunning is safe because we re-snap only chords whose
 * timing matches the *broken* values within a millisecond.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Midi } = require("@tonejs/midi");

const SRC = new URL("../public/waltz-for-tomorrow.mid", import.meta.url);
const BAK = new URL("../public/waltz-for-tomorrow.mid.bak", import.meta.url);

// One-shot backup so we can compare / roll back if needed.
if (!existsSync(BAK)) {
  copyFileSync(SRC, BAK);
  console.log(`Backed up original to ${BAK.pathname.split("/").pop()}`);
}

const midi = new Midi(readFileSync(SRC));

// Fix table: { old onset (s), new onset (s), new duration (s) }
const FIXES = [
  { from: 135.5, to: 136.0, dur: 0.6 },
  { from: 136.1, to: 137.2, dur: 0.6 },
];
const TIME_EPS = 0.005;

const stringTrack = midi.tracks[23];
if (!stringTrack || stringTrack.name !== "String Ensemble") {
  throw new Error(`Expected track 23 to be "String Ensemble"; got "${stringTrack?.name}"`);
}

let touched = 0;
for (const fix of FIXES) {
  const group = stringTrack.notes.filter((n) => Math.abs(n.time - fix.from) < TIME_EPS);
  if (group.length === 0) {
    console.log(`  skip ${fix.from.toFixed(3)}s -> ${fix.to.toFixed(3)}s : no notes found (already fixed?)`);
    continue;
  }
  for (const n of group) {
    n.time = fix.to;
    n.duration = fix.dur;
    touched++;
  }
  console.log(
    `  moved ${group.length} notes  ${fix.from.toFixed(3)}s -> ${fix.to.toFixed(3)}s  dur=${fix.dur}s`,
  );
}

// Notes must be sorted by time per @tonejs/midi's expectations.
stringTrack.notes.sort((a, b) => a.ticks - b.ticks);

writeFileSync(SRC, Buffer.from(midi.toArray()));
console.log(`\nWrote ${SRC.pathname.split("/").pop()} (${touched} notes touched).`);
