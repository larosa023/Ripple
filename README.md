<p align="center">
  <img src="app-icon.svg" width="96" alt="Ripple logo" />
</p>

<h1 align="center">Ripple</h1>

<p align="center">A lightweight, fast, and very customizable Stremio-compatible client for Windows.</p>

Ripple keeps Stremio's addon ecosystem intact (any addon that works in Stremio works here) and wraps it in a small native app built with [Tauri](https://tauri.app) and [Svelte](https://svelte.dev). The whole UI is about 150 KB, and the installer is a few megabytes.

## Features

- **Every Stremio addon.** Install from any `manifest.json` or `stremio://` link, or import your entire addon collection from your Stremio account in one step.
- **Addon control.** Enable/disable, drag to reorder priority, open configure pages, update all manifests.
- **Home you design.** Pick which catalogs show on Home and in what order, items per row, Continue Watching.
- **Discover** with type tabs, catalog picker, genre filter, and infinite scroll.
- **Search** across every searchable catalog at once, with results streaming in as each addon answers.
- **Smart stream list.** Streams appear as each addon responds, with quality, size, and HDR/DV/REMUX/cached tags. Sort by quality, size, or addon order; filter by quality, hide CAM releases, hide keywords, or show direct links only. Per-addon filter pills.
- **Plays in mpv, VLC, or any player you choose.** Custom path and arguments, automatic subtitles from subtitle addons in your languages, optional auto-play of the top stream.
- **Library**: saved titles, watch history, watched episodes.
- **Make it yours**: dark / OLED / light themes, any accent color, poster size, compact sidebar, start page, reduced motion.
- **Backup & restore** all settings, addons, and library to a single file.
- **Keyboard:** `Ctrl+K` or `/` to search, `Alt+←` to go back.

## Install

Grab the latest installer from [Releases](../../releases) (or from the latest [Build](../../actions) run's artifacts).

You'll also want a player. mpv is recommended:

```powershell
winget install mpv
```

For torrent (P2P) streams, run [Stremio Service](https://github.com/Stremio/stremio-service) so the streaming server is available at `http://127.0.0.1:11470`. Debrid and direct HTTP streams don't need it.

## Develop

Requirements: Node 20+, Rust (stable), and on Windows the WebView2 runtime (preinstalled on Windows 10/11).

```bash
npm install
npm run tauri dev     # run the app with hot reload
npm run tauri build   # produce the installer in src-tauri/target/release/bundle
npm run check         # type-check
```

`npm run dev` also runs the UI in a normal browser for quick styling work, though some addons block browser requests (CORS) and playback just opens the stream URL.

### Project layout

```
src/
  lib/stremio/    addon protocol client, account import, stream parsing/sorting
  lib/stores/     settings, addons, library, router (persisted, Svelte 5 runes)
  lib/components/ sidebar, posters, catalog rows, stream list
  routes/         Home, Discover, Search, Detail, Library, Addons, Settings
src-tauri/        Rust shell: HTTP (no CORS), external player launcher
```

Releases: push a tag like `v0.1.0` and GitHub Actions builds the Windows installers into a draft release.

## Disclaimer

Ripple is a client only. It does not host, index, or provide any content; what you can watch depends entirely on the addons you choose to install.
