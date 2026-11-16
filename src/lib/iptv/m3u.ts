// M3U / M3U8 playlist parser for live TV (the format IPTV providers hand out).
//
// Understands:
//   #EXTM3U url-tvg="…" x-tvg-url="…"          guide (XMLTV) links for the whole list
//   #EXTINF:-1 tvg-id="…" tvg-logo="…" group-title="…",Channel name
//   #EXTGRP:Group                               group when group-title is missing
//   #EXTVLCOPT:http-user-agent=… / http-referrer=…
//   #EXTHTTP:{"User-Agent":"…"}
//   http://host/stream|User-Agent=…&Referer=…  (Kodi-style headers after a pipe)
//   bare URL lines with no #EXTINF at all

export interface Channel {
  /** Stable across refreshes: playlist + guide id/name (+ a counter for duplicates). */
  id: string;
  playlistId: string;
  name: string;
  url: string;
  logo: string;
  group: string;
  /** tvg-id, used to match the XMLTV guide. */
  tvgId: string;
  /** tvg-name, a second way to match the guide. */
  tvgName: string;
  headers: [string, string][];
  /** Position in the playlist (tvg-chno when given). */
  number: number;
}

export interface ParsedPlaylist {
  channels: Channel[];
  /** Guide links listed in the #EXTM3U header. */
  epgUrls: string[];
}

const XTREAM_VOD = /\/(movie|series)\/[^/]+\/[^/]+\/\d+\.[a-z0-9]+(\?.*)?$/i;

const ATTR =/([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/g;

function attrs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(ATTR)) out[m[1].toLowerCase()] = m[2].trim();
  return out;
}

/** Splits `#EXTINF:-1 a="x, y" b="z",Name` into the attribute part and the name, ignoring commas in quotes. */
function splitExtinf(line: string): [string, string] {
  const body = line.slice(line.indexOf(':') + 1);
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) return [body.slice(0, i), body.slice(i + 1).trim()];
  }
  return [body, ''];
}

const HEADER_NAMES: Record<string, string> = {
  'user-agent': 'User-Agent',
  'http-user-agent': 'User-Agent',
  referer: 'Referer',
  referrer: 'Referer',
  'http-referrer': 'Referer',
  'http-referer': 'Referer',
  origin: 'Origin',
  'http-origin': 'Origin',
  cookie: 'Cookie',
};

function setHeader(list: [string, string][], key: string, value: string) {
  const name = HEADER_NAMES[key.toLowerCase()] ?? key;
  if (!value || !/^[A-Za-z0-9-]+$/.test(name)) return;
  const i = list.findIndex(([k]) => k.toLowerCase() === name.toLowerCase());
  if (i >= 0) list[i] = [name, value];
  else list.push([name, value]);
}

function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    return last.replace(/\.(m3u8?|ts|mp4|mpd)$/i, '') || u.hostname;
  } catch {
    return url;
  }
}

function resolveUrl(url: string, base?: string): string {
  // Only path-like text is a relative link; a stray sentence is not.
  if (!base || /^[a-z][a-z0-9+.-]*:/i.test(url) || /\s/.test(url)) return url;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

function splitList(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

/** Parses playlist text. `base` resolves relative stream links (the playlist's own URL). */
export function parseM3U(text: string, playlistId: string, base?: string): ParsedPlaylist {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const channels: Channel[] = [];
  const epgUrls: string[] = [];
  const seen = new Map<string, number>();

  let info: Record<string, string> | null = null;
  let title = '';
  let group = '';
  let headers: [string, string][] = [];

  const reset = () => {
    info = null;
    title = '';
    group = '';
    headers = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const upper = line.slice(0, 12).toUpperCase();
      if (upper.startsWith('#EXTM3U')) {
        const a = attrs(line);
        for (const u of [...splitList(a['url-tvg']), ...splitList(a['x-tvg-url']), ...splitList(a['tvg-url'])]) {
          if (!epgUrls.includes(u)) epgUrls.push(u);
        }
      } else if (upper.startsWith('#EXTINF')) {
        const [attrPart, name] = splitExtinf(line);
        info = attrs(attrPart);
        title = name;
      } else if (upper.startsWith('#EXTGRP')) {
        group = line.slice(line.indexOf(':') + 1).trim();
      } else if (upper.startsWith('#EXTVLCOPT')) {
        const opt = line.slice(line.indexOf(':') + 1);
        const eq = opt.indexOf('=');
        if (eq > 0) setHeader(headers, opt.slice(0, eq).trim(), opt.slice(eq + 1).trim());
      } else if (upper.startsWith('#EXTHTTP')) {
        try {
          const obj = JSON.parse(line.slice(line.indexOf(':') + 1)) as Record<string, unknown>;
          for (const [k, v] of Object.entries(obj)) if (typeof v === 'string') setHeader(headers, k, v);
        } catch {
          /* ignore malformed header blocks */
        }
      }
      continue;
    }

    // A stream line. Kodi-style "url|Header=value&Other=value".
    let url = line;
    const pipe = url.indexOf('|');
    if (pipe > 0) {
      const extra = url.slice(pipe + 1);
      url = url.slice(0, pipe);
      for (const part of extra.split('&')) {
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        let v = part.slice(eq + 1);
        try {
          v = decodeURIComponent(v);
        } catch {
          /* keep as is */
        }
        setHeader(headers, part.slice(0, eq), v);
      }
    }
    url = resolveUrl(url, base);
    // Skip anything that isn't a stream link, and the movie / series entries Xtream Codes
    // providers mix into their playlists (Live TV is for channels; addons cover on-demand).
    if (!/^(https?|rtmps?|rtsp|udp|rtp|mms|srt):\/\//i.test(url) || XTREAM_VOD.test(url)) {
      reset();
      continue;
    }

    const a: Record<string, string> = info ?? {};
    const name = title || a['tvg-name'] || nameFromUrl(url);
    const tvgId = a['tvg-id'] ?? '';
    const key = `${playlistId}|${tvgId}|${name}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    const chno = parseInt(a['tvg-chno'] ?? a['channel-number'] ?? '', 10);
    channels.push({
      id: n > 1 ? `${key}#${n}` : key,
      playlistId,
      name,
      url,
      logo: a['tvg-logo'] || a['logo'] || '',
      group: a['group-title'] || group || '',
      tvgId,
      tvgName: a['tvg-name'] ?? '',
      headers,
      number: Number.isFinite(chno) ? chno : channels.length + 1,
    });
    reset();
  }
  return { channels, epgUrls };
}

/** True when text looks like an M3U playlist (so a wrong link gives a clear error). */
export function looksLikeM3U(text: string): boolean {
  const head = text.replace(/^﻿/, '').trimStart().slice(0, 2000);
  return /^#EXTM3U/i.test(head) || /#EXTINF/i.test(head) || /^(https?|rtmp|rtsp|udp):\/\/\S+$/im.test(head);
}
