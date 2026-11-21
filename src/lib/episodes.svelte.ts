// New-episode alerts: checks the shows you follow every few hours and tells you when a new
// episode is out (a Windows notification, plus a count on Calendar in the menu).
import { getMeta } from './stremio/client';
import { airDate } from './dates';
import { isTauri } from './stremio/http';
import { load, save } from './stores/persist';
import { enabledAddons } from './stores/addons.svelte';
import { isWatched, library } from './stores/library.svelte';
import { settings } from './stores/settings.svelte';
import { go } from './stores/router.svelte';
import { toast } from './stores/toast.svelte';
import { epCode } from './watch';

export interface NewEpisode {
  showId: string;
  showType: string;
  show: string;
  videoId: string;
  code: string;
  title: string;
  at: number;
}

interface Stored {
  /** Last time we looked (ms). Episodes released after this are "new". */
  lastCheck: number;
  /** Unseen new episodes (cleared when you open Calendar). */
  fresh: NewEpisode[];
}

export const episodes: Stored = $state(load<Stored>('episodes', { lastCheck: 0, fresh: [] }));
$effect.root(() => {
  $effect(() => save('episodes', $state.snapshot(episodes)));
});

/** Count shown on Calendar in the menu. */
export function newCount(): number {
  return episodes.fresh.filter((e) => !isWatched(e.videoId)).length;
}

export function markEpisodesSeen() {
  if (episodes.fresh.length) episodes.fresh = [];
}

function followed() {
  const seen = new Map<string, { id: string; type: string }>();
  for (const h of library.history) if (h.meta.type !== 'movie') seen.set(h.meta.id, { id: h.meta.id, type: h.meta.type });
  for (const s of library.saved) if (s.meta.type !== 'movie') seen.set(s.meta.id, { id: s.meta.id, type: s.meta.type });
  return [...seen.values()].slice(0, 80);
}

let running = false;

export async function checkNewEpisodes(): Promise<NewEpisode[]> {
  if (running) return [];
  running = true;
  try {
    const now = Date.now();
    // First run: only look back a day, so installing doesn't announce a backlog.
    const since = episodes.lastCheck || now - 86_400_000;
    const found: NewEpisode[] = [];
    const queue = followed();
    const worker = async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        try {
          const meta = await getMeta(enabledAddons(), s.type, s.id);
          for (const v of meta.videos ?? []) {
            if (!v.released || (v.season ?? 0) === 0 || isWatched(v.id)) continue;
            const t = +airDate(v.released);
            if (t > since && t <= now) {
              found.push({ showId: meta.id, showType: meta.type, show: meta.name, videoId: v.id, code: epCode(v), title: v.title ?? v.name ?? '', at: t });
            }
          }
        } catch {
          /* skip shows that don't load */
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    episodes.lastCheck = now;
    const known = new Set(episodes.fresh.map((e) => e.videoId));
    const added = found.filter((e) => !known.has(e.videoId)).sort((a, b) => b.at - a.at);
    if (added.length) {
      episodes.fresh = [...added, ...episodes.fresh].slice(0, 50);
      if (settings.notifyEpisodes) void announce(added);
    }
    return added;
  } finally {
    running = false;
  }
}

async function announce(list: NewEpisode[]) {
  const shows = [...new Set(list.map((e) => e.show))];
  const title = list.length === 1 ? `New episode of ${list[0].show}` : `${list.length} new episodes`;
  const body =
    list.length === 1
      ? [list[0].code, list[0].title].filter(Boolean).join(' · ')
      : shows.slice(0, 3).join(', ') + (shows.length > 3 ? ` and ${shows.length - 3} more` : '');
  let shown = false;
  if (isTauri && !document.hasFocus()) {
    try {
      const n = await import('@tauri-apps/plugin-notification');
      let ok = await n.isPermissionGranted();
      if (!ok) ok = (await n.requestPermission()) === 'granted';
      if (ok) {
        n.sendNotification({ title, body });
        shown = true;
      }
    } catch {
      /* fall back to an in-app note */
    }
  }
  if (!shown) toast(`${title}: ${body}`, 'info', 9000, { label: 'View', run: () => go('calendar') });
}

/** Checks shortly after launch and then every 3 hours. */
export function startEpisodeChecks() {
  const run = () => {
    void checkNewEpisodes(); // the Calendar count updates even with alerts off
  };
  const first = setTimeout(run, 20_000);
  const every = setInterval(run, 3 * 3600_000);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
