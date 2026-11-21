// Live TV: your M3U playlists, their channels, the guide, favorites and recently watched.
import { load, save } from '../stores/persist';
import { getBytes, getText } from '../stremio/http';
import { delBlob, getBlob, putBlob } from '../blobs';
import { looksLikeM3U, parseM3U, type Channel } from './m3u';
import { onAt, type Guide, type Programme } from './xmltv';

export interface Playlist {
  id: string;
  name: string;
  /** Where it came from: a link (refreshed automatically) or a file you picked (kept as is). */
  source: 'url' | 'file';
  url: string;
  /** XMLTV guide link; empty = use the one the playlist names, if any. */
  epgUrl: string;
  /** Sent when fetching the playlist and playing its channels (some providers require one). */
  userAgent: string;
  enabled: boolean;
  updatedAt: number;
  count: number;
  error?: string;
}

interface Persisted {
  playlists: Playlist[];
  favorites: string[];
  recent: string[];
  /** Last group picked on the Live TV page. */
  group: string;
  hiddenGroups: string[];
}

export const live: Persisted = $state(
  load<Persisted>('live', { playlists: [], favorites: [], recent: [], group: '', hiddenGroups: [] }),
);
$effect.root(() => {
  $effect(() => save('live', $state.snapshot(live)));
});

/** Channels and guide can be tens of thousands of entries: replaced whole, never deeply tracked. */
class TV {
  channels = $state.raw<Channel[]>([]);
  /** Channel id → its guide programmes. */
  guide = $state.raw(new Map<string, Programme[]>());
  loading = $state(false);
  loaded = $state(false);
  guideLoading = $state(false);
  /** Ticks every 30s so "on now" stays current. */
  now = $state(Date.now());
}
export const tv = new TV();

const REFRESH_MS = 12 * 3600_000;
const GUIDE_BEFORE = 3 * 3600_000;
const GUIDE_AFTER = 36 * 3600_000;

const playlistKey = (id: string) => `m3u:${id}`;
const guideKey = (url: string) => `epg:${url}`;

setInterval(() => (tv.now = Date.now()), 30_000);

function uaHeaders(p?: Playlist): Record<string, string> | undefined {
  return p?.userAgent.trim() ? { 'User-Agent': p.userAgent.trim() } : undefined;
}

function friendlyError(e: unknown): string {
  const msg = String((e as Error)?.message ?? e);
  if (/HTTP 40[13]/.test(msg)) return 'The provider refused the request (check the link, login or user agent).';
  if (/HTTP 404/.test(msg)) return 'Nothing found at that link.';
  if (/Timed out/i.test(msg)) return 'The provider took too long to answer.';
  if (/Failed to fetch|error sending request|dns|connect/i.test(msg)) return "Couldn't reach the provider.";
  return msg;
}

async function fetchPlaylist(p: Playlist): Promise<string> {
  const text = await getText(p.url, 90_000, uaHeaders(p));
  if (!looksLikeM3U(text)) throw new Error("That link didn't return an M3U playlist.");
  return text;
}

// ---------- channels ----------

let loadRun = 0;

/** Parses every enabled playlist (from the local copy) and refreshes stale ones in the background. */
export async function loadChannels(force = false): Promise<void> {
  if (tv.loaded && !force) return;
  const run = ++loadRun;
  tv.loading = true;
  const all: Channel[] = [];
  const stale: Playlist[] = [];
  for (const p of live.playlists) {
    if (!p.enabled) continue;
    let text = await getBlob<string>(playlistKey(p.id));
    if (!text && p.source === 'url') {
      try {
        text = await fetchPlaylist(p);
        await putBlob(playlistKey(p.id), text);
        p.updatedAt = Date.now();
        p.error = undefined;
      } catch (e) {
        p.error = friendlyError(e);
      }
    } else if (!text && p.source === 'file') {
      // e.g. settings restored from a backup on another PC: the file itself isn't in the backup.
      p.error = "This playlist's file isn't on this PC. Remove it and add the file again.";
    } else if (p.source === 'url' && Date.now() - p.updatedAt > REFRESH_MS) {
      stale.push(p);
    }
    if (!text) continue;
    const parsed = parseM3U(text, p.id, p.source === 'url' ? p.url : undefined);
    if (p.userAgent.trim()) {
      for (const c of parsed.channels) if (!c.headers.some(([k]) => k === 'User-Agent')) c.headers.push(['User-Agent', p.userAgent.trim()]);
    }
    p.count = parsed.channels.length;
    if (!p.epgUrl && parsed.epgUrls[0]) p.epgUrl = parsed.epgUrls[0];
    all.push(...parsed.channels);
  }
  if (run !== loadRun) return;
  tv.channels = all;
  tv.loading = false;
  tv.loaded = true;
  void loadGuides();
  if (stale.length) void refreshPlaylists(stale);
}

