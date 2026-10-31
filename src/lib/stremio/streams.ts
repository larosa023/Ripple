import type { SourcedStream } from './types';

export type Quality = '4K' | '1080p' | '720p' | '480p' | 'SD' | 'CAM' | '?';

const QUALITY_RANK: Record<Quality, number> = { '4K': 6, '1080p': 5, '720p': 4, '480p': 3, SD: 2, '?': 1, CAM: 0 };

function text(s: SourcedStream): string {
  return [s.name, s.title, s.description, s.behaviorHints?.filename].filter(Boolean).join(' ');
}

export function quality(s: SourcedStream): Quality {
  const t = text(s).toLowerCase();
  if (/\b(cam|camrip|hdcam|ts|telesync|hdts)\b/.test(t)) return 'CAM';
  if (/\b(2160p|4k|uhd)\b/.test(t)) return '4K';
  if (/\b1080p\b/.test(t)) return '1080p';
  if (/\b720p\b/.test(t)) return '720p';
  if (/\b480p\b/.test(t)) return '480p';
  if (/\b(sd|360p|240p)\b/.test(t)) return 'SD';
  return '?';
}

/** Size in bytes, from behaviorHints or text like "💾 12.3 GB". */
export function sizeBytes(s: SourcedStream): number {
  if (s.behaviorHints?.videoSize) return s.behaviorHints.videoSize;
  const m = text(s).match(/(\d+(?:[.,]\d+)?)\s*(TB|GB|MB)\b/i);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(',', '.'));
  const mult = { TB: 1e12, GB: 1e9, MB: 1e6 }[m[2].toUpperCase() as 'TB' | 'GB' | 'MB'];
  return n * mult;
}

