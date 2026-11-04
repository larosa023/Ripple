// Keeps your Discord activity in step with the player (when turned on).
import { invoke } from './player';
import { isTauri } from './stremio/http';
import { playback } from './stores/playback.svelte';
import { settings } from './stores/settings.svelte';

let lastKey = '';
let lastSent = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let warned = false;

function activity() {
  if (!playback.active || !playback.meta) return null;
  const poster = playback.meta.poster?.startsWith('https://') ? playback.meta.poster : undefined;
  const a: Record<string, unknown> = {
    type: 3, // "Watching"
    details: playback.title.slice(0, 128) || 'Something good',
    state: (playback.subtitle || (playback.meta.type === 'movie' ? 'Movie' : '')).slice(0, 128) || undefined,
    assets: poster ? { large_image: poster, large_text: playback.title.slice(0, 128) } : undefined,
  };
  if (playback.paused) a.state = [playback.subtitle, 'Paused'].filter(Boolean).join(' · ').slice(0, 128);
  else if (playback.duration > 0) {
    const start = Date.now() - (playback.time * 1000) / (playback.speed || 1);
    a.timestamps = { start: Math.round(start), end: Math.round(start + (playback.duration * 1000) / (playback.speed || 1)) };
  }
  return a;
}

export async function sendDiscord(force = false): Promise<string | null> {
  if (!isTauri) return 'Discord status works in the desktop app.';
  const on = settings.discord && !!settings.discordAppId.trim();
  const act = on ? activity() : null;
  // Re-send only when something visible changed, or after a seek drifts the clock.
  const key = act ? JSON.stringify({ ...act, timestamps: undefined }) : 'none';
  const ts = (act?.timestamps as { start: number } | undefined)?.start ?? 0;
  if (!force && key === lastKey && Math.abs(ts - lastSent) < 4000) return null;
  try {
    await invoke('discord_set', { clientId: settings.discordAppId.trim() || '0', activity: act });
    // Remember what Discord shows only once it took it, so a failed update is retried next tick.
    lastKey = key;
    lastSent = ts;
    warned = false;
    return null;
  } catch (e) {
    return String((e as Error)?.message ?? e);
  }
}

/** Watches the player and pushes updates (Discord allows about 5 per 20 seconds). */
export function startDiscordSync() {
  $effect.root(() => {
    $effect(() => {
      // Touch what matters so the effect re-runs on changes.
      void [settings.discord, settings.discordAppId, playback.active, playback.ready, playback.paused, playback.videoId, playback.title, playback.subtitle, playback.duration];
      void Math.round(playback.time / 15);
      clearTimeout(timer);
      if (!settings.discord && lastKey === 'none') return;
      timer = setTimeout(async () => {
        const err = await sendDiscord();
        if (err && !warned && settings.discord && playback.active) {
          warned = true;
          console.warn('Discord status:', err);
        }
      }, 1200);
    });
  });
}
