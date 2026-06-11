declare module "soundfont-player" {
  export interface PlayOptions {
    duration?: number;
    gain?: number;
    attack?: number;
    decay?: number;
    sustain?: number;
    release?: number;
  }

  export interface Player {
    play(
      note: string | number,
      when?: number,
      options?: PlayOptions,
    ): { stop(when?: number): void };
    stop(when?: number): void;
    on(event: string, fn: (...args: unknown[]) => void): void;
  }

  export interface InstrumentOptions {
    soundfont?: "MusyngKite" | "FluidR3_GM";
    format?: "mp3" | "ogg";
    gain?: number;
    nameToUrl?: (name: string, soundfont?: string, format?: string) => string;
    notes?: string[];
  }

  export function instrument(
    ac: AudioContext,
    name: string,
    options?: InstrumentOptions,
  ): Promise<Player>;

  const Soundfont: {
    instrument: typeof instrument;
  };
  export default Soundfont;
}
