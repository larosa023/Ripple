// Playing live channels, and flipping between them (channel up / down) from the player.
import { errorText, installMpv, isNeedMpvError, isNoPlayerError, playExternal, type Prepared } from '../player';
import { openPlayer, playback } from '../stores/playback.svelte';
import { settings } from '../stores/settings.svelte';
import { dismiss, toast } from '../stores/toast.svelte';
import { isTauri } from '../stremio/http';
import { addRecent, nowNext, tv } from './live.svelte';
import type { Channel } from './m3u';

/** The list the channel was picked from, so channel up/down follows what you were browsing. */
let zapList: Channel[] = [];

export function prepared(ch: Channel): Prepared {
  return { url: ch.url, subtitles: [], headers: ch.headers };
}

function subtitleFor(ch: Channel): string {
  return nowNext(ch.id).now?.t ?? ch.group;
}

async function start(ch: Channel) {
  addRecent(ch.id);
  if (settings.playIn === 'ripple' && isTauri) {
    await openPlayer(prepared(ch), {
      title: ch.name,
      subtitle: subtitleFor(ch),
      meta: null,
      videoId: `live:${ch.id}`,
      live: { id: ch.id, name: ch.name, logo: ch.logo, group: ch.group },
    });
  } else {
    await playExternal(prepared(ch), ch.name);
    toast('Opening player…', 'success', 2000);
  }
}

let installing = false;

export async function playChannel(ch: Channel, list?: Channel[]): Promise<void> {
  if (list?.length) zapList = list;
  else if (!zapList.some((c) => c.id === ch.id)) zapList = [ch];
  try {
    await start(ch);
  } catch (e) {
    if (isNeedMpvError(e) || isNoPlayerError(e)) {
      toast(errorText(e), 'error', 12000, { label: 'Install mpv', run: () => void installThenPlay(ch) });
    } else {
      toast(errorText(e), 'error', 6000);
    }
  }
}

async function installThenPlay(ch: Channel) {
  if (installing) return;
  installing = true;
  const id = toast('Installing mpv… this can take a minute.', 'info', 120000);
  try {
    await installMpv();
    dismiss(id);
    toast('mpv installed', 'success', 2500);
    await playChannel(ch);
  } catch (e) {
    dismiss(id);
    toast(errorText(e), 'error', 9000);
  } finally {
    installing = false;
  }
}

/** Neighbouring channel in the list you were browsing (wraps around). */
export function neighbour(dir: 1 | -1): Channel | null {
  const id = playback.live?.id;
  if (!id || zapList.length < 2) return null;
  const i = zapList.findIndex((c) => c.id === id);
  return zapList[(i + dir + zapList.length) % zapList.length] ?? null;
}

export function zap(dir: 1 | -1) {
  const ch = neighbour(dir);
  if (ch) void playChannel(ch);
}

/** Channels for the in-player guide. */
export function zapChannels(): Channel[] {
  return zapList;
}

/** Restarts the current channel at the live edge (after pausing, or when the stream dropped). */
export function goLive() {
  const id = playback.live?.id;
  const ch = id ? (zapList.find((c) => c.id === id) ?? tv.channels.find((c) => c.id === id)) : undefined;
  if (ch) void playChannel(ch);
}

// Keep the player's subtitle (and Discord) on the programme that's on now.
$effect.root(() => {
  $effect(() => {
    void tv.now;
    void tv.guide;
    const id = playback.live?.id;
    if (!id) return;
    const ch = zapList.find((c) => c.id === id) ?? tv.channels.find((c) => c.id === id);
    if (ch) {
      const sub = subtitleFor(ch);
      if (sub !== playback.subtitle) playback.subtitle = sub;
    }
  });
});
