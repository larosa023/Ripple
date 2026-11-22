// Watch-time log for "Your stats": seconds watched per day per title, by hour of day, and
// what you finished. Counted from real playing time (not skipping or pausing). Seeded once
// from your existing resume points so it doesn't start empty.
import { library } from './stores/library.svelte';
import { load, save } from './stores/persist';
import { playback } from './stores/playback.svelte';

export interface TitleInfo {
  name: string;
  type: string;
  poster?: string;
  genres?: string[];
}

export interface WatchLog {
  /** 'YYYY-MM-DD' → title id → seconds. */
  days: Record<string, Record<string, number>>;
  /** Seconds watched in each hour of the day (0–23), all time. */
  hours: number[];
  titles: Record<string, TitleInfo>;
  /** Episodes / movies finished: video id, title id, when. */
  finished: { v: string; m: string; at: number }[];
  seeded: boolean;
}

export const log: WatchLog = $state(load('watchlog', { days: {}, hours: Array(24).fill(0), titles: {}, finished: [], seeded: false }));

export const dayKey = (t: number | Date) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function add(id: string, seconds: number, at: number) {
  const k = dayKey(at);
  const day = (log.days[k] ??= {});
  day[id] = (day[id] ?? 0) + seconds;
  if (log.hours.length !== 24) log.hours = Array(24).fill(0);
  log.hours[new Date(at).getHours()] += seconds;
}

/** One-time estimate from resume points you already have (position × when). */
function seed() {
  if (log.seeded) return;
  for (const h of library.history) {
    log.titles[h.meta.id] ??= { name: h.meta.name, type: h.meta.type, poster: h.meta.poster };
  }
  for (const [videoId, p] of Object.entries(library.progress ?? {})) {
    if (!p?.t || !p.at) continue;
    const id = videoId.split(':')[0];
    add(id, Math.min(p.t, 4 * 3600), p.at);
    if (p.d > 0 && p.t / p.d > 0.9) log.finished.push({ v: videoId, m: id, at: p.at });
  }
  log.seeded = true;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save('watchlog', $state.snapshot(log)), 2000);
}

/** Starts counting. Every 5 s of real playback is added to today's total for that title. */
export function startStats() {
  seed();
  persist();
  let lastWall = Date.now();
  let lastPos = -1;
  const done = new Set(log.finished.map((f) => f.v));
  setInterval(() => {
    const now = Date.now();
    const wall = (now - lastWall) / 1000;
    lastWall = now;
    if (!playback.active || playback.paused || playback.ended || !playback.ready) {
      lastPos = -1;
      return;
    }
    const pos = playback.time;
    const moved = lastPos >= 0 && pos !== lastPos;
    lastPos = pos;
    if (!moved || wall <= 0 || wall > 15) return;
    const m = playback.meta;
    const id = playback.live ? `live:${playback.title}` : (m?.id ?? playback.videoId.split(':')[0]);
    if (!id) return;
    log.titles[id] = playback.live
      ? { name: playback.title, type: 'live', poster: playback.live.logo || undefined }
      : { name: m?.name ?? playback.title, type: m?.type ?? 'movie', poster: m?.poster, genres: m?.genres?.slice(0, 4) };
    add(id, wall, now);
    // Finished: past 90% of something longer than 5 minutes.
    if (!playback.live && playback.duration > 300 && pos / playback.duration > 0.9 && !done.has(playback.videoId)) {
      done.add(playback.videoId);
      log.finished.push({ v: playback.videoId, m: id, at: now });
    }
    persist();
  }, 5000);
}

// ---------- summaries ----------

export type Period = 'month' | 'year' | 'all';

export function inPeriod(day: string, period: Period, now = new Date()): boolean {
  if (period === 'all') return true;
  const y = String(now.getFullYear());
  if (period === 'year') return day.startsWith(y);
  return day.startsWith(`${y}-${String(now.getMonth() + 1).padStart(2, '0')}`);
}

