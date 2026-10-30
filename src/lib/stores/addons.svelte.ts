import { fetchManifest, normalizeManifestUrl } from '../stremio/client';
import type { InstalledAddon, Manifest } from '../stremio/types';
import { load, save } from './persist';
import { settings } from './settings.svelte';

export const CINEMETA_URL = 'https://v3-cinemeta.strem.io/manifest.json';

/** Minimal Cinemeta manifest so the app works offline on first run; refreshed on start. */
const CINEMETA_FALLBACK: Manifest = {
  id: 'com.linvo.cinemeta',
  version: '0',
  name: 'Cinemeta',
  description: 'The official addon for movie and series catalogs',
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  resources: ['catalog', 'meta', 'addon_catalog'],
  catalogs: [
    { type: 'movie', id: 'top', name: 'Popular', extra: [{ name: 'search' }, { name: 'genre' }, { name: 'skip' }] },
    { type: 'series', id: 'top', name: 'Popular', extra: [{ name: 'search' }, { name: 'genre' }, { name: 'skip' }] },
  ],
};

const DEFAULTS: InstalledAddon[] = [
  { transportUrl: CINEMETA_URL, manifest: CINEMETA_FALLBACK, enabled: true, protected: true },
];

export const addons: { list: InstalledAddon[] } = $state({ list: load('addons', DEFAULTS) });

$effect.root(() => {
  $effect(() => {
    save('addons', $state.snapshot(addons.list));
  });
});

export function enabledAddons(): InstalledAddon[] {
  return addons.list.filter((a) => a.enabled);
}

export function findAddon(id: string): InstalledAddon | undefined {
  return addons.list.find((a) => a.manifest.id === id);
}

/** Installs (or updates, if already installed) the addon at `input`. */
export async function installAddon(input: string): Promise<InstalledAddon> {
  const url = normalizeManifestUrl(input);
  const manifest = await fetchManifest(url);
  const existing = addons.list.findIndex((a) => a.transportUrl === url || a.manifest.id === manifest.id);
  const addon: InstalledAddon = {
    transportUrl: url,
    manifest,
    enabled: true,
    protected: existing >= 0 ? addons.list[existing].protected : false,
  };
  if (existing >= 0) addons.list[existing] = addon;
  else addons.list.push(addon);
  return addon;
}

export function removeAddon(transportUrl: string) {
  const gone = addons.list.find((a) => a.transportUrl === transportUrl && !a.protected);
  addons.list = addons.list.filter((a) => a.transportUrl !== transportUrl || a.protected);
  // Uninstalling (unlike disabling) also forgets that addon's home row settings.
  if (gone) settings.homeRows = settings.homeRows.filter((r) => !r.key.startsWith(gone.manifest.id + '|'));
}

export function toggleAddon(transportUrl: string) {
  const a = addons.list.find((x) => x.transportUrl === transportUrl);
  if (a) a.enabled = !a.enabled;
}

export function moveAddon(from: number, to: number) {
  if (to < 0 || to >= addons.list.length || from === to) return;
  const next = [...addons.list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  addons.list = next;
}

/** Re-fetches every manifest so catalogs and versions stay current. */
export async function refreshAddons(): Promise<number> {
  let failed = 0;
  await Promise.all(
    addons.list.map(async (a, i) => {
      try {
        const manifest = await fetchManifest(a.transportUrl);
        addons.list[i] = { ...addons.list[i], manifest };
      } catch {
        failed++;
      }
    }),
  );
  return failed;
}

/** Adds addons from a Stremio account collection, skipping duplicates. */
export function mergeAddons(incoming: { transportUrl: string; manifest: Manifest }[]): number {
  let added = 0;
  for (const a of incoming) {
    if (!a.transportUrl || !a.manifest?.id) continue;
    const url = normalizeManifestUrl(a.transportUrl);
    if (addons.list.some((x) => x.transportUrl === url || x.manifest.id === a.manifest.id)) continue;
    addons.list.push({ transportUrl: url, manifest: { ...a.manifest, catalogs: a.manifest.catalogs ?? [] }, enabled: true });
    added++;
  }
  return added;
}
