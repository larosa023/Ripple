// Downloads for offline viewing: starting them from a stream, live progress (polled from the
// Rust download manager), playing finished files, and tidying up after you've watched.
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './stremio/http';
import { describe } from './stremio/streams';
import { getMeta } from './stremio/client';
import { resolveDebrid } from './resolve';
import { findSubtitles, type Prepared } from './player';
import { enabledAddons } from './stores/addons.svelte';
import { isWatched } from './stores/library.svelte';
import { openPlayer, playback } from './stores/playback.svelte';
import { go } from './stores/router.svelte';
import { settings } from './stores/settings.svelte';
import { dismiss, toast } from './stores/toast.svelte';
import type { MetaDetail, SourcedStream } from './stremio/types';

export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'done' | 'error';

export interface Download {
  id: string;
  title: string;
  subtitle: string;
  metaId: string;
  metaType: string;
  videoId: string;
  poster?: string | null;
  source: { kind: 'http' | 'torrent' };
  path: string;
  size: number;
  done: number;
  status: DownloadStatus;
  error?: string | null;
  added: number;
  speed: number;
}

export const downloads: { items: Download[]; loaded: boolean } = $state({ items: [], loaded: false });

let timer: ReturnType<typeof setTimeout> | undefined;
const busy = (d: Download) => d.status === 'downloading' || d.status === 'queued';

/** Fetches the list now, then keeps polling (every second while anything is downloading). */
export async function refreshDownloads() {
  if (!isTauri) return;
  clearTimeout(timer);
  try {
    const list = await invoke<Download[] | null>('download_list');
    downloads.items = Array.isArray(list) ? list : [];
    downloads.loaded = true;
  } catch {
    /* backend not ready yet */
  }
  timer = setTimeout(refreshDownloads, downloads.items.some(busy) ? 1000 : 20_000);
}

export const activeDownloads = () => downloads.items.filter(busy).length;

/** The finished download of this episode / movie, if there is one. */
export function downloadedCopy(videoId: string): Download | undefined {
  return downloads.items.find((d) => d.videoId === videoId && d.status === 'done');
}

export function downloadOf(videoId: string): Download | undefined {
  return downloads.items.find((d) => d.videoId === videoId && d.status !== 'error');
}

let folder: string | null = null;
/** Your download folder: the one set in Settings, else Videos\Ripple. */
export async function downloadFolder(): Promise<string> {
  if (settings.downloadDir.trim()) return settings.downloadDir.trim();
  if (folder) return folder;
  const path = await import('@tauri-apps/api/path');
  folder = await path.join(await path.videoDir(), 'Ripple');
  return folder;
}

/** Can this source be saved? (Web links and YouTube can't.) */
export const canDownload = (s: SourcedStream) => !!s.infoHash || /^https?:\/\//i.test(s.url ?? '');

/** Starts downloading a stream of an episode or movie. */
export async function startDownload(s: SourcedStream, meta: MetaDetail, videoId: string, label: string, quiet = false) {
  if (!isTauri) return;
  const existing = downloadOf(videoId);
  if (existing) {
    if (quiet) return;
    toast(existing.status === 'done' ? 'Already downloaded.' : 'Already downloading.', 'info', 4000, { label: 'View', run: () => go('downloads') });
    return;
  }
  let source: Record<string, unknown>;
  if (s.infoHash) {
    source = {
      kind: 'torrent',
      infoHash: s.infoHash,
      fileIdx: s.fileIdx ?? null,
      trackers: s.sources ?? [],
      fileHint: s.behaviorHints?.filename ?? null,
    };
  } else if (s.url && /^https?:\/\//i.test(s.url)) {
    const headers = Object.entries(s.behaviorHints?.proxyHeaders?.request ?? {}) as [string, string][];
    let url = s.url;
    if (describe(s).service || /\/resolve\//i.test(url)) {
      // Debrid: get the real file link (waiting while the service prepares it).
      let wait: number | null = null;
      try {
        url = await resolveDebrid(url, headers, () => {
          wait ??= toast('Your debrid service is getting this file ready…', 'info', 20000);
        });
      } finally {
        if (wait !== null) dismiss(wait);
      }
    }
    source = { kind: 'http', url, headers };
  } else {
    if (!quiet) toast("This source can't be downloaded. Try another one.", 'error', 5000);
    return;
  }
  try {
    await invoke('download_add', {
      req: {
        title: meta.name,
        subtitle: meta.type === 'movie' ? '' : label,
        metaId: meta.id,
        metaType: meta.type,
        videoId,
        poster: meta.poster ?? null,
        source,
        dir: await downloadFolder(),
        ext: null,
      },
    });
    if (!quiet) toast(`Downloading ${label || meta.name}`, 'success', 5000, { label: 'View', run: () => go('downloads') });
  } catch (e) {
    if (!quiet) toast(String((e as Error)?.message ?? e), 'error', 6000);
  }
  void refreshDownloads();
}

