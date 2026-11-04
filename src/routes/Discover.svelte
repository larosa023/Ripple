<script lang="ts">
  import PosterCard from '../lib/components/PosterCard.svelte';
  import { catalogExtras, getCatalog, isBoardCatalog } from '../lib/stremio/client';
  import type { MetaPreview } from '../lib/stremio/types';
  import { typeLabel } from '../lib/home';
  import { addons } from '../lib/stores/addons.svelte';
  import { go, router } from '../lib/stores/router.svelte';
  import { settings } from '../lib/stores/settings.svelte';
  import { tick, untrack } from 'svelte';

  const usable = $derived(
    addons.list.filter((a) => a.enabled && !(settings.hideAdultAddons && a.manifest.behaviorHints?.adult)),
  );

  // Catalogs that work without a search query (genre may be required; we supply its first option).
  const catalogs = $derived(
    usable.flatMap((a) =>
      a.manifest.catalogs
        .filter((c) => isBoardCatalog(c) || catalogExtras(c).every((e) => !e.isRequired || (e.name === 'genre' && e.options?.length)))
        .map((c) => ({ addon: a, catalog: c })),
    ).filter((c, i, all) => all.findIndex((x) => x.addon.manifest.id === c.addon.manifest.id && x.catalog.type === c.catalog.type && x.catalog.id === c.catalog.id) === i),
  );
  const types = $derived([...new Set(catalogs.map((c) => c.catalog.type))]);

  const q = $derived(router.route.query);
  const type = $derived(q.get('type') ?? types[0] ?? 'movie');
  const forType = $derived(catalogs.filter((c) => c.catalog.type === type));
  const selected = $derived(
    forType.find((c) => c.addon.manifest.id === q.get('addon') && c.catalog.id === q.get('catalog')) ?? forType[0],
  );
  const genreDef = $derived(selected ? catalogExtras(selected.catalog).find((e) => e.name === 'genre') : undefined);
  const genre = $derived(q.get('genre') ?? (genreDef?.isRequired ? genreDef.options?.[0] : '') ?? '');
  const canSkip = $derived(selected ? catalogExtras(selected.catalog).some((e) => e.name === 'skip') : false);

  let items: MetaPreview[] = $state([]);
  let loading = $state(false);
  let error = $state('');
  let hasMore = $state(true);
  let token = 0;
  let pageEl: HTMLDivElement | undefined = $state();

  function setQuery(patch: Record<string, string>) {
    const next: Record<string, string> = {
      type,
      addon: selected?.addon.manifest.id ?? '',
      catalog: selected?.catalog.id ?? '',
      genre,
      ...patch,
    };
    for (const k of Object.keys(next)) if (!next[k]) delete next[k];
    go('discover', [], next);
  }

  async function loadPage(reset: boolean) {
    if (!selected) return;
    const my = reset ? ++token : token;
    loading = true;
    error = '';
    try {
      const skip = reset ? 0 : items.length;
      const page = await getCatalog(selected.addon, selected.catalog.type, selected.catalog.id, {
        genre: genre || undefined,
        skip: skip || undefined,
      });
      if (my !== token) return;
      const seen = new Set(reset ? [] : items.map((i) => i.id));
      const fresh = page.filter((m) => !seen.has(m.id));
      items = reset ? fresh : [...items, ...fresh];
      hasMore = canSkip && fresh.length > 0;
      // If the page doesn't fill the window there's nothing to scroll, so fetch the next page now.
      await tick();
      if (my === token && hasMore && pageEl && pageEl.scrollHeight - pageEl.clientHeight < 600) setTimeout(() => my === token && !loading && loadPage(false), 0);
    } catch (e) {
      if (my === token) error = (e as Error).message;
    } finally {
      if (my === token) loading = false;
    }
  }

  // Reload only when the selection itself changes (by id), not when addon manifests refresh.
  const selectionKey = $derived(`${selected?.addon.manifest.id}|${selected?.catalog.id}|${type}|${genre}`);
  $effect(() => {
    void selectionKey;
    untrack(() => {
      items = [];
      hasMore = true;
      loadPage(true);
    });
  });

  function onScroll(e: Event) {
    const el = e.currentTarget as HTMLElement;
    if (!loading && hasMore && el.scrollTop + el.clientHeight > el.scrollHeight - 600) loadPage(false);
  }
</script>

<div class="page" onscroll={onScroll} bind:this={pageEl}>
  <h1 class="page-title">Discover</h1>
  <div class="filters">
    <div class="tabs">
      {#each types as t (t)}
        <button class="tab" class:active={t === type} onclick={() => setQuery({ type: t, addon: '', catalog: '', genre: '' })}>
          {typeLabel(t)}
        </button>
      {/each}
    </div>
    <select class="select" value={selected ? `${selected.addon.manifest.id}|${selected.catalog.id}` : ''}
      onchange={(e) => {
        const [addon, catalog] = e.currentTarget.value.split('|');
        setQuery({ addon, catalog, genre: '' });
      }}>
      {#each forType as c (c.addon.manifest.id + c.catalog.id)}
        <option value={`${c.addon.manifest.id}|${c.catalog.id}`}>{c.catalog.name ?? c.catalog.id} · {c.addon.manifest.name}</option>
      {/each}
    </select>
    {#if genreDef?.options?.length}
      <select class="select" value={genre} onchange={(e) => setQuery({ genre: e.currentTarget.value })}>
        {#if !genreDef.isRequired}<option value="">All genres</option>{/if}
        {#each genreDef.options as g (g)}<option value={g}>{g}</option>{/each}
      </select>
    {/if}
  </div>

  {#if error && !items.length}
    <div class="empty">Couldn't load this catalog. <span class="faint">{error}</span></div>
  {:else}
    <div class="grid">
      {#each items as meta (meta.id)}
        <PosterCard {meta} fill />
      {/each}
    </div>
    {#if loading}<div class="more"><div class="spinner"></div></div>{/if}
    {#if !loading && !items.length && !error}<div class="empty">Nothing here.</div>{/if}
  {/if}
</div>

<style>
  .filters { display: flex; gap: 10px; align-items: center; margin-bottom: 22px; flex-wrap: wrap; }
  .filters .select { width: auto; min-width: 180px; }
  .tabs { display: flex; gap: 4px; background: var(--bg-2); border: 1px solid var(--line); padding: 3px; border-radius: 9px; }
  .tab { border: 0; background: none; padding: 6px 14px; border-radius: 7px; cursor: pointer; color: var(--text-2); font-weight: 600; }
  .tab.active { background: var(--accent); color: var(--on-accent); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--poster-w), 1fr)); gap: calc(var(--gap) * 1.6) var(--gap); }
  .more { display: grid; place-items: center; padding: 30px; }
</style>
