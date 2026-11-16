// XMLTV guide parsing (the "EPG" file IPTV providers publish next to their M3U).
// Guides can be tens of megabytes, so this runs in a worker (epg.worker.ts) and only keeps
// a window around now: what's on, and what's next for the coming day and a half.

export interface Programme {
  /** Start / stop, ms since epoch. */
  s: number;
  e: number;
  /** Title. */
  t: string;
  /** Short description (trimmed). */
  d?: string;
}

export interface Guide {
  /** XMLTV channel id → programmes, sorted by start. */
  programmes: Record<string, Programme[]>;
  /** XMLTV channel id → display names (for matching channels without a tvg-id). */
  names: Record<string, string[]>;
  /** Window covered, ms. */
  from: number;
  to: number;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeXml(s: string): string {
  const cdata = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1].trim();
  return s
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .trim();
}

/** "20261115203000 +0100" (offset optional, UTC when missing) → ms. */
export function parseXmltvTime(v: string): number {
  const m = v.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{2}:?\d{2}|Z)?/);
  if (!m) return NaN;
  const [, y, mo, d, h, mi, sec = '00', tz] = m;
  let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec);
  if (tz && tz !== 'Z') {
    const t = tz.replace(':', '');
    const sign = t[0] === '-' ? -1 : 1;
    ms -= sign * (parseInt(t.slice(1, 3), 10) * 60 + parseInt(t.slice(3, 5), 10)) * 60_000;
  }
  return ms;
}

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`));
  return m ? (m[2] ?? m[3] ?? '') : '';
}

function child(body: string, name: string): string {
  const m = body.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decodeXml(m[1]) : '';
}

/** Parses XMLTV text, keeping programmes that overlap [from, to]. */
export function parseXmltv(xml: string, from: number, to: number): Guide {
  const programmes: Record<string, Programme[]> = {};
  const names: Record<string, string[]> = {};

  const chRe = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g;
  for (let m = chRe.exec(xml); m; m = chRe.exec(xml)) {
    const id = decodeXml(attr(m[1], 'id'));
    if (!id) continue;
    const list: string[] = [];
    const dn = /<display-name\b[^>]*>([\s\S]*?)<\/display-name>/g;
    for (let n = dn.exec(m[2]); n; n = dn.exec(m[2])) {
      const v = decodeXml(n[1]);
      if (v) list.push(v);
    }
    names[id] = list;
  }

  const pRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  for (let m = pRe.exec(xml); m; m = pRe.exec(xml)) {
    const head = m[1];
    const s = parseXmltvTime(attr(head, 'start'));
    let e = parseXmltvTime(attr(head, 'stop'));
    if (!Number.isFinite(s)) continue;
    if (!Number.isFinite(e)) e = s + 30 * 60_000;
    if (e < from || s > to) continue;
    const ch = decodeXml(attr(head, 'channel'));
    if (!ch) continue;
    const t = child(m[2], 'title');
    let d = child(m[2], 'desc');
    if (d.length > 280) d = d.slice(0, 277).trimEnd() + '…';
    (programmes[ch] ??= []).push(d ? { s, e, t: t || 'Untitled', d } : { s, e, t: t || 'Untitled' });
  }

  // Sorted; when the guide had programmes without stop times, end each one where the next starts.
  for (const list of Object.values(programmes)) {
    list.sort((a, b) => a.s - b.s);
    for (let i = 0; i < list.length - 1; i++) if (list[i].e > list[i + 1].s) list[i].e = list[i + 1].s;
  }
  return { programmes, names, from, to };
}

/** Index of the programme on at `now` (or -1), by binary search. */
export function onAt(list: Programme[] | undefined, now: number): number {
  if (!list?.length) return -1;
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].e <= now) lo = mid + 1;
    else if (list[mid].s > now) hi = mid - 1;
    else return mid;
  }
  return -1;
}

/** Bytes → text, gunzipping when the guide is a .gz (very common for XMLTV). */
export async function decodeGuideBytes(buf: ArrayBuffer): Promise<string> {
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }
  return new TextDecoder().decode(buf);
}
