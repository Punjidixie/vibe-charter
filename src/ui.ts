import type { ScoreState, Settings, SongId } from "./types";
import { SONGS } from "./types";

const VALID_SONGS: ReadonlySet<SongId> = new Set(
  Object.keys(SONGS) as SongId[],
);
import { computeAccuracy, computeGrade } from "./engine";

const STORAGE_KEY = "arabesque-rhythm:settings";

const clamp01 = (v: unknown, fallback: number): number => {
  if (typeof v !== "number" || !isFinite(v)) return fallback;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
};
/** Internal note-speed range. The slider shows `internal - SPEED_OFFSET`
 *  to the user, so a 5..24 internal range surfaces as 1..20 in the UI. */
const SPEED_MIN = 5;
const SPEED_MAX = 24;
const SPEED_OFFSET = SPEED_MIN - 1;
const clampSpeed = (v: unknown): number =>
  typeof v === "number" && v >= SPEED_MIN && v <= SPEED_MAX
    ? Math.round(v)
    : 10;

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return {
        offsetMs: typeof parsed.offsetMs === "number" ? parsed.offsetMs : 0,
        difficulty:
          parsed.difficulty === "easy" || parsed.difficulty === "hard"
            ? parsed.difficulty
            : "normal",
        source: "curated",
        song:
          parsed.song && VALID_SONGS.has(parsed.song as SongId)
            ? (parsed.song as SongId)
            : "arabesque",
        midiVolume: clamp01(parsed.midiVolume, 0.85),
        backingVolume: clamp01(parsed.backingVolume, 0.55),
        noteSpeed: clampSpeed(parsed.noteSpeed),
        debugMode: parsed.debugMode === true,
      };
    }
  } catch {
    // ignore parse errors, fall through to defaults
  }
  return {
    offsetMs: 0,
    difficulty: "normal",
    source: "curated",
    song: "arabesque",
    midiVolume: 0.85,
    backingVolume: 0.55,
    noteSpeed: 10,
    debugMode: false,
  };
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export interface StartScreenCallbacks {
  onPlay: (settings: Settings) => void;
  /** Fires whenever the user moves a volume slider (for live tweaking when an
   * audio engine already exists from a previous play). */
  onVolumeChange?: (s: Settings) => void;
  /** Fires whenever the user moves the note-speed slider (live visual). */
  onSpeedChange?: (s: Settings) => void;
}

export interface PauseMenuCallbacks {
  onResume: () => void;
  onRestart: () => void;
  onMenu: () => void;
}

export class UIController {
  private overlay: HTMLElement;
  private hud: HTMLElement | null = null;
  private pauseEl: HTMLElement | null = null;
  private resumeEl: HTMLElement | null = null;
  private resumeSwitchTimer: number | null = null;
  private settings: Settings;

  constructor(overlay: HTMLElement) {
    this.overlay = overlay;
    this.settings = loadSettings();
  }

  /** Apply or clear the canvas blur (used between gameplay and menu/results). */
  private setStageBlur(blurred: boolean): void {
    document.body.classList.toggle("is-stage-blurred", blurred);
  }