export interface Summary {
  seconds: number;
  titles: { id: string; info: TitleInfo; seconds: number }[];
  genres: { name: string; seconds: number }[];
  /** Month view: one bar per day. Year/all: one per month. */
  bars: { label: string; full: string; seconds: number }[];
  finished: number;
  streak: number;
  busiest: { day: string; seconds: number } | null;
  binge: { id: string; count: number; day: string } | null;
  activeDays: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function summarize(period: Period, now = new Date()): Summary {
  const days = Object.entries(log.days).filter(([d]) => inPeriod(d, period, now));
  const perTitle = new Map<string, number>();
  let seconds = 0;
  for (const [, titles] of days) {
    for (const [id, s] of Object.entries(titles)) {
      perTitle.set(id, (perTitle.get(id) ?? 0) + s);
      seconds += s;
    }
  }
  const titles = [...perTitle.entries()]
    .filter(([id, s]) => s >= 60 && log.titles[id])
    .map(([id, s]) => ({ id, info: log.titles[id], seconds: s }))
    .sort((a, b) => b.seconds - a.seconds);

  const g = new Map<string, number>();
  for (const t of titles) {
    const gs = t.info.genres ?? [];
    for (const name of gs) g.set(name, (g.get(name) ?? 0) + t.seconds / gs.length);
  }
  const genres = [...g.entries()].map(([name, s]) => ({ name, seconds: s })).sort((a, b) => b.seconds - a.seconds).slice(0, 8);

  const total = (d: Record<string, number>) => Object.values(d).reduce((a, b) => a + b, 0);
  let bars: Summary['bars'];
  if (period === 'month') {
    const n = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    bars = Array.from({ length: n }, (_, i) => {
      const k = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
      return { label: String(i + 1), full: `${MONTHS[now.getMonth()]} ${i + 1}`, seconds: log.days[k] ? total(log.days[k]) : 0 };
    });
  } else if (period === 'year') {
    bars = MONTHS.map((m, i) => {
      const prefix = `${now.getFullYear()}-${String(i + 1).padStart(2, '0')}`;
      const s = days.filter(([d]) => d.startsWith(prefix)).reduce((a, [, t]) => a + total(t), 0);
      return { label: m, full: `${m} ${now.getFullYear()}`, seconds: s };
    });
  } else {
    // All time: the last 12 months.
    bars = Array.from({ length: 12 }, (_, k) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + k, 1);
      const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const s = Object.entries(log.days).filter(([day]) => day.startsWith(prefix)).reduce((a, [, t]) => a + total(t), 0);
      return { label: MONTHS[d.getMonth()], full: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, seconds: s };
    });
  }

  const finishedIn = log.finished.filter((f) => inPeriod(dayKey(f.at), period, now));

  // Longest run of consecutive days with at least 5 minutes watched.
  const watchedDays = days.filter(([, t]) => total(t) >= 300).map(([d]) => d).sort();
  let streak = 0;
  let run = 0;
  let prev = 0;
  for (const d of watchedDays) {
    const t = new Date(`${d}T12:00:00`).getTime();
    run = prev && Math.round((t - prev) / 864e5) === 1 ? run + 1 : 1;
    streak = Math.max(streak, run);
    prev = t;
  }

  let busiest: Summary['busiest'] = null;
  for (const [d, t] of days) {
    const s = total(t);
    if (!busiest || s > busiest.seconds) busiest = { day: d, seconds: s };
  }

  // Most episodes of one show finished in a single day.
  const per = new Map<string, number>();
  for (const f of finishedIn) {
    if (log.titles[f.m]?.type !== 'series') continue;
    const k = `${f.m}|${dayKey(f.at)}`;
    per.set(k, (per.get(k) ?? 0) + 1);
  }
  let binge: Summary['binge'] = null;
  for (const [k, count] of per) {
    if (count >= 2 && (!binge || count > binge.count)) {
      const [id, day] = k.split('|');
      binge = { id, count, day };
    }
  }

  return {
    seconds,
    titles,
    genres,
    bars,
    finished: finishedIn.length,
    streak,
    busiest,
    binge,
    activeDays: days.filter(([, t]) => total(t) >= 60).length,
  };
}

/** "12h 30m", "45m". */
export function hm(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 && h < 100 ? `${h}h ${m % 60}m` : `${h}h`;
}
