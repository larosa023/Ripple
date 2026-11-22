// "Keep next episodes downloaded": for shows you're watching, quietly keeps the next 1–3
// unwatched episodes downloaded, so the next one always plays instantly.
import { isTauri } from './stremio/http';
import { enabledAddons } from './stores/addons.svelte';
import { library } from './stores/library.svelte';
import { playback } from './stores/playback.svelte';
import { settings } from './stores/settings.svelte';
import { toast } from './stores/toast.svelte';
import { go } from './stores/router.svelte';
import { getMeta } from './stremio/client';
import { activeDownloads, canDownload, downloadOf, downloads, refreshDownloads, startDownload } from './downloads.svelte';
import { upcomingUnwatched } from './upnext.svelte';
import { epLabel, pickStream } from './watch';
import type { MetaDetail } from './stremio/types';

/** Shows count as "watching" if you played them in the last three weeks. */
const RECENT = 21 * 864e5;
/** Never queue more than this many at once. */
const MAX_QUEUED = 8;

let running = false;
export async function runAutoDownloads() {
  const n = settings.autoDownloadNext;
  if (!isTauri || !n || running) return;
  running = true;
  let added = 0;
  try {
    if (!downloads.loaded) await refreshDownloads();
    const shows = library.history.filter((h) => h.meta.type === 'series' && Date.now() - h.watchedAt < RECENT).slice(0, 6);
    for (const h of shows) {
      let meta: MetaDetail;
      try {
        meta = await getMeta(enabledAddons(), 'series', h.meta.id);
      } catch {
        continue;
      }
      for (const ep of upcomingUnwatched(meta, n)) {
        if (downloadOf(ep.id)) continue;
        if (activeDownloads() >= MAX_QUEUED) return;
        const s = await pickStream(meta, ep.id, null).catch(() => null);
        if (!s || !canDownload(s)) continue;
        await startDownload(s, meta, ep.id, epLabel(ep), true);
        added++;
      }
    }
  } finally {
    running = false;
    if (added) {
      void refreshDownloads();
      toast(`Downloading ${added} upcoming episode${added === 1 ? '' : 's'} in the background`, 'info', 5000, {
        label: 'View',
        run: () => go('downloads'),
      });
    }
  }
}

export function startAutoDownloads() {
  if (!isTauri) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void runAutoDownloads(), ms);
  };
  $effect.root(() => {
    // After finishing an episode (once the player is closed), or when the setting changes.
    $effect(() => {
      void library.watched.length;
      void settings.autoDownloadNext;
      if (!playback.active && settings.autoDownloadNext) soon(8000);
    });
  });
  setInterval(() => void runAutoDownloads(), 3 * 3600_000);
}