  showStart(cb: StartScreenCallbacks): void {
    this.setStageBlur(true);
    this.overlay.innerHTML = "";
    const root = document.createElement("div");
    root.className = "screen screen--start";
    const song = SONGS[this.settings.song];
    root.innerHTML = `
      <div class="title">
        <h1 class="title__main">Vibe Charter</h1>
        <div class="title__sub">
          <span>Composed by humans</span>
          <span>Charted by AI</span>
        </div>
      </div>
      <div class="panel panel--main">
        <div class="panel__group">
          <div class="panel__label">Song</div>
          <div class="songs" role="radiogroup" aria-label="Song">
            ${(Object.values(SONGS) as typeof song[])
              .map((s) => {
                const sel = s.id === this.settings.song;
                return `<button class="song__btn ${sel ? "is-selected" : ""}" data-song="${s.id}" role="radio" aria-checked="${sel}">
                  <div class="song__title">${s.title}</div>
                  <div class="song__sub">${s.subtitle}</div>
                </button>`;
              })
              .join("")}
          </div>
        </div>
        <div class="panel__group panel__group--keys">
          <div class="keys">
            <kbd>D</kbd><kbd>F</kbd><kbd>J</kbd><kbd>K</kbd>
          </div>
          <div class="panel__hint panel__hint--center">
            Hit the falling notes to play the melody. Miss them and they go silent.
          </div>
        </div>
        <button class="btn btn--play" id="play">Play</button>
      </div>
      <div class="panel panel--options">
        <div class="panel__group">
          <div class="panel__label">
            Audio offset
            <span class="panel__hint">If notes feel late, move slider right.</span>
          </div>
          <div class="offset">
            <input id="offset" type="range" min="-200" max="200" step="5" value="${this.settings.offsetMs}" />
            <output id="offset-val" for="offset">${this.settings.offsetMs} ms</output>
          </div>
        </div>
        <div class="panel__group">
          <div class="panel__label">
            Note speed
            <span class="panel__hint">Visual only - tap timing unchanged.</span>
          </div>
          <div class="offset">
            <input id="speed" type="range" min="${SPEED_MIN}" max="${SPEED_MAX}" step="1" value="${this.settings.noteSpeed}" />
            <output id="speed-val" for="speed">${this.settings.noteSpeed - SPEED_OFFSET}</output>
          </div>
        </div>
        <div class="panel__group">
          <div class="panel__label">Volume</div>
          <div class="vol">
            <label class="vol__row">
              <span class="vol__name">MIDI piano</span>
              <input id="vol-midi" type="range" min="0" max="100" step="1" value="${Math.round(this.settings.midiVolume * 100)}" />
              <output id="vol-midi-val" for="vol-midi">${Math.round(this.settings.midiVolume * 100)}%</output>
            </label>
            <label class="vol__row ${song.backingUrl ? "" : "vol__row--disabled"}" id="vol-bg-row">
              <span class="vol__name">Backing track</span>
              <input id="vol-bg" type="range" min="0" max="100" step="1" value="${Math.round(this.settings.backingVolume * 100)}" ${song.backingUrl ? "" : "disabled"} />
              <output id="vol-bg-val" for="vol-bg">${Math.round(this.settings.backingVolume * 100)}%</output>
            </label>
          </div>
        </div>
        <div class="panel__group">
          <label class="toggle">
            <input id="debug-mode" type="checkbox" ${this.settings.debugMode ? "checked" : ""} />
            <span class="toggle__box"></span>
            <span class="toggle__text">
              Debug mode
              <span class="panel__hint">Unlocks seeking the timeline.</span>
            </span>
          </label>
        </div>
      </div>
    `;
    this.overlay.appendChild(root);

    const songButtons = root.querySelectorAll<HTMLButtonElement>(".song__btn");
    songButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.song as SongId;
        this.settings.song = id;
        songButtons.forEach((b) => {
          const sel = b === btn;
          b.classList.toggle("is-selected", sel);
          b.setAttribute("aria-checked", String(sel));
        });
        const meta = SONGS[id];
        const bgRow = root.querySelector<HTMLElement>("#vol-bg-row");
        const bgInputEl = root.querySelector<HTMLInputElement>("#vol-bg");
        if (bgRow) bgRow.classList.toggle("vol__row--disabled", !meta.backingUrl);
        if (bgInputEl) bgInputEl.disabled = !meta.backingUrl;
        saveSettings(this.settings);
      });
    });

    const offsetInput = root.querySelector<HTMLInputElement>("#offset")!;
    const offsetOut = root.querySelector<HTMLOutputElement>("#offset-val")!;
    offsetInput.addEventListener("input", () => {
      const v = Number(offsetInput.value);
      this.settings.offsetMs = v;
      offsetOut.value = `${v} ms`;
      saveSettings(this.settings);
    });

    const speedInput = root.querySelector<HTMLInputElement>("#speed")!;
    const speedOut = root.querySelector<HTMLOutputElement>("#speed-val")!;
    speedInput.addEventListener("input", () => {
      const v = Number(speedInput.value);
      this.settings.noteSpeed = v;
      speedOut.value = `${v - SPEED_OFFSET}`;
      saveSettings(this.settings);
      cb.onSpeedChange?.({ ...this.settings });
    });

    const midiInput = root.querySelector<HTMLInputElement>("#vol-midi")!;
    const midiOut = root.querySelector<HTMLOutputElement>("#vol-midi-val")!;
    midiInput.addEventListener("input", () => {
      const v = Number(midiInput.value) / 100;
      this.settings.midiVolume = v;
      midiOut.value = `${Math.round(v * 100)}%`;
      saveSettings(this.settings);
      cb.onVolumeChange?.({ ...this.settings });
    });
    const debugInput = root.querySelector<HTMLInputElement>("#debug-mode")!;
    debugInput.addEventListener("change", () => {
      this.settings.debugMode = debugInput.checked;
      saveSettings(this.settings);
    });

    const bgInput = root.querySelector<HTMLInputElement>("#vol-bg")!;
    const bgOut = root.querySelector<HTMLOutputElement>("#vol-bg-val")!;
    bgInput.addEventListener("input", () => {
      const v = Number(bgInput.value) / 100;
      this.settings.backingVolume = v;
      bgOut.value = `${Math.round(v * 100)}%`;
      saveSettings(this.settings);
      cb.onVolumeChange?.({ ...this.settings });
    });

    root.querySelector<HTMLButtonElement>("#play")!.addEventListener("click", () => {
      cb.onPlay({ ...this.settings });
    });
  }

  showLoading(message = "Tuning the piano..."): void {
    this.setStageBlur(true);
    this.overlay.innerHTML = "";
    const root = document.createElement("div");
    root.className = "screen screen--loading";
    root.innerHTML = `
      <div class="loading">
        <div class="loading__spinner"></div>
        <div class="loading__text">${message}</div>
      </div>
    `;
    this.overlay.appendChild(root);
  }

  attachHUD(opts: {
    duration: number;
    onSeek: (t: number) => void;
    /** If true, the player can click/drag the timeline to seek. Otherwise
     *  the bar shows progress only and is non-interactive. */
    debugMode: boolean;
  }): void {
    this.setStageBlur(false);
    this.overlay.innerHTML = "";
    const hud = document.createElement("div");
    hud.className = "hud";
    hud.innerHTML = `
      <div class="hud__top">
        <div class="hud__seek ${opts.debugMode ? "hud__seek--debug" : "hud__seek--locked"}" id="hud-seek">
          <span class="hud__seek-time" id="hud-seek-cur">0:00</span>
          <div class="hud__seek-bar" id="hud-seek-bar" title="${opts.debugMode ? "Click or drag to seek" : "Debug mode off"}">
            <div class="hud__seek-fill" id="hud-seek-fill"></div>
            <div class="hud__seek-knob" id="hud-seek-knob"></div>
          </div>
          <span class="hud__seek-time" id="hud-seek-tot">${formatTime(opts.duration)}</span>
        </div>
        <div class="hud__score">
          <span class="hud__score-value" id="hud-score">0</span>
        </div>
      </div>
      <div class="hud__side hud__side--left">
        <div class="hud__combo" id="hud-combo"></div>
      </div>
      <div class="hud__side hud__side--right">
        <div class="hud__acc">
          <div class="hud__acc-label">Accuracy</div>
          <div class="hud__acc-value" id="hud-acc">100.0%</div>
        </div>
      </div>
      <div class="hud__preroll" id="hud-preroll">Ready</div>
    `;
    this.overlay.appendChild(hud);
    this.hud = hud;

    if (opts.debugMode) {
      const bar = hud.querySelector<HTMLElement>("#hud-seek-bar")!;
      const seekFromEvent = (clientX: number): void => {
        const rect = bar.getBoundingClientRect();
        const frac = Math.max(
          0,
          Math.min(1, (clientX - rect.left) / rect.width),
        );
        opts.onSeek(frac * opts.duration);
      };
      let dragging = false;
      bar.addEventListener("mousedown", (e) => {
        dragging = true;
        seekFromEvent(e.clientX);
        e.preventDefault();
      });
      window.addEventListener("mousemove", (e) => {
        if (dragging) seekFromEvent(e.clientX);
      });
      window.addEventListener("mouseup", () => {
        dragging = false;
      });
      bar.addEventListener("touchstart", (e) => {
        if (e.touches[0]) seekFromEvent(e.touches[0].clientX);
      });
      bar.addEventListener("touchmove", (e) => {
        if (e.touches[0]) seekFromEvent(e.touches[0].clientX);
        e.preventDefault();
      });
    }
  }

  updateHUD(
    score: ScoreState,
    songTime: number,
    preroll: boolean,
    duration: number,
  ): void {
    if (!this.hud) return;
    (this.hud.querySelector("#hud-score") as HTMLElement).textContent =
      Math.round(score.score).toLocaleString();
    const acc = computeAccuracy(score);
    (this.hud.querySelector("#hud-acc") as HTMLElement).textContent = `${(acc * 100).toFixed(1)}%`;
    const comboEl = this.hud.querySelector("#hud-combo") as HTMLElement;
    if (score.combo >= 4) {
      comboEl.innerHTML = `<div class="combo__n">${score.combo}</div><div class="combo__l">combo</div>`;
      comboEl.classList.add("is-visible");
    } else {
      comboEl.classList.remove("is-visible");
      comboEl.innerHTML = "";
    }
    const preEl = this.hud.querySelector("#hud-preroll") as HTMLElement;
    if (preroll) {
      const remaining = Math.max(0, -songTime);
      preEl.style.opacity = "1";
      preEl.textContent = remaining > 0.6 ? "Ready" : "Go!";
    } else {
      preEl.style.opacity = "0";
    }
    const clamped = Math.max(0, Math.min(duration, songTime));
    const frac = duration > 0 ? clamped / duration : 0;
    const fill = this.hud.querySelector("#hud-seek-fill") as HTMLElement;
    const knob = this.hud.querySelector("#hud-seek-knob") as HTMLElement;
    if (fill) fill.style.width = `${frac * 100}%`;
    if (knob) knob.style.left = `${frac * 100}%`;
    const curEl = this.hud.querySelector("#hud-seek-cur") as HTMLElement;
    if (curEl) curEl.textContent = formatTime(clamped);
  }

  showResults(
    score: ScoreState,
    callbacks: { onRetry: () => void; onMenu: () => void },
    meta?: { song: SongId; debugMode: boolean },
  ): void {
    this.setStageBlur(true);
    this.overlay.innerHTML = "";
    const grade = computeGrade(score);
    const acc = computeAccuracy(score);
    const root = document.createElement("div");
    root.className = "screen screen--results";
    const song = meta ? SONGS[meta.song] : null;
    const songBlock = song
      ? `<div class="results__song">
          <div class="results__song-title">${song.title}</div>
          <div class="results__song-sub">${song.subtitle}${
            meta?.debugMode
              ? ' <span class="results__debug-badge">Debug mode</span>'
              : ""
          }</div>
        </div>`
      : "";
    root.innerHTML = `
      <div class="results">
        ${songBlock}
        <div class="results__grade results__grade--${grade}">${grade}</div>
        <div class="results__main">
          <div class="results__row">
            <div class="results__label">Score</div>
            <div class="results__value">${Math.round(score.score).toLocaleString()}</div>
          </div>
          <div class="results__row">
            <div class="results__label">Accuracy</div>
            <div class="results__value">${(acc * 100).toFixed(2)}%</div>
          </div>
          <div class="results__row">
            <div class="results__label">Max Combo</div>
            <div class="results__value">${score.maxCombo}</div>
          </div>
          <div class="results__breakdown">
            <div><span class="dot dot--perfect"></span>Perfect <b>${score.counts.perfect}</b></div>
            <div><span class="dot dot--great"></span>Great <b>${score.counts.great}</b></div>
            <div><span class="dot dot--good"></span>Good <b>${score.counts.good}</b></div>
            <div><span class="dot dot--miss"></span>Miss <b>${score.counts.miss}</b></div>
          </div>
        </div>
        <div class="results__actions">
          <button class="btn" id="retry">Retry</button>
          <button class="btn btn--ghost" id="menu">Menu</button>
        </div>
      </div>
    `;
    this.overlay.appendChild(root);
    root.querySelector<HTMLButtonElement>("#retry")!.addEventListener("click", callbacks.onRetry);
    root.querySelector<HTMLButtonElement>("#menu")!.addEventListener("click", callbacks.onMenu);
  }

  /**
   * Show the in-game pause menu. Appended on top of the live HUD (the HUD
   * stays in the DOM so we can fall right back to it on resume).
   */
  showPauseMenu(cb: PauseMenuCallbacks): void {
    this.hidePauseMenu();
    const root = document.createElement("div");
    root.className = "pause";
    root.innerHTML = `
      <div class="pause__card">
        <div class="pause__eyebrow">Paused</div>
        <h2 class="pause__title">Take a breath</h2>
        <div class="pause__actions">
          <button class="btn" id="pause-resume">Continue</button>
          <button class="btn btn--ghost" id="pause-restart">Restart song</button>
          <button class="btn btn--ghost" id="pause-menu">Quit to title</button>
        </div>
        <div class="pause__hint">Press <kbd>Esc</kbd> to continue</div>
      </div>
    `;
    this.overlay.appendChild(root);
    this.pauseEl = root;
    root.querySelector<HTMLButtonElement>("#pause-resume")!
      .addEventListener("click", cb.onResume);
    root.querySelector<HTMLButtonElement>("#pause-restart")!
      .addEventListener("click", cb.onRestart);
    root.querySelector<HTMLButtonElement>("#pause-menu")!
      .addEventListener("click", cb.onMenu);
  }

  hidePauseMenu(): void {
    if (this.pauseEl && this.pauseEl.parentElement) {
      this.pauseEl.parentElement.removeChild(this.pauseEl);
    }
    this.pauseEl = null;
  }

  /**
   * Show a "Ready... Go!" countdown overlay for `durationMs` ms. Caller is
   * responsible for actually resuming gameplay when the countdown ends -
   * this method just paints the visual and exposes hideResumeCountdown for
   * aborts (e.g. the player presses Esc again to cancel resuming).
   */
  showResumeCountdown(durationMs: number): void {
    this.hideResumeCountdown();
    const root = document.createElement("div");
    root.className = "resume";
    root.innerHTML = `<div class="resume__text">Ready</div>`;
    this.overlay.appendChild(root);
    this.resumeEl = root;
    const swapAt = Math.max(0, Math.round(durationMs * 0.67));
    this.resumeSwitchTimer = window.setTimeout(() => {
      this.resumeSwitchTimer = null;
      if (this.resumeEl !== root) return;
      const t = root.querySelector<HTMLElement>(".resume__text");
      if (!t) return;
      t.textContent = "Go!";
      t.classList.add("resume__text--go");
    }, swapAt);
  }

  hideResumeCountdown(): void {
    if (this.resumeSwitchTimer != null) {
      window.clearTimeout(this.resumeSwitchTimer);
      this.resumeSwitchTimer = null;
    }
    if (this.resumeEl && this.resumeEl.parentElement) {
      this.resumeEl.parentElement.removeChild(this.resumeEl);
    }
    this.resumeEl = null;
  }

  clear(): void {
    if (this.resumeSwitchTimer != null) {
      window.clearTimeout(this.resumeSwitchTimer);
      this.resumeSwitchTimer = null;
    }
    this.overlay.innerHTML = "";
    this.hud = null;
    this.pauseEl = null;
    this.resumeEl = null;
  }

  get currentSettings(): Settings {
    return { ...this.settings };
  }
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}