async function refreshPlaylists(list: Playlist[]) {
  let changed = false;
  for (const p of list) {
    try {
      const text = await fetchPlaylist(p);
      const old = await getBlob<string>(playlistKey(p.id));
      await putBlob(playlistKey(p.id), text);
      p.updatedAt = Date.now();
      p.error = undefined;
      if (old !== text) changed = true;
    } catch (e) {
      p.error = friendlyError(e); // keep using the copy we have
    }
  }
  if (changed) await loadChannels(true);
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export interface NewPlaylist {
  name: string;
  url?: string;
  text?: string;
  epgUrl?: string;
  userAgent?: string;
}

/** Adds a playlist from a link or file contents. Throws a readable error if it isn't usable. */
export async function addPlaylist(input: NewPlaylist): Promise<Playlist> {
  const p: Playlist = {
    id: newId(),
    name: input.name.trim() || 'Playlist',
    source: input.text != null ? 'file' : 'url',
    url: (input.url ?? '').trim(),
    epgUrl: (input.epgUrl ?? '').trim(),
    userAgent: (input.userAgent ?? '').trim(),
    enabled: true,
    updatedAt: Date.now(),
    count: 0,
  };
  let text = input.text;
  if (text == null) {
    if (!/^https?:\/\//i.test(p.url)) throw new Error('Enter a link starting with http:// or https://');
    try {
      text = await fetchPlaylist(p);
    } catch (e) {
      throw new Error(friendlyError(e));
    }
  } else if (!looksLikeM3U(text)) {
    throw new Error("That file isn't an M3U playlist.");
  }
  const parsed = parseM3U(text, p.id, p.source === 'url' ? p.url : undefined);
  if (!parsed.channels.length) throw new Error('No channels found in that playlist.');
  p.count = parsed.channels.length;
  if (!p.epgUrl && parsed.epgUrls[0]) p.epgUrl = parsed.epgUrls[0];
  await putBlob(playlistKey(p.id), text);
  live.playlists.push(p);
  await loadChannels(true);
  return live.playlists.find((x) => x.id === p.id)!;
}

/** Builds the M3U and guide links for an Xtream Codes login (what most IPTV providers give out). */
export function xtreamLinks(server: string, user: string, pass: string): { url: string; epgUrl: string } {
  let base = server.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) base = 'http://' + base;
  const q = `username=${encodeURIComponent(user.trim())}&password=${encodeURIComponent(pass.trim())}`;
  return { url: `${base}/get.php?${q}&type=m3u_plus&output=ts`, epgUrl: `${base}/xmltv.php?${q}` };
}

export async function updatePlaylist(id: string, patch: Partial<Pick<Playlist, 'name' | 'epgUrl' | 'userAgent' | 'enabled' | 'url'>>) {
  const p = live.playlists.find((x) => x.id === id);
  if (!p) return;
  const reparse = 'enabled' in patch || 'userAgent' in patch || ('url' in patch && patch.url !== p.url);
  const guideChanged = 'epgUrl' in patch && patch.epgUrl !== p.epgUrl;
  Object.assign(p, patch);
  if ('url' in patch) await refreshPlaylist(id);
  else if (reparse) await loadChannels(true);
  else if (guideChanged) void loadGuides(true);
}

/** Fetches a link playlist again now. */
export async function refreshPlaylist(id: string): Promise<void> {
  const p = live.playlists.find((x) => x.id === id);
  if (!p || p.source !== 'url') return;
  try {
    const text = await fetchPlaylist(p);
    await putBlob(playlistKey(p.id), text);
    p.updatedAt = Date.now();
    p.error = undefined;
  } catch (e) {
    p.error = friendlyError(e);
    throw new Error(p.error);
  } finally {
    await loadChannels(true);
  }
}

export async function removePlaylist(id: string) {
  const i = live.playlists.findIndex((x) => x.id === id);
  if (i < 0) return;
  const [p] = live.playlists.splice(i, 1);
  await delBlob(playlistKey(p.id));
  const prefix = `${p.id}|`;
  live.favorites = live.favorites.filter((f) => !f.startsWith(prefix));
  live.recent = live.recent.filter((f) => !f.startsWith(prefix));
  await loadChannels(true);
}

export function isFavorite(id: string): boolean {
  return live.favorites.includes(id);
}

export function toggleFavorite(id: string) {
  live.favorites = isFavorite(id) ? live.favorites.filter((f) => f !== id) : [...live.favorites, id];
}

export function addRecent(id: string) {
  live.recent = [id, ...live.recent.filter((r) => r !== id)].slice(0, 24);
}

// ---------- guide (EPG) ----------

interface CachedGuide {
  at: number;
  guide: Guide;
}

let worker: Worker | null = null;
let msgId = 0;
const pending = new Map<number, { resolve: (g: Guide) => void; reject: (e: Error) => void }>();

function parseInWorker(buf: ArrayBuffer, from: number, to: number): Promise<Guide> {
  if (!worker) {
    worker = new Worker(new URL('./epg.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; guide?: Guide; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.guide) p.resolve(e.data.guide);
      else p.reject(new Error(e.data.error ?? 'Could not read the guide.'));
    };
  }
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, buf, from, to }, [buf]);
  });
}

