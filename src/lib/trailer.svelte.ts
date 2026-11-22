// Which trailer the in-app trailer window is showing ('' = closed).
import type { MetaPreview } from './stremio/types';

export const trailer = $state({ id: '', title: '' });

export function openTrailer(id: string, title = '') {
  trailer.title = title;
  trailer.id = id;
}
export function closeTrailer() {
  trailer.id = '';
}

/** YouTube ids of a title's trailers, best first. */
export function trailerIds(m: Pick<MetaPreview, 'name'> & { trailerStreams?: { ytId: string; title?: string }[]; trailers?: { source: string; type: string }[] }): string[] {
  const out: string[] = [];
  for (const t of m.trailerStreams ?? []) if (t.ytId && !out.includes(t.ytId)) out.push(t.ytId);
  for (const t of m.trailers ?? []) if (t.source && !out.includes(t.source)) out.push(t.source);
  return out;
}
