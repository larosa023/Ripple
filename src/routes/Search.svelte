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
  import { hasTmdb, searchPeople, type PersonHit } from '../lib/tmdb';
  import { href } from '../lib/stores/router.svelte';
  import { load, save } from '../lib/stores/persist';

  // Recent searches, newest first.
  let recent = $state<string[]>(load<string[]>('recentSearches', []));
  function remember(q: string) {
    recent = [q, ...recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, 12);
    save('recentSearches', recent);
  }
  function forget(q: string) {
    recent = recent.filter((r) => r !== q);
    save('recentSearches', recent);
  }
  let people = $state<PersonHit[]>([]);

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
    people = [];
    if (!q) {
      pending = 0;
      return;
    }
    // Saved once you've paused on a search, not on every keystroke.
    const keep = setTimeout(() => remember(q), 1500);
    if (hasTmdb() && q.length > 1) {
      searchPeople(q)
        .then((p) => my === token && (people = p))
        .catch(() => {});
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
    return () => clearTimeout(keep);
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
    {#if recent.length}
      <section>
        <h2>Recent searches</h2>
        <div class="chips">
          {#each recent as r (r)}
            <span class="chip">
              <button class="ctext" onclick={() => { input = r; go('search', [], { q: r }, true); }}>{r}</button>
              <button class="cx" onclick={() => forget(r)} aria-label="Remove {r}"><Icon name="x" size={12} /></button>
            </span>
          {/each}
        </div>
      </section>
    {/if}
    <div class="empty faint">Search runs across every addon catalog that supports it{hasTmdb() ? ', plus people from TMDB' : ''}.</div>
  {:else}
    {#if people.length}
      <section>
        <h2>People <span class="faint">TMDB</span></h2>
        <div class="scroller" use:dragScroll>
          {#each people as p (p.id)}
            <a class="who" href={href('person', String(p.id))}>
              <img src={p.photo} alt="" loading="lazy" />
              <b>{p.name}</b>
              <small>{p.knownFor}</small>
            </a>
          {/each}
        </div>
      </section>
    {/if}
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
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { display: inline-flex; align-items: center; border-radius: 999px; background: var(--bg-2); border: 1px solid var(--line); overflow: hidden; }
  .chip:hover { border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
  .ctext { border: 0; background: none; color: var(--text); font: 500 13.5px var(--font); padding: 7px 4px 7px 14px; cursor: pointer; }
  .cx { border: 0; background: none; color: var(--text-3); padding: 7px 10px 7px 6px; cursor: pointer; display: grid; }
  .cx:hover { color: var(--text); }
  .who { width: 112px; flex-shrink: 0; text-align: center; color: inherit; text-decoration: none; display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .who img { width: 96px; height: 96px; border-radius: 50%; object-fit: cover; background: var(--bg-3); margin-bottom: 6px; transition: box-shadow var(--dur); }
  .who:hover img { box-shadow: 0 0 0 2px var(--accent); }
  .who b { font-size: 13.5px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who small { font-size: 11.5px; color: var(--text-3); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