/** file:///C:/Users/a%20b/x.mkv — what mpv (and the seek previews) open. */
export function fileUrl(path: string): string {
  const p = path.replace(/\\/g, '/');
  const parts = p.split('/').map((seg, i) => (i === 0 && /^[a-z]:$/i.test(seg) ? seg : encodeURIComponent(seg)));
  return `file://${p.startsWith('/') ? '' : '/'}${parts.join('/')}`;
}

/** Plays a finished download in Ripple's player (subtitles from your addons if you're online). */
export async function playDownload(d: Download, meta?: MetaDetail | null) {
  let m = meta ?? null;
  if (!m) {
    try {
      m = await getMeta(enabledAddons(), d.metaType, d.metaId);
    } catch {
      m = null; // offline: still plays, just without artwork and episode details
    }
  }
  // Offline is fine: findSubtitles waits a few seconds at most, and failures just mean no addon subtitles.
  const found = await findSubtitles({ subtitles: [], addonName: '', behaviorHints: { filename: d.path.split(/[\\/]/).pop(), videoSize: d.size || undefined } }, {
    type: d.metaType,
    videoId: d.videoId,
    addons: enabledAddons(),
  }).catch(() => ({ now: [], later: Promise.resolve([]) }));
  const prepared: Prepared = {
    url: fileUrl(d.path),
    subtitles: found.now.map((x) => x.url),
    subInfo: found.now,
    lateSubs: found.later,
    headers: [],
  };
  try {
    await openPlayer(prepared, { title: d.title, subtitle: d.subtitle, meta: m, videoId: d.videoId });
  } catch (e) {
    toast(String((e as Error)?.message ?? e), 'error', 6000);
  }
}

export async function pauseDownload(d: Download) {
  await invoke('download_pause', { id: d.id }).catch(() => {});
  void refreshDownloads();
}
export async function resumeDownload(d: Download) {
  await invoke('download_resume', { id: d.id }).catch(() => {});
  void refreshDownloads();
}
export async function removeDownload(d: Download, deleteFile = true) {
  await invoke('download_remove', { id: d.id, deleteFile }).catch(() => {});
  void refreshDownloads();
}
export function revealDownload(d: Download | null) {
  void (async () => invoke('download_reveal', { path: d ? d.path : await downloadFolder() }).catch(() => {}))();
}

/** Starts polling, and deletes a download you've finished watching (if you chose that). */
export function startDownloads() {
  if (!isTauri) return;
  void refreshDownloads();
  let watching: string | null = null;
  $effect.root(() => {
    $effect(() => {
      if (playback.active && playback.source?.url.startsWith('file://')) {
        watching = playback.videoId;
        return;
      }
      // Player closed (the file is no longer open, so it can be deleted).
      const id = watching;
      watching = null;
      if (!playback.active && id && settings.downloadAutoDelete && isWatched(id)) {
        const d = downloadedCopy(id);
        if (d) {
          void removeDownload(d, true);
          toast(`Deleted the download of ${d.subtitle || d.title} (watched)`, 'info', 5000);
        }
      }
    });
  });
}
