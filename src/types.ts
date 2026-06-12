export type Difficulty = "easy" | "normal" | "hard";

export type ChartSource = "algorithmic" | "curated";

export type SongId =
  | "arabesque"
  | "nocturne"
  | "just-for-today"
  | "waltz-for-tomorrow";

export interface SongMeta {
  id: SongId;
  composer: string;
  title: string;
  subtitle: string;
  midiUrl: string;
  curatedUrl: string;
  /** Optional recorded audio that plays in parallel with MIDI. MP3 for
   *  universal browser support (Safari/iOS don't decode OGG Vorbis). */
  backingUrl?: string;
  /** Reverb wet-mix on the MIDI bus, 0..1. Classical pieces want more
   *  space; pop tracks with an OGG backing carry their own ambience so
   *  they need less. Defaults to a moderate amount if omitted. */
  reverbWet?: number;
}

export const SONGS: Record<SongId, SongMeta> = {
  arabesque: {
    id: "arabesque",
    composer: "C. Debussy",
    title: "Arabesque No.1",
    subtitle: "C. Debussy",
    midiUrl: "/arabesque.mid",
    curatedUrl: "/curated-chart.json",
    reverbWet: 0.35,
  },
  nocturne: {
    id: "nocturne",
    composer: "F. Chopin",
    title: "Nocturne Op.9 No.2",
    subtitle: "F. Chopin",
    midiUrl: "/nocturne.mid",
    curatedUrl: "/nocturne-chart.json",
    reverbWet: 0.4,
  },
  "just-for-today": {
    id: "just-for-today",
    composer: "Punjidixie feat. Miku",
    title: "Just For Today",
    subtitle: "Punjidixie feat. Miku",
    midiUrl: "/just-for-today.mid",
    curatedUrl: "/just-for-today.json",
    backingUrl: "/just-for-today.mp3",
    reverbWet: 0.15,
  },
  "waltz-for-tomorrow": {
    id: "waltz-for-tomorrow",
    composer: "Punjidixie",
    title: "Waltz For Tomorrow",
    subtitle: "Punjidixie",
    midiUrl: "/waltz-for-tomorrow.mid",
    curatedUrl: "/waltz-for-tomorrow.json",
    backingUrl: "/waltz-for-tomorrow.mp3",
    reverbWet: 0.2,
  },
};

export type Judgment = "perfect" | "great" | "good" | "miss";

export interface MidiNote {
  /** Original index into the flat MIDI note list (for de-duplication). */
  id: number;
  /** Seconds from song start. */
  time: number;
  /** Seconds. */
  duration: number;
  /** MIDI note number (e.g. 60 = middle C). */
  midi: number;
  /** 0..1. */
  velocity: number;
  /** Channel/track index, for debug. */
  track: number;
}

/**
 * A note the player must hit. Holds references to one or more underlying MIDI
 * notes which will only sound if this chart note is successfully hit.
 */
export interface ChartNote {
  time: number;
  lane: 0 | 1 | 2 | 3;
  /** MIDI notes that fire on successful hit. */
  audioNotes: MidiNote[];
}

export interface Chart {
  /** Sorted by time ascending. */
  notes: ChartNote[];
  /** MIDI notes that always play (background fillers, sustained bass, etc.). */
  background: MidiNote[];
  /** Total song length in seconds. */
  duration: number;
  difficulty: Difficulty;
}

export interface JudgmentResult {
  judgment: Judgment;
  /** Signed delta in ms: negative = early, positive = late. */
  deltaMs: number;
  note: ChartNote;
}

export interface Settings {
  /** Player-set audio offset in ms (added to the comparison time). */
  offsetMs: number;
  difficulty: Difficulty;
  source: ChartSource;
  song: SongId;
  /** MIDI piano output volume (0..1). */
  midiVolume: number;
  /** Backing-track (OGG) output volume (0..1). */
  backingVolume: number;
  /**
   * Note fall speed. Integer 4..20; 10 = the song's natural lead time, lower
   * means notes fall slower, higher means faster.
   */
  noteSpeed: number;
  /** Debug mode: enables the draggable progress bar for scrubbing through
   *  the song during testing. Off by default. */
  debugMode: boolean;
}

/**
 * Wire format for a curated chart JSON file. Compact field names to keep the
 * file small. Lane indices 0..3.
 */
export interface CuratedChartJson {
  format:
    | "arabesque-rhythm/curated/v1"
    | "nocturne-rhythm/curated/v1"
    | "just-for-today-rhythm/curated/v1"
    | "waltz-for-tomorrow-rhythm/curated/v1";
  duration: number;
  notes: Array<{
    t: number; // time in seconds
    l: 0 | 1 | 2 | 3;
    m: number; // MIDI pitch
    d: number; // duration
    v: number; // velocity (0..1)
  }>;
  background: Array<{
    t: number;
    m: number;
    d: number;
    v: number;
  }>;
}

export interface ScoreState {
  score: number;
  combo: number;
  maxCombo: number;
  counts: Record<Judgment, number>;
  totalNotes: number;
}

export const JUDGE_WINDOWS_MS = {
  perfect: 80,
  great: 160,
  good: 240,
} as const;

/**
 * Cytus-style scoring weights. Each note is worth (MAX_SCORE / totalNotes)
 * scaled by this multiplier - so the top of the chart is always 1,000,000
 * regardless of song length. No combo bonus.
 */
export const MAX_SCORE = 1_000_000;
export const NOTE_WEIGHT: Record<Judgment, number> = {
  perfect: 1.0,
  great: 0.7,
  good: 0.3,
  miss: 0,
};

export const KEY_FOR_LANE = ["d", "f", "j", "k"] as const;
