<script lang="ts">
  import { getCatalog } from '../stremio/client';
  import type { CatalogDef, InstalledAddon, MetaPreview } from '../stremio/types';
  import type { RowDisplay } from '../stores/settings.svelte';
  import { settings } from '../stores/settings.svelte';
  import { look } from '../theme/look.svelte';
  import { go } from '../stores/router.svelte';
  import PosterCard from './PosterCard.svelte';
  import Icon from './Icon.svelte';
  import { dragScroll } from '../actions/dragScroll';

  let {
    addon,
    catalog,
    title,
    display = 'poster',
    extra,
  }: {
    addon: InstalledAddon;
    catalog: CatalogDef;
    title: string;
    display?: RowDisplay;
    extra?: Record<string, string>;
  } = $props();

  let items: MetaPreview[] = $state([]);
  let status: 'idle' | 'loading' | 'done' | 'error' = $state('idle');
  let el: HTMLElement;
  let scroller: HTMLElement | undefined = $state();

  const shown = $derived(display === 'top10' ? items.slice(0, 10) : items.slice(0, settings.rowItemLimit));

  async function load() {
    status = 'loading';
    try {
      items = await getCatalog(addon, catalog.type, catalog.id, extra);
      status = 'done';
    } catch {
      status = 'error';
    }
  }

  // Only fetch when the row scrolls near the viewport: a dozen rows cost nothing until seen.
  $effect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && status === 'idle') {
          load();
          io.disconnect();
        }
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  });

  function scroll(dir: 1 | -1) {
    scroller?.scrollBy({ left: dir * (scroller?.clientWidth ?? 0) * 0.85, behavior: look.reduceMotion ? 'auto' : 'smooth' });
  }
</script>

<section class="row" bind:this={el}>
  {#if status !== 'error' && !(status === 'done' && items.length === 0)}
    <header>
      <button class="title" onclick={() => go('discover', [], { addon: addon.manifest.id, type: catalog.type, catalog: catalog.id })}>
        {#if display === 'top10'}<span class="t10">TOP 10</span>{/if}
        {title}<span class="src">{addon.manifest.name}</span><Icon name="chevronRight" size={16} />
      </button>
      <div class="nav">
        <button class="icon-btn" onclick={() => scroll(-1)} aria-label="Scroll left"><Icon name="chevronLeft" /></button>
        <button class="icon-btn" onclick={() => scroll(1)} aria-label="Scroll right"><Icon name="chevronRight" /></button>
      </div>
    </header>
    <div class="scroller" use:dragScroll bind:this={scroller}>
      {#if status === 'done'}
        {#each shown as meta, i (meta.id)}
          <PosterCard {meta} variant={display} rank={i + 1} />
        {/each}
      {:else}
        {#each Array(8) as _, i (i)}
          <div class="ph skeleton" class:wide={display === 'wide'}></div>
        {/each}
      {/if}
    </div>
  {/if}
</section>

<style>
  .row { margin-bottom: var(--row-gap); min-height: 40px; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .title {
    display: inline-flex; align-items: center; gap: 8px; background: none; border: 0; padding: 0; cursor: pointer;
    font-family: var(--font-display); font-size: 18px; font-weight: 700; letter-spacing: -0.01em;
  }
  .title:hover { color: var(--accent); }
  .t10 {
    font-family: var(--font); font-size: 11px; font-weight: 800; letter-spacing: 0.08em; padding: 3px 7px;
    border-radius: 5px; background: var(--accent); color: var(--on-accent);
  }
  .src { font-family: var(--font); font-size: 12px; font-weight: 500; color: var(--text-3); }
  .nav { display: flex; gap: 2px; }
  .ph { width: var(--poster-w); aspect-ratio: 2 / 3; border-radius: var(--radius); flex-shrink: 0; }
  .ph.wide { width: calc(var(--poster-w) * 1.9); aspect-ratio: 16 / 9; }
</style>
