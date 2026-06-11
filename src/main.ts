import { AudioEngine } from "./audio";
import { loadChart, loadCuratedChart } from "./chart";
import { GameEngine } from "./engine";
import { UIController } from "./ui";
import { SONGS, type Settings } from "./types";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const overlay = document.getElementById("overlay") as HTMLElement;
if (!canvas || !overlay) throw new Error("Missing DOM scaffolding");

const ui = new UIController(overlay);
let audio: AudioEngine | null = null;
let game: GameEngine | null = null;
let lastSettings: Settings | null = null;

function showMenu(): void {
  ui.showStart({
    onPlay: (settings) => startGame(settings),
    onVolumeChange: (s) => {
      audio?.setMidiVolume(s.midiVolume);
      audio?.setBackingVolume(s.backingVolume);
    },
    onSpeedChange: (s) => {
      game?.setNoteSpeed(s.noteSpeed);
    },
  });
}

async function startGame(settings: Settings): Promise<void> {
  lastSettings = settings;
  ui.showLoading("Tuning the piano...");
  try {
    if (!audio) audio = new AudioEngine();
    await audio.resume();
    if (game) {
      game.stop();
      game = null;
    }

    const song = SONGS[settings.song];
    const chartPromise =
      settings.source === "curated"
        ? loadCuratedChart(song.curatedUrl)
        : loadChart(song.midiUrl, settings.difficulty);
    const [chart] = await Promise.all([
      chartPromise,
      audio.load(),
      audio.loadBacking(song.backingUrl ?? null),
    ]);
    audio.setMidiVolume(settings.midiVolume);
    audio.setBackingVolume(settings.backingVolume);

    game = new GameEngine(canvas, chart, settings, audio);
    ui.attachHUD({
      duration: game.duration,
      onSeek: (t) => game?.seek(t),
      debugMode: settings.debugMode,
    });
    const duration = game.duration;
    game.on((e) => {
      if (e.kind === "tick") {
        ui.updateHUD(e.score, e.songTime, e.preroll, duration);
      } else if (e.kind === "finished") {
        showResults(settings);
      }
    });
    await game.start();
  } catch (err) {
    console.error(err);
    ui.showLoading("Failed to load. Refresh to retry.");
  }
}

function showResults(lastSettings: Settings): void {
  if (!game) return;
  const score = game.score;
  ui.showResults(
    score,
    {
      onRetry: () => startGame(lastSettings),
      onMenu: () => {
        game?.stop();
        game = null;
        showMenu();
      },
    },
    { song: lastSettings.song, debugMode: lastSettings.debugMode },
  );
}

/** Length of the "Ready... Go!" countdown shown before resuming gameplay. */
const RESUME_COUNTDOWN_MS = 1500;
let resumeTimer: number | null = null;

function showPauseMenu(): void {
  ui.showPauseMenu({
    onResume: resumeGame,
    onRestart: () => {
      cancelResumeCountdown();
      ui.hidePauseMenu();
      if (!lastSettings) return;
      const s = lastSettings;
      game?.stop();
      game = null;
      void startGame(s);
    },
    onMenu: () => {
      cancelResumeCountdown();
      ui.hidePauseMenu();
      game?.stop();
      game = null;
      showMenu();
    },
  });
}

function pauseGame(): void {
  if (!game || !game.isRunning) return;
  game.pause();
  showPauseMenu();
}

function resumeGame(): void {
  if (!game || !game.isPaused) return;
  if (resumeTimer != null) return;
  ui.hidePauseMenu();
  ui.showResumeCountdown(RESUME_COUNTDOWN_MS);
  resumeTimer = window.setTimeout(() => {
    resumeTimer = null;
    ui.hideResumeCountdown();
    if (game && game.isPaused) void game.resumeFromPause();
  }, RESUME_COUNTDOWN_MS);
}

/** Abort an in-flight resume countdown (player pressed Esc again, or chose
 *  Restart/Menu from a re-shown pause menu). The game stays paused. */
function cancelResumeCountdown(): void {
  if (resumeTimer != null) {
    window.clearTimeout(resumeTimer);
    resumeTimer = null;
  }
  ui.hideResumeCountdown();
}

window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!game) return;
  if (resumeTimer != null) {
    e.preventDefault();
    cancelResumeCountdown();
    showPauseMenu();
    return;
  }
  if (game.isPaused) {
    e.preventDefault();
    resumeGame();
  } else if (game.isRunning) {
    e.preventDefault();
    pauseGame();
  }
});

showMenu();
