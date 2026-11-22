// What WebView2 shows wherever the page hasn't painted yet (during a resize, maximize,
// fullscreen switch or a frame between pages). The window is transparent so mpv's video can
// show through the page, so without this those moments let the desktop show through.
// Solid in the theme color at all times, except while a video is on screen.
import { isTauri } from './stremio/http';

let want = '';
let applied = '';
let busy = false;

function rgba(hex: string): [number, number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (!/^[0-9a-f]{6}/i.test(h) || Number.isNaN(n)) return [11, 13, 18, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

async function flush() {
  if (busy || !isTauri) return;
  busy = true;
  try {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview');
    // Re-check after each call: the wish may have changed while the last one was in flight.
    while (applied !== want) {
      const next = want;
      await getCurrentWebview()
        .setBackgroundColor(next === 'clear' ? [0, 0, 0, 0] : rgba(next))
        .catch(() => {});
      applied = next;
    }
  } finally {
    busy = false;
  }
}

let theme = '#0b0d12';
let clear = false;

/** The theme's background color changed. */
export function setBackdropColor(hex: string) {
  theme = hex;
  want = clear ? 'clear' : theme;
  void flush();
}

/** A video is (or isn't) showing behind the page. */
export function setBackdropClear(on: boolean) {
  clear = on;
  want = clear ? 'clear' : theme;
  void flush();
}
