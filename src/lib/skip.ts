// Intro / recap / credits markers for the player's skip button and the
// next-episode card. Two sources, merged:
//  1. chapter names in the file itself (many releases mark "Opening", "Intro", "Credits"),
//  2. AniSkip (crowd-sourced, very accurate for anime), looked up via ARM id mapping.
import { getJson } from './stremio/http';

export type SegmentKind = 'intro' | 'recap' | 'credits' | 'preview';

export interface Segment {
  kind: SegmentKind;
  start: number;
  end: number;
}

export interface Chapter {
  title?: string;
  time: number;
}

const RULES: [SegmentKind, RegExp][] = [
  ['recap', /\b(recap|previously)\b/i],
  ['intro', /^(op|op\s?\d+|opening|intro|introduction|theme( song)?|title sequence|opening credits)\b|\b(opening|intro)\b/i],
  ['preview', /\b(preview|next (episode|time)|yokoku)\b/i],
  ['credits', /^(ed|ed\s?\d+|ending|outro|end credits|credits|closing)\b|\b(ending|credits)\b/i],
];

function classify(title: string): SegmentKind | null {
  for (const [kind, re] of RULES) if (re.test(title.trim())) return kind;
  return null;
}

/** Segments from the file's own chapter names. */
export function fromChapters(chapters: Chapter[], duration: number): Segment[] {
  const out: Segment[] = [];
  const sorted = [...chapters].sort((a, b) => a.time - b.time);
  sorted.forEach((c, i) => {
    const kind = c.title ? classify(c.title) : null;
    if (!kind) return;
    const end = sorted[i + 1]?.time ?? duration;
    // Ignore implausible chapters (a whole-episode "Intro", or zero-length marks).
    if (end - c.time < 5 || (kind !== 'credits' && kind !== 'preview' && end - c.time > 240)) return;
    out.push({ kind, start: c.time, end });
  });
  return out;
}

// ---------- AniSkip ----------

interface ArmIds {
  myanimelist?: number | null;
}

const malCache = new Map<string, Promise<number | null>>();

/** MyAnimeList id for an anime video id (kitsu:, mal:, or tt… with a season). */
function malIdFor(videoId: string): Promise<number | null> {
  // tt123:2:5 -> imdb tt123, season 2.  kitsu:456:5 -> kitsu 456.
  const [prefix, rawId] = videoId.split(':');
  if (prefix === 'mal' && rawId) return Promise.resolve(Number(rawId) || null);
  const season = prefix.startsWith('tt') ? Number(rawId) || 1 : 1;
  const ck = `${prefix}:${prefix.startsWith('tt') ? season : rawId}`;
  if (!malCache.has(ck)) {
    const job = (async () => {
      try {
        if (prefix === 'kitsu' && rawId) {
          const r = await getJson<ArmIds | null>(`https://arm.haglund.dev/api/v2/ids?source=kitsu&id=${encodeURIComponent(rawId)}`, 8000);
          return r?.myanimelist ?? null;
        }
        if (prefix.startsWith('tt')) {
          const r = await getJson<ArmIds[]>(`https://arm.haglund.dev/api/v2/imdb?id=${encodeURIComponent(prefix)}`, 8000);
          const mals = (Array.isArray(r) ? r : [])
            .map((x) => x.myanimelist)
            .filter((x): x is number => typeof x === 'number')
            .sort((x, y) => x - y);
          if (!mals.length) return null;
          // One entry per season is the common case; later seasons get higher MAL ids.
          return mals[Math.min(season - 1, mals.length - 1)];
        }
      } catch {
        /* not anime, or the mapping service is down */
      }
      return null;
    })();
    malCache.set(ck, job);
  }
  return malCache.get(ck)!;
}

function episodeOf(videoId: string): number | null {
  const parts = videoId.split(':');
  const n = Number(parts[parts.length - 1]);
  return parts.length >= 2 && Number.isFinite(n) && n > 0 ? n : null;
}

interface AniSkipResult {
  found: boolean;
  results?: { interval: { startTime: number; endTime: number }; skipType: string; episodeLength: number }[];
}

const KIND: Record<string, SegmentKind> = { op: 'intro', 'mixed-op': 'intro', ed: 'credits', 'mixed-ed': 'credits', recap: 'recap' };

/** AniSkip segments for an anime episode; [] when it isn't anime or nothing is known. */
export async function fromAniSkip(videoId: string, duration: number): Promise<Segment[]> {
  const ep = episodeOf(videoId);
  if (!ep) return [];
  const mal = await malIdFor(videoId);
  if (!mal) return [];
  const types = ['op', 'ed', 'mixed-op', 'mixed-ed', 'recap'].map((t) => `types[]=${t}`).join('&');
  try {
    const r = await getJson<AniSkipResult>(
      `https://api.aniskip.com/v2/skip-times/${mal}/${ep}?${types}&episodeLength=${Math.round(duration) || 0}`,
      8000,
    );
    return (r.results ?? [])
      .filter((x) => KIND[x.skipType] && x.interval.endTime > x.interval.startTime)
      .map((x) => ({ kind: KIND[x.skipType], start: x.interval.startTime, end: Math.min(x.interval.endTime, duration || Infinity) }));
  } catch {
    return [];
  }
}

/** Merges sources: chapter marks win for the kinds they cover, AniSkip fills the rest. */
export function mergeSegments(chapters: Segment[], aniskip: Segment[]): Segment[] {
  const have = new Set(chapters.map((s) => s.kind));
  return [...chapters, ...aniskip.filter((s) => !have.has(s.kind))].sort((a, b) => a.start - b.start);
}

export const SKIP_LABEL: Record<SegmentKind, string> = {
  intro: 'Skip intro',
  recap: 'Skip recap',
  credits: 'Skip credits',
  preview: 'Skip preview',
};
