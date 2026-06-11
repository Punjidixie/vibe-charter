# Vibe Charter

A four-lane falling-note rhythm game in the browser, with charts curated by an AI for music composed by humans.

> **Composed by humans / Charted by AI**

[**▶ Play it live**](https://punjidixie.github.io/vibe-charter/)

## Songs

| Title | Composer |
| --- | --- |
| Arabesque No. 1 | C. Debussy |
| Nocturne Op. 9 No. 2 | F. Chopin |
| Just For Today | Punjidixie feat. Mike |
| Waltz For Tomorrow | Punjidixie |

## Controls

- **D F J K** — lanes 1 / 2 / 3 / 4
- **Esc** — pause / resume (1.5 s countdown on resume)
- **Enter / Click Play** — start the selected song

Hit the falling notes when they cross the judgment line. Cytus-style scoring out of 1,000,000, weighted by judgment quality (Perfect = 1.0, Great = 0.7, Good = 0.3, Miss = 0). No combo bonus.

## Settings

The start screen exposes:

- Song picker
- Difficulty / chart source (curated where available)
- Audio offset (ms)
- MIDI volume (drives the piano soundfont)
- Backing track volume (for songs with an OGG layer)
- Note fall speed (visual only — does not change timing)
- Debug mode (unlocks the seekable progress bar)

All settings persist to `localStorage`.

## Tech

- **Vite** + **TypeScript** + HTML5 Canvas
- **Web Audio API** + [`soundfont-player`](https://github.com/danigb/soundfont-player) for the piano voice
- [`@tonejs/midi`](https://github.com/Tonejs/Midi) for MIDI parsing
- Custom chart builders under `scripts/build-*.mjs` (Node)

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # local production build (base = "/")
```

To preview the GitHub Pages build (assets under `/vibe-charter/`):

```bash
npm run build:pages
npm run preview
```

## Rebuilding charts

The curated chart JSONs are committed under `public/`. To regenerate one:

```bash
node scripts/build-curated.mjs            # Arabesque
node scripts/build-nocturne.mjs           # Nocturne
node scripts/build-just-for-today.mjs     # Just For Today
node scripts/build-waltz.mjs              # Waltz For Tomorrow
```

## Deployment

Every push to `main` triggers `.github/workflows/deploy.yml`, which builds with `GITHUB_PAGES=true` and publishes `dist/` to GitHub Pages.

## Credits

- **Just For Today** and **Waltz For Tomorrow** composed by Punjidixie.
- **Arabesque No. 1** and **Nocturne Op. 9 No. 2** are public-domain piano works by Debussy and Chopin.
- Charts curated by Claude (Anthropic) inside the Cursor IDE.

<!-- deploy: 2026-06-11T15:20:22Z -->
