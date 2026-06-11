/**
 * Surgical fix for Waltz For Tomorrow: the last two String Ensemble chords
 * on track 23 were 0.1 s ahead of the celesta line (135.5 / 136.1 instead
 * of the celesta's 135.6 / 136.2). Their original 0.4 s duration is
 * preserved.
 *
 * Idempotent: rerunning is safe because we re-snap any chord whose timing
 * matches one of the known prior positions (original misedit OR a previous
 * overcorrection that briefly snapped them to the 1.2 s bar grid).
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

// Fix table: each entry maps any known prior onset (originally 135.5/136.1
// or the briefly-applied 136.0/137.2) to the final celesta-aligned target
// at 135.6 / 136.2, with the original 0.4 s duration.
const FIXES = [
  { fromAny: [135.5, 136.0], to: 135.6, dur: 0.4 },
  { fromAny: [136.1, 137.2], to: 136.2, dur: 0.4 },
];
const TIME_EPS = 0.005;

const stringTrack = midi.tracks[23];
if (!stringTrack || stringTrack.name !== "String Ensemble") {
  throw new Error(`Expected track 23 to be "String Ensemble"; got "${stringTrack?.name}"`);
}

let touched = 0;
for (const fix of FIXES) {
  const group = stringTrack.notes.filter((n) =>
    fix.fromAny.some((f) => Math.abs(n.time - f) < TIME_EPS),
  );
  if (group.length === 0) {
    console.log(`  skip -> ${fix.to.toFixed(3)}s : no notes found (already at target?)`);
    continue;
  }
  const fromActual = group[0].time;
  for (const n of group) {
    n.time = fix.to;
    n.duration = fix.dur;
    touched++;
  }
  console.log(
    `  moved ${group.length} notes  ${fromActual.toFixed(3)}s -> ${fix.to.toFixed(3)}s  dur=${fix.dur}s`,
  );
}

// Notes must be sorted by time per @tonejs/midi's expectations.
stringTrack.notes.sort((a, b) => a.ticks - b.ticks);

writeFileSync(SRC, Buffer.from(midi.toArray()));
console.log(`\nWrote ${SRC.pathname.split("/").pop()} (${touched} notes touched).`);
