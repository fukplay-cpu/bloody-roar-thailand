# BLOODY ROAR 2 THAILAND

Mobile-friendly fan project for launching the PlayStation emulator in a browser.

## Included
- `index.html` — Thai landing page and launcher. The single-player option opens `lecteur-psx.html`.
- `lecteur-psx.html` — existing PS1 emulator. Supports local game files such as `.cue` + matching `.bin`, `.chd`, `.pbp`, `.iso`, and related formats.
- `sw.js` — service worker used by the emulator for offline caching and cross-origin isolation headers.
- `LICENSE` and `CREDITS.md` — project license and credits.

## Use
Deploy the repository root with GitHub Pages. Open the site, choose single-player, then select the legally obtained game files from the device. Keep each `.cue` file together with its matching `.bin` file.

## Project status
The emulator and local file-selection path are the active baseline. The V3 remote ZIP/Worker autoload experiment and its diagnostic pages are intentionally not wired into this production baseline; keep the original backup ZIP for those experiments. Online multiplayer is not implemented.
