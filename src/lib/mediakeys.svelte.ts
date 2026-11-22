// Windows media controls: keeps the system media overlay (volume flyout, lock screen) showing
// what's playing, and handles the keyboard's play/pause/next/previous keys, even when Ripple
// isn't the focused window.
import { invoke } from '@tauri-apps/api/core';
import { untrack } from 'svelte';
import { isTauri } from './stremio/http';
import { closePlayer, playback, seekBy, seekTo, togglePause } from './stores/playback.svelte';
import { skipToNext, upNext } from './watch';
import { zap } from './iptv/play.svelte';

const call = (cmd: string, args?: Record<string, unknown>) => {
  void invoke(cmd, args).catch(() => {});
};

function info() {
  const m = playback.meta;
  if (playback.live) {
    return { title: playback.live.name ?? playback.title, artist: 'Live TV', cover: playback.live.logo || undefined };
  }
  // Episodes: "S4E2 · Weight" over the show name. Movies: the title over the year.
  return {
    title: playback.subtitle || playback.title,
    artist: playback.subtitle ? playback.title : String(m?.year ?? m?.releaseInfo ?? ''),
    album: playback.subtitle ? playback.title : undefined,
    cover: m?.poster || m?.background || undefined,
    duration: playback.duration || undefined,
  };
}

export function startMediaKeys() {
  if (!isTauri) return;

  $effect.root(() => {
    // New video, or its length became known: send the details.
    $effect(() => {
      if (!playback.active) {
        call('media_clear');
        return;
      }
      void [playback.videoId, playback.title, playback.subtitle, Math.round(playback.duration)];
      call('media_info', { info: info() });
    });
    // Playing / paused (the position is read without subscribing to every tick).
    $effect(() => {
      if (!playback.active) return;
      const playing = !playback.paused && !playback.ended;
      void playback.ready;
      call('media_state', { playing, position: untrack(() => playback.time) });
    });
    // Keep the overlay's position roughly right while playing.
    const t = setInterval(() => {
      if (playback.active && !playback.paused) call('media_state', { playing: true, position: playback.time });
    }, 10_000);
    return () => clearInterval(t);
  });

  void import('@tauri-apps/api/event').then(({ listen }) =>
    listen<{ action: string; value: number }>('media://key', ({ payload }) => {
      if (!playback.active) return;
      const { action, value } = payload;
      if (action === 'toggle') togglePause();
      else if (action === 'play' && (playback.paused || playback.ended)) togglePause();
      else if (action === 'pause' && !playback.paused) togglePause();
      else if (action === 'stop') void closePlayer();
      else if (action === 'next') {
        if (playback.live) zap(1);
        else if (upNext()) void skipToNext();
      } else if (action === 'previous') {
        if (playback.live) zap(-1);
        else seekTo(0);
      } else if (action === 'seekBy' && !playback.live) seekBy(value);
      else if (action === 'seekTo' && !playback.live) seekTo(value);
    }),
  );
}
