// AI subtitles from Caption (larosa023/Caption), the suite's local speech-to-text app.
//
// When a video starts, Ripple hands Caption the stream URL. Caption reads the audio ahead of the
// playhead with Whisper on the GPU and serves a regular .srt, which Ripple adds to mpv as a subtitle
// track and reloads as more of it is ready. Because the subtitles are made from the file itself
// (not from what's coming out of the speakers), they're timed to the word, like downloaded ones.
// Everything stays on this PC: Caption listens on 127.0.0.1 only.

import { isTauri } from './stremio/http';
import { mpv, playback, type Track } from './stores/playback.svelte';
import { settings } from './stores/settings.svelte';
import type { Prepared } from './player';

const API = 'http://127.0.0.1:46277/v1';
export const CAPTION_SOURCE = 'Caption AI';

interface Job {
  id: string;
  srt: string;
  token: number;
  audio: number;
  version: number;
  added: boolean;
  timer?: ReturnType<typeof setInterval>;
  lastTime: number;
}

let job: Job | null = null;
let token = 0;

async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 8000): Promise<T | null> {
  try {
    const f: typeof fetch = isTauri ? ((await import('@tauri-apps/plugin-http')).fetch as unknown as typeof fetch) : fetch;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await f(API + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

/** Is Caption running with a model ready? */
export async function captionAvailable(): Promise<boolean> {
  const h = await call<{ app: string; ready: boolean }>('GET', '/health', undefined, 1500);
  return !!h && h.app === 'Caption' && h.ready;
}

function audioIndex(): number {
  const audio = playback.tracks.filter((t) => t.type === 'audio').sort((a, b) => a.id - b.id);
  const i = audio.findIndex((t) => t.id === playback.aid);
  return i >= 0 ? i : 0;
}

function wantedLang(): string {
  return (settings.subtitleLangs.split(',')[0] ?? '').trim() || 'eng';
}

/** Starts AI subtitles for the video that just began playing. Quietly does nothing if Caption isn't running. */
export async function startCaption(p: Prepared, startSeconds: number, title: string) {
  stopCaption();
  if (!isTauri || !settings.captionSubs || playback.live) return;
  const my = ++token;
  if (!(await captionAvailable()) || my !== token) return;
  const headers: Record<string, string> = {};
  for (const [k, v] of p.headers ?? []) headers[k] = v;
  const created = await call<{ id: string; srt: string }>(
    'POST',
    '/jobs',
    { url: p.url, headers, title, position: startSeconds || playback.time || 0, language: wantedLang(), audioIndex: audioIndex() },
    120000, // the first time, Caption may still be downloading FFmpeg
  );
  if (!created || my !== token || !playback.active) {
    if (created) void call('DELETE', `/jobs/${created.id}`);
    return;
  }
  job = { id: created.id, srt: created.srt, token: my, audio: audioIndex(), version: 0, added: false, lastTime: playback.time };
  // Let the subtitle menu name it.
  p.subInfo = [...(p.subInfo ?? []), { url: created.srt, lang: wantedLang(), source: CAPTION_SOURCE }];
  job.timer = setInterval(() => void tick(p, title), 2500);
  void tick(p, title);
}

async function tick(p: Prepared, title: string) {
  const j = job;
  if (!j || j.token !== token || !playback.active) return;

  // Switched to another audio language: start over with that track.
  if (playback.aid !== false && audioIndex() !== j.audio && playback.tracks.length) {
    const old = captionTrack();
    if (old) await mpv('sub-remove', old.id);
    await startCaption(p, playback.time, title);
    return;
  }

  // Tell Caption where playback is (it follows seeks and stays a few minutes ahead).
  const r = await call<{ doneUntil: number; version: number }>('POST', `/jobs/${j.id}/position`, { position: playback.time });
  if (!r || job !== j) return;
  j.lastTime = playback.time;
  if (r.version === j.version) return;
  j.version = r.version;

  const track = captionTrack();
  if (!track) {
    // First subtitles are ready: add the track. Turn it on unless you've picked other subtitles.
    if (j.added) return;
    j.added = true;
    const select = settings.captionAutoOn && playback.sid === false;
    await mpv('sub-add', j.srt, select ? 'select' : 'auto', 'AI subtitles', wantedLang());
  } else {
    // More of the movie is done: reload the track in place (keeps it selected).
    await mpv('sub-reload', track.id);
  }
}

export function captionTrack(): Track | undefined {
  const j = job;
  if (!j) return undefined;
  return playback.tracks.find((t) => t.type === 'sub' && t['external-filename'] === j.srt);
}

/** Stops the job (video closed or replaced). */
export function stopCaption() {
  token++;
  const j = job;
  job = null;
  if (!j) return;
  clearInterval(j.timer);
  void call('DELETE', `/jobs/${j.id}`);
}