async function guideFor(p: Playlist, force: boolean): Promise<Guide | null> {
  const url = p.epgUrl.trim();
  if (!url) return null;
  const cached = await getBlob<CachedGuide>(guideKey(url));
  const now = Date.now();
  const fresh = cached && now - cached.at < REFRESH_MS && cached.guide.to - now > 6 * 3600_000;
  if (cached && fresh && !force) return cached.guide;
  try {
    const buf = await getBytes(url, 180_000, uaHeaders(p));
    const guide = await parseInWorker(buf, now - GUIDE_BEFORE, now + GUIDE_AFTER);
    await putBlob(guideKey(url), { at: now, guide } satisfies CachedGuide);
    return guide;
  } catch (e) {
    console.warn('Guide', url, e);
    return cached?.guide ?? null; // an old guide beats none
  }
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(hd|fhd|uhd|4k|sd|hevc|h265|1080p?|720p?)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');

let guideRun = 0;

/** Loads each playlist's guide and matches programmes to channels (by tvg-id, else by name). */
export async function loadGuides(force = false): Promise<void> {
  const run = ++guideRun;
  const lists = live.playlists.filter((p) => p.enabled && p.epgUrl.trim());
  if (!lists.length) {
    tv.guide = new Map();
    return;
  }
  tv.guideLoading = true;
  const out = new Map<string, Programme[]>();
  for (const p of lists) {
    const guide = await guideFor(p, force);
    if (run !== guideRun) return;
    if (!guide) continue;
    const byId = new Map<string, Programme[]>();
    for (const [id, list] of Object.entries(guide.programmes)) byId.set(id.toLowerCase(), list);
    const byName = new Map<string, Programme[]>();
    for (const [id, names] of Object.entries(guide.names)) {
      const list = guide.programmes[id];
      if (!list) continue;
      for (const n of names) if (!byName.has(norm(n))) byName.set(norm(n), list);
    }
    for (const c of tv.channels) {
      if (c.playlistId !== p.id) continue;
      const list =
        (c.tvgId && byId.get(c.tvgId.toLowerCase())) ||
        (c.tvgName && byName.get(norm(c.tvgName))) ||
        byName.get(norm(c.name)) ||
        (c.tvgId ? undefined : byId.get(c.name.toLowerCase()));
      if (list) out.set(c.id, list);
    }
    tv.guide = new Map(out); // show each playlist's guide as soon as it's ready
  }
  if (run === guideRun) tv.guideLoading = false;
}

/** What's on now and next on a channel. */
export function nowNext(id: string, now = tv.now): { now: Programme | null; next: Programme | null } {
  const list = tv.guide.get(id);
  if (!list) return { now: null, next: null };
  const i = onAt(list, now);
  if (i >= 0) return { now: list[i], next: list[i + 1] ?? null };
  const upcoming = list.find((p) => p.s > now) ?? null;
  return { now: null, next: upcoming };
}

export function channelById(id: string): Channel | undefined {
  return tv.channels.find((c) => c.id === id);
}
