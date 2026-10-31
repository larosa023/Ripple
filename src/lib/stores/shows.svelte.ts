// Per-show memory: the audio language, subtitle choice and source you picked
// last time, so the next episode starts the same way.
import { load, save } from './persist';

export interface ShowPrefs {
  /** Audio language code mpv reported (e.g. "jpn"). */
  audioLang?: string;
  /** Subtitle language code, or "off". */
  subLang?: string;
  /** Subtitle track title, to pick the same one among several of a language (e.g. "Signs & Songs"). */
  subTitle?: string;
  /** Source preference */
  addonId?: string;
  bingeGroup?: string;
  quality?: string;
  service?: string;
  at: number;
}

export const shows: Record<string, ShowPrefs> = $state(load('shows', {} as Record<string, ShowPrefs>));

$effect.root(() => {
  $effect(() => {
    save('shows', $state.snapshot(shows));
  });
});

export function rememberShow(id: string, patch: Partial<ShowPrefs>) {
  if (!id) return;
  shows[id] = { ...(shows[id] ?? {}), ...patch, at: Date.now() };
  const keys = Object.keys(shows);
  if (keys.length > 400) {
    keys.sort((a, b) => shows[a].at - shows[b].at).slice(0, keys.length - 400).forEach((k) => delete shows[k]);
  }
}

export function forgetShow(id: string) {
  delete shows[id];
}
