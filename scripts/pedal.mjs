// Apply sustain-pedal semantics to a Tone.js Midi object IN PLACE.
//
// Standard piano sustain (CC 64) model: while the pedal is down, dampers
// stay off, so notes continue to sound after their natural release until
// the pedal next goes up. A subsequent re-attack of the same pitch starts
// a new note (we don't try to model resonance blending - we just truncate
// the held note at the re-attack so the soundfont doesn't double-stack
// the same pitch indefinitely).
//
// Convention: CC value >= 0.5 (i.e. 64..127 in raw MIDI) counts as "down".
// `@tonejs/midi` normalizes CC values to 0..1.
//
// Why this matters for playback: the chart pipeline schedules each note
// for exactly its `duration`. The classical piano MIDIs (Arabesque,
// Nocturne) lean heavily on the pedal to create resonance and overlap.
// Without applying CC 64, the rendered audio sounds dry.

const DOWN_THRESHOLD = 0.5;

export function applyPedalSustain(midi) {
  for (const track of midi.tracks) {
    applyTrack(track);
  }
}

function applyTrack(track) {
  const ccs = (track.controlChanges && track.controlChanges[64]) || [];
  if (ccs.length === 0 || track.notes.length === 0) return;

  // Sort defensively; @tonejs/midi sorts these, but the helper shouldn't
  // care about the source.
  const sustain = [...ccs].sort((a, b) => a.time - b.time);

  // Pre-compute pedal-up (release) times for quick "next release after t" lookup.
  const releases = [];
  let wasDown = false;
  for (const c of sustain) {
    const isDown = c.value >= DOWN_THRESHOLD;
    if (wasDown && !isDown) releases.push(c.time);
    wasDown = isDown;
  }

  // Pedal state at arbitrary time t: scan up to the last CC event with time <= t.
  function pedalDownAt(t) {
    let down = false;
    for (const c of sustain) {
      if (c.time > t + 1e-6) break;
      down = c.value >= DOWN_THRESHOLD;
    }
    return down;
  }

  function nextReleaseAfter(t) {
    for (const r of releases) {
      if (r > t + 1e-6) return r;
    }
    return Infinity;
  }

  // Build a per-pitch sorted index of onsets so we can find the next
  // re-attack of the same pitch (used to cap the extension).
  const byPitch = new Map();
  for (const n of track.notes) {
    let arr = byPitch.get(n.midi);
    if (!arr) {
      arr = [];
      byPitch.set(n.midi, arr);
    }
    arr.push(n);
  }
  for (const arr of byPitch.values()) arr.sort((a, b) => a.time - b.time);

  for (const note of track.notes) {
    const naturalEnd = note.time + note.duration;
    // Only extend if the pedal is still down at the natural release point.
    if (!pedalDownAt(naturalEnd)) continue;

    const release = nextReleaseAfter(naturalEnd);
    // Same-pitch re-attack caps the extension (don't overlap a new strike
    // on the same key with the still-sustained version of itself).
    const sameP = byPitch.get(note.midi);
    let reattack = Infinity;
    for (const candidate of sameP) {
      if (candidate.time > note.time + 1e-6) {
        reattack = candidate.time;
        break;
      }
    }
    const stopAt = Math.min(release, reattack);
    if (stopAt > naturalEnd && stopAt !== Infinity) {
      note.duration = stopAt - note.time;
    }
  }
}
