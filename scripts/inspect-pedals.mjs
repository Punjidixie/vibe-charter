// Quick survey: does each public MIDI contain pedal (CC) data?
// CC 64 = sustain/damper, CC 66 = sostenuto, CC 67 = soft (una corda).
import pkg from "@tonejs/midi";
const { Midi } = pkg;
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "public");

const FILES = [
  "arabesque.mid",
  "nocturne.mid",
  "just-for-today.mid",
  "waltz-for-tomorrow.mid",
];

const PEDAL_CCS = { 64: "sustain", 66: "sostenuto", 67: "soft" };

for (const name of FILES) {
  const buf = await readFile(resolve(publicDir, name));
  const midi = new Midi(buf);
  console.log(`\n=== ${name} (${midi.tracks.length} tracks, ${midi.duration.toFixed(1)}s) ===`);

  let totalPedalEvents = 0;
  for (let i = 0; i < midi.tracks.length; i++) {
    const t = midi.tracks[i];
    const ccs = t.controlChanges ?? {};
    const counts = {};
    for (const [ccNum, label] of Object.entries(PEDAL_CCS)) {
      const arr = ccs[ccNum];
      if (arr && arr.length) {
        counts[`${ccNum}/${label}`] = arr.length;
        totalPedalEvents += arr.length;
      }
    }
    if (Object.keys(counts).length) {
      console.log(
        `  track ${i} (${t.name || "(unnamed)"}, instrument: ${t.instrument?.name ?? "?"}): ${JSON.stringify(counts)}`,
      );
      // Show first few sustain events for context
      const sustain = ccs[64];
      if (sustain && sustain.length) {
        const sample = sustain.slice(0, 4).map((c) =>
          `${c.time.toFixed(2)}s=${(c.value * 127).toFixed(0)}`,
        ).join(", ");
        console.log(`    sustain sample: ${sample}${sustain.length > 4 ? ", …" : ""}`);
      }
    }
  }
  if (totalPedalEvents === 0) {
    console.log("  (no pedal events found in any track)");
  } else {
    console.log(`  total pedal events: ${totalPedalEvents}`);
  }
}
