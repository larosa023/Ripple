// Fallback artwork for IMDb-keyed titles via MetaHub, the image service
// Stremio's own Cinemeta uses. Catalog previews often omit backdrops/logos.
import type { MetaPreview } from './types';

const imdb = (id: string) => (/^tt\d+$/.test(id) ? id : null);

export function backdropOf(m: MetaPreview, size: 'small' | 'medium' | 'large' = 'medium'): string | undefined {
  if (m.background) return m.background;
  const id = imdb(m.id);
  return id ? `https://images.metahub.space/background/${size}/${id}/img` : m.poster;
}

export function logoOf(m: MetaPreview): string | undefined {
  if (m.logo) return m.logo;
  const id = imdb(m.id);
  return id ? `https://images.metahub.space/logo/medium/${id}/img` : undefined;
}