export function formatSize(bytes: number): string {
  if (!bytes) return '';
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

export function tags(s: SourcedStream): string[] {
  const t = text(s);
  const out: string[] = [];
  if (/\b(hdr10\+?|hdr)\b/i.test(t)) out.push('HDR');
  if (/\b(dv|dolby ?vision)\b/i.test(t)) out.push('DV');
  if (/\b(remux)\b/i.test(t)) out.push('REMUX');
  if (/\b(atmos)\b/i.test(t)) out.push('Atmos');
  if (/\b(x265|hevc|h\.?265)\b/i.test(t)) out.push('HEVC');
  if (/\b(av1)\b/i.test(t)) out.push('AV1');
  if (/\[(RD|AD|PM|DL|TB|OC|ED)\+\]|⚡|cached/i.test(t)) out.push('Cached');
  return out;
}

export type StreamSort = 'addon' | 'quality' | 'size-desc' | 'size-asc';

export interface StreamFilters {
  hideCam: boolean;
  /** Case-insensitive keywords; any match hides the stream. */
  excludeKeywords: string[];
  /** If set, only streams at these qualities are shown. */
  qualities: Quality[];
  onlyDirect: boolean;
}

export function filterAndSort(
  streams: SourcedStream[],
  filters: StreamFilters,
  sort: StreamSort,
  addonOrder: string[],
): SourcedStream[] {
  const kw = filters.excludeKeywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
  let out = streams.filter((s) => {
    const q = quality(s);
    if (filters.hideCam && q === 'CAM') return false;
    if (filters.qualities.length && !filters.qualities.includes(q)) return false;
    if (filters.onlyDirect && !s.url) return false;
    const t = text(s).toLowerCase();
    return !kw.some((k) => t.includes(k));
  });

  const addonIdx = (s: SourcedStream) => {
    const i = addonOrder.indexOf(s.addonId);
    return i < 0 ? 999 : i;
  };
  const cmp: Record<StreamSort, (a: SourcedStream, b: SourcedStream) => number> = {
    addon: (a, b) => addonIdx(a) - addonIdx(b),
    quality: (a, b) => QUALITY_RANK[quality(b)] - QUALITY_RANK[quality(a)] || sizeBytes(b) - sizeBytes(a),
    'size-desc': (a, b) => sizeBytes(b) - sizeBytes(a),
    'size-asc': (a, b) => (sizeBytes(a) || Infinity) - (sizeBytes(b) || Infinity),
  };
  out = [...out].sort(cmp[sort]); // stable: preserves addon order on ties
  return out;
}

/**
 * Turns a stream into something a player can open.
 * Torrent (infoHash) streams go through a Stremio streaming server
 * (Stremio Service runs one at http://127.0.0.1:11470).
 */
export function playableUrl(s: SourcedStream, streamingServer: string): string | null {
  if (s.url) return s.url;
  if (s.ytId) return `https://www.youtube.com/watch?v=${s.ytId}`;
  if (s.infoHash) {
    const server = streamingServer.replace(/\/+$/, '');
    return `${server}/${s.infoHash.toLowerCase()}/${s.fileIdx ?? -1}`;
  }
  return null;
}

export function streamLabel(s: SourcedStream): { title: string; detail: string } {
  const title = (s.name || s.addonName).replace(/\n/g, ' ');
  const detail = (s.title || s.description || s.behaviorHints?.filename || '').trim();
  return { title, detail };
}

export interface StreamInfo {
  /** Short source name, e.g. "Debridio 4k DV" or "Torrentio" */
  source: string;
  /** Debrid service abbreviation, e.g. "RD", "AD", "TB" */
  service: string;
  /** Instantly available on the debrid service */
  cached: boolean;
  /** File or release name, one line */
  file: string;
  size: string;
  seeders: number | null;
  /** Everything the addon said, for the hover tooltip */
  full: string;
}

// [RD+] / [RD⚡] = cached, [RD] / [RD download] = not cached yet
const SERVICE_RE = /\[(RD|AD|PM|DL|TB|OC|ED|EN|PK|TRB|DLS|SDB)(\+|⚡)?(?:\s+download)?\]/i;
// Lines that are only stats (📺 💾 👤 ⚙️ …) or language flags.
const STAT_EMOJI_RE = /💾|👤|⚙|🔎|📺|🌐|🔊|🗣|⏱|📅|🧲|📦/u;
const ONLY_FLAGS_RE = /^[\p{Regional_Indicator}\p{Extended_Pictographic}\u{FE0F}\u{200D}\s|/·•,]+$/u;
const LEAD_EMOJI_RE = /^[\p{Extended_Pictographic}\u{FE0F}\u{200D}]+\s*/u;
const RES_RE = /\b(4k|uhd|2160p|1080p|720p|480p|sd)\b/gi;

/** Turns an addon's free-form name/title/description into tidy, consistent parts. */
export function describe(s: SourcedStream): StreamInfo {
  const rawName = (s.name ?? '').trim();
  const rawText = (s.title || s.description || '').trim();
  const all = `${rawName}\n${rawText}`;

  const svc = all.match(SERVICE_RE);
  const service = svc ? svc[1].toUpperCase() : '';
  const cached = !!svc?.[2] || /⚡|\bcached\b|\binstant\b/i.test(all);

  // The quality badge already shows the resolution, so drop it from the name.
  const source =
    rawName
      .replace(SERVICE_RE, '')
      .split('\n')
      .map((l) => l.replace(RES_RE, '').replace(/^[\s|·•-]+|[\s|·•-]+$/g, '').replace(/\s{2,}/g, ' ').trim())
      .filter(Boolean)
      .join(' · ') || s.addonName;

  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !STAT_EMOJI_RE.test(l) && !ONLY_FLAGS_RE.test(l))
    .map((l) => l.replace(LEAD_EMOJI_RE, ''));
  const fileLine = s.behaviorHints?.filename || lines.find((l) => /[.\-_]/.test(l)) || lines[0] || '';
  const seed = all.match(/👤\s*(\d+)/u);

  return {
    source,
    service,
    cached,
    file: fileLine.replace(SERVICE_RE, '').trim(),
    size: formatSize(sizeBytes(s)),
    seeders: seed ? Number(seed[1]) : null,
    full: [rawName.replace(/\n/g, ' '), rawText].filter(Boolean).join('\n'),
  };
}
