// Audit: does the curated arabesque chart cover every MIDI note?
// Counts MIDI notes vs (chart audioNotes + background) and identifies
// any MIDI notes that fall through the cracks.
import pkg from "@tonejs/midi";
const { Midi } = pkg;
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "public");

const midiBuf = await readFile(resolve(publicDir, "arabesque.mid"));
const midi = new Midi(midiBuf);

const chartJson = JSON.parse(
  await readFile(resolve(publicDir, "curated-chart.json"), "utf8"),
);

// Collect all MIDI notes (flat).
const midiNotes = [];
for (let ti = 0; ti < midi.tracks.length; ti++) {
  for (const n of midi.tracks[ti].notes) {
    midiNotes.push({ time: n.time, midi: n.midi, dur: n.duration, track: ti });
  }
}
midiNotes.sort((a, b) => a.time - b.time || a.midi - b.midi);

console.log(`MIDI: ${midi.tracks.length} tracks, ${midiNotes.length} notes total`);
console.log(`Chart: ${chartJson.notes.length} chart notes, ${chartJson.background.length} background notes`);

// The curated chart loader (src/chart.ts) treats each chart note's pitch as
// the *single* audio note that fires on hit, looked up by (t, m) match with
// the MIDI. Plus all "background" notes always play.
// So total "will play" = chartJson.notes.length + chartJson.background.length
// PROVIDED each chart note (t,m) maps to a real MIDI note.

const total = chartJson.notes.length + chartJson.background.length;
console.log(`Total notes the engine will schedule: ${total}`);
console.log(`Missing from playback: ${midiNotes.length - total}`);

// Now do a key-based diff: build a multiset of (time, midi) from MIDI and
// from (chart notes + background), and see what MIDI keys are unaccounted for.
const round = (x) => Math.round(x * 1000); // ms resolution
const tally = new Map();
const add = (m, t) => {
  const k = `${round(t)}|${m}`;
  tally.set(k, (tally.get(k) ?? 0) + 1);
};
const consume = (m, t) => {
  const k = `${round(t)}|${m}`;
  const v = tally.get(k);
  if (!v) return false;
  if (v === 1) tally.delete(k);
  else tally.set(k, v - 1);
  return true;
};

for (const n of midiNotes) add(n.midi, n.time);

let coveredByChart = 0;
let coveredByBg = 0;
let missingChart = 0;
let missingBg = 0;

for (const c of chartJson.notes) {
  if (consume(c.m, c.t)) coveredByChart++;
  else missingChart++;
}
for (const b of chartJson.background) {
  if (consume(b.m, b.t)) coveredByBg++;
  else missingBg++;
}

console.log(`\nChart notes that match a real MIDI note: ${coveredByChart} / ${chartJson.notes.length}`);
console.log(`Background notes that match a real MIDI note: ${coveredByBg} / ${chartJson.background.length}`);
if (missingChart || missingBg) {
  console.log(`(!) chart-note mismatches: ${missingChart}, background-note mismatches: ${missingBg}`);
}

// What MIDI notes are leftover (= unplayed)?
const leftover = [];
for (const [k, v] of tally.entries()) {
  const [ms, m] = k.split("|").map(Number);
  for (let i = 0; i < v; i++) leftover.push({ time: ms / 1000, midi: m });
}
leftover.sort((a, b) => a.time - b.time);

console.log(`\nMIDI notes NOT scheduled by chart or background: ${leftover.length}`);
if (leftover.length) {
  // Group by ~1s window for readability
  const byBucket = new Map();
  for (const l of leftover) {
    const k = Math.floor(l.time);
    if (!byBucket.has(k)) byBucket.set(k, []);
    byBucket.get(k).push(l);
  }
  console.log(`\nFirst 30 leftover groups (second:bucket → count, sample pitches):`);
  let shown = 0;
  for (const [bucket, arr] of [...byBucket.entries()].sort((a, b) => a[0] - b[0])) {
    if (shown++ >= 30) break;
    const pitches = arr.slice(0, 6).map((x) => `${x.midi}@${x.time.toFixed(2)}`).join(", ");
    console.log(`  ${bucket}s: ${arr.length} (${pitches}${arr.length > 6 ? "…" : ""})`);
  }
  console.log(`\nLast 10 leftover notes:`);
  for (const l of leftover.slice(-10)) {
    console.log(`  ${l.time.toFixed(3)}s pitch=${l.midi}`);
  }
}
