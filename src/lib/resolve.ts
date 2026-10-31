// Resolves debrid "resolve" links (Torrentio, etc.) to the final download URL
// before playback, so the player opens the file directly instead of making the
// addon re-resolve on every request, and so Ripple can recognise the addon's
// placeholder videos ("being downloaded to debrid…") and retry instead.
import { isTauri } from './stremio/http';

export type Placeholder = 'downloading' | 'failed' | 'limit' | 'access';

export class DebridPlaceholder extends Error {
  constructor(public kind: Placeholder) {
    super(
      kind === 'downloading'
        ? "Real-Debrid is still downloading this file, so it isn't ready to stream yet. Try again in a bit or pick another source."
        : kind === 'limit'
          ? 'Your debrid service says you hit a limit (too many downloads or streams). Try again later.'
          : kind === 'access'
            ? "Your debrid service refused access. Check that your subscription is active and the addon's API key is right."
            : "The debrid service couldn't get this file. Pick another source.",
    );
  }
}

/** Addon placeholder videos, e.g. torrentio …/videos/downloading_v2.mp4 */
export function placeholderKind(url: string): Placeholder | null {
  const m = /\/videos?\/([a-z_]+?)(?:_v\d+)?\.mp4(?:$|\?)/i.exec(url);
  if (!m) return null;
  const name = m[1].toLowerCase();
  if (name.includes('download') && !name.includes('fail')) return 'downloading';
  if (name.includes('limit')) return 'limit';
  if (name.includes('access') || name.includes('blocked')) return 'access';
  if (name.includes('fail') || name.includes('infected') || name.includes('too_big') || name.includes('rar')) return 'failed';
  return null;
}

type TauriInit = RequestInit & { maxRedirections?: number };

/**
 * Follows the addon's redirect (only hops on the addon's own host) and returns
 * the final URL. Never downloads the file itself. Falls back to the original
 * URL if anything is unexpected.
 */
async function resolveOnce(url: string, headers: [string, string][]): Promise<string> {
  const { fetch } = await import('@tauri-apps/plugin-http');
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let res: Response;
    try {
      res = await fetch(current, { method: 'GET', headers, signal: ctrl.signal, maxRedirections: 0 } as TauriInit);
    } finally {
      clearTimeout(timer);
    }
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      ctrl.abort(); // no body wanted
      const next = new URL(loc, current).toString();
      if (placeholderKind(next)) return next;
      // Another hop on the same host (some addons redirect twice); otherwise we've reached the file host.
      if (new URL(next).host === new URL(current).host) {
        current = next;
        continue;
      }
      return next;
    }
    // Not a redirect: the addon streams the file itself. Don't download it here.
    ctrl.abort();
    return current;
  }
  return current;
}

/** Final playable URL for a debrid stream, retrying while the debrid service prepares it. */
export async function resolveDebrid(
  url: string,
  headers: [string, string][],
  onWait?: (attempt: number) => void,
): Promise<string> {
  if (!isTauri || !/^https?:/i.test(url)) return url;
  const waits = [2500, 3500, 5000];
  for (let attempt = 0; ; attempt++) {
    let final: string;
    try {
      final = await resolveOnce(url, headers);
    } catch {
      return url; // network hiccup or unusual addon: let the player try the original link
    }
    const kind = placeholderKind(final);
    if (!kind) return final;
    if (kind !== 'downloading' || attempt >= waits.length) throw new DebridPlaceholder(kind);
    onWait?.(attempt + 1);
    await new Promise((r) => setTimeout(r, waits[attempt]));
  }
}
