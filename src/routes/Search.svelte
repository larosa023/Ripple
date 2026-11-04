<script lang="ts">
  import Icon from '../lib/components/Icon.svelte';
  import { dragScroll } from '../lib/actions/dragScroll';
  import PosterCard from '../lib/components/PosterCard.svelte';
  import { getCatalog, supportsSearch } from '../lib/stremio/client';
  import type { MetaPreview } from '../lib/stremio/types';
  import { typeLabel } from '../lib/home';
  import { addons } from '../lib/stores/addons.svelte';
  import { go, router } from '../lib/stores/router.svelte';
  import { settings } from '../lib/stores/settings.svelte';
  import { untrack } from 'svelte';

  interface Group {
    key: string;
    title: string;
    source: string;
    items: MetaPreview[];
  }

  let input = $state(router.route.query.get('q') ?? '');
  let groups: Group[] = $state([]);
  let pending = $state(0);
  let inputEl: HTMLInputElement;
  let timer: ReturnType<typeof setTimeout>;
  let token = 0;

  const query = $derived(router.route.query.get('q') ?? '');

  const searchable = $derived(
    addons.list
      .filter((a) => a.enabled && !(settings.hideAdultAddons && a.manifest.behaviorHints?.adult))
      .flatMap((a) => a.manifest.catalogs.filter(supportsSearch).map((c) => ({ addon: a, catalog: c })))
      .filter((t, i, all) => all.findIndex((x) => x.addon.manifest.id === t.addon.manifest.id && x.catalog.type === t.catalog.type && x.catalog.id === t.catalog.id) === i),
  );
  // Re-search only when the set of searchable catalogs changes, not when manifests merely refresh.
  const searchableKey = $derived(searchable.map((t) => `${t.addon.manifest.id}|${t.catalog.type}|${t.catalog.id}`).join(','));

  // Back/Forward between searches: keep the box in step with what's shown.
  $effect(() => {
    const q = query;
    untrack(() => {
      if (input.trim() !== q) input = q;
    });
  });

  $effect(() => {
    void searchableKey;
    const q = query.trim();
    const my = ++token;
    groups = [];
    if (!q) {
      pending = 0;
      return;
    }
    const targets = untrack(() => searchable);
    pending = targets.length;
    for (const { addon, catalog } of targets) {
      getCatalog(addon, catalog.type, catalog.id, { search: q })
        .then((items) => {
          if (my !== token || !items.length) return;
          groups.push({
            key: `${addon.manifest.id}|${catalog.type}|${catalog.id}`,
            title: `${typeLabel(catalog.type)}${catalog.name && !/search/i.test(catalog.name) ? ' · ' + catalog.name : ''}`,
            source: addon.manifest.name,
            items: items.slice(0, 40),
          });
        })
        .catch(() => undefined)
        .finally(() => {
          if (my === token) pending--;
        });
    }
  });

  function onInput() {
    clearTimeout(timer);
    // Typing refines the current search in place, so Back goes to the page before Search, not each keystroke.
    timer = setTimeout(() => {
      const q = input.trim();
      if (q !== query) go('search', [], q ? { q } : undefined, true);
    }, 350);
  }

  $effect(() => {
    inputEl?.focus();
    const focus = () => inputEl?.select();
    window.addEventListener('ripple:focus-search', focus);
    return () => window.removeEventListener('ripple:focus-search', focus);
  });
</script>

<div class="page">
  <div class="bar">
    <Icon name="search" size={20} />
    <input
      bind:this={inputEl}
      bind:value={input}
      oninput={onInput}
      placeholder="Search movies, series, channels…"
      spellcheck="false"
    />
    {#if pending > 0}<div class="spinner"></div>{/if}
  </div>

  {#if !query}
    <div class="empty faint">Search runs across every addon catalog that supports it.</div>
  {:else}
    {#each groups as g (g.key)}
      <section>
        <h2>{g.title} <span class="faint">{g.source}</span></h2>
        <div class="scroller" use:dragScroll>
          {#each g.items as meta (meta.id)}<PosterCard {meta} />{/each}
        </div>
      </section>
    {/each}
    {#if pending === 0 && groups.length === 0}
      <div class="empty">No results for “{query}”.</div>
    {/if}
  {/if}
</div>

<style>
  .bar {
    display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 18px; margin-bottom: 28px;
    border-radius: 14px; background: var(--bg-2); border: 1px solid var(--line); color: var(--text-2);
  }
  .bar:focus-within { border-color: var(--accent); }
  .bar input { flex: 1; border: 0; background: none; outline: none; font-size: 17px; color: var(--text); }
  section { margin-bottom: 26px; }
  h2 { font-size: 16px; margin: 0 0 12px; }
  h2 span { font-size: 12px; font-weight: 500; margin-left: 6px; }
  .scroller { display: flex; gap: 14px; overflow-x: auto; padding: 4px 2px 10px; scrollbar-width: none; }
  .scroller::-webkit-scrollbar { display: none; }
</style>
