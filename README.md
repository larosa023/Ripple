<p align="center">
  <img src="app-icon.svg" width="96" alt="Ripple logo" />
</p>

<h1 align="center">Ripple</h1>

<p align="center">A lightweight, fast, and very customizable Stremio-compatible client for Windows.</p>

Ripple keeps Stremio's addon ecosystem intact (any addon that works in Stremio works here) and wraps it in a small native app built with [Tauri](https://tauri.app) and [Svelte](https://svelte.dev). The whole UI is about 150 KB, and the installer is a few megabytes.

## Features

- **Every Stremio addon.** Install from any `manifest.json` or `stremio://` link, or import your entire addon collection from your Stremio account in one step.
- **Addon control.** Enable/disable, drag to reorder priority, open configure pages, update all manifests.
- **Customize studio** (brush icon or `Ctrl+Shift+C`): a live slide-in editor for everything below.
  - **14 contrast-checked theme presets** (12 dark, 2 light) with live mini previews, quick accent colors, a full 7-color editor, **8 font pairings** and custom font upload, UI scale, corner radius, button shape.
  - **5 navigation layouts**: sidebar, labeled rail, icon rail, top bar, floating dock. Hide or reorder nav items.
  - **5 card styles** (plain, outlined, raised, glass, title overlay), 4 hover effects, 4 sizes, 3 spacing densities.
  - **Rotating hero banner** (full, compact, or off) from any catalog, with adjustable rotation.
  - **Home rows you design**: drag to reorder, rename, and show each as posters, wide backdrops, or a Top 10 with rank numerals.
  - **Title pages**: cinematic or classic layout, backdrop strength, episodes as list or grid.
  - **Backgrounds**: your own image with dim and blur, or animated aurora / bokeh.
  - **Custom CSS** with a cheat sheet, and a **theme library**: save looks, share them as `.ripplestyle` files, import others'.
- **Seamless window**: Ripple draws its own themed title bar (or switch back to the Windows one in Settings).
- **Drag to scroll**: click and drag any row to pan through it, with momentum.
- **Discover** with type tabs, catalog picker, genre filter, and infinite scroll.
- **Search** across every searchable catalog at once, with results streaming in as each addon answers.
- **Smart stream list.** Streams appear as each addon responds, with quality, size, and HDR/DV/REMUX/cached tags. Sort by quality, size, or addon order; filter by quality, hide CAM releases, hide keywords, or show direct links only. Per-addon filter pills.
- **Plays in mpv, VLC, or any player you choose.** Custom path and arguments, automatic subtitles from subtitle addons in your languages, optional auto-play of the top stream.
- **Library**: saved titles, watch history, watched episodes.
- **Built-in updates.** Ripple checks GitHub Releases on launch and offers a one-click upgrade when a newer version is published.
- **Backup & restore** all settings, addons, and library to a single file.
- **Keyboard:** `Ctrl+K` or `/` to search, `Alt+←` to go back.

## Install

Grab the latest installer from [Releases](../../releases) (the `.exe` is the one to grab).

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
  lib/theme/      look store, presets, fonts, theme files
  lib/components/ nav, hero, posters, catalog rows, stream list, Customize studio
  routes/         Home, Discover, Search, Detail, Library, Addons, Settings
src-tauri/        Rust shell: HTTP (no CORS), external player launcher
```

Releases: every push to `main` builds the Windows installers and publishes them to a GitHub Release named after the version in `src-tauri/tauri.conf.json`. Bump the version (also in `package.json` and `src-tauri/Cargo.toml`) to cut a new release; installed copies will then offer the update. Pushes without a version bump don't trigger updates.

## Disclaimer

Ripple is a client only. It does not host, index, or provide any content; what you can watch depends entirely on the addons you choose to install.
