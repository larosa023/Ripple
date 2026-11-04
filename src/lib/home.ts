import { isBoardCatalog } from './stremio/client';
import type { CatalogDef, InstalledAddon } from './stremio/types';
import type { HomeRow } from './stores/settings.svelte';

export interface BoardCatalog {
  key: string;
  addon: InstalledAddon;
  catalog: CatalogDef;
  title: string;
}

const TYPE_LABEL: Record<string, string> = { movie: 'Movies', series: 'Series', channel: 'Channels', tv: 'TV' };

export function typeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

export function catalogKey(addon: InstalledAddon, c: CatalogDef): string {
  return `${addon.manifest.id}|${c.type}|${c.id}`;
}

/** Every catalog that can be shown as a home row, across enabled addons. */
export function boardCatalogs(addons: InstalledAddon[], hideAdult: boolean): BoardCatalog[] {
  return addons
    .filter((a) => a.enabled && !(hideAdult && a.manifest.behaviorHints?.adult))
    .flatMap((a) =>
      a.manifest.catalogs.filter(isBoardCatalog).map((c) => ({
        key: catalogKey(a, c),
        addon: a,
        catalog: c,
        title: `${c.name ?? c.id} ${typeLabel(c.type)}`,
      })),
    )
    // An addon can list the same catalog twice; rows are keyed, so keep the first.
    .filter((b, i, all) => all.findIndex((x) => x.key === b.key) === i);
}

/**
 * Keeps the user's row order, names and styles, and appends rows from newly
 * installed addons at the end, enabled. Rows whose addon is disabled or not
 * loaded yet are kept (just not shown) so their customizations survive.
 */
export function syncRows(saved: HomeRow[], available: BoardCatalog[]): HomeRow[] {
  const known = new Set(saved.map((r) => r.key));
  const added = available.filter((b) => !known.has(b.key)).map((b) => ({ key: b.key, enabled: true }));
  return added.length ? [...saved, ...added] : saved;
}
