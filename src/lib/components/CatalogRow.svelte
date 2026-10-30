<script lang="ts">
  import { getCatalog } from '../stremio/client';
  import type { CatalogDef, InstalledAddon, MetaPreview } from '../stremio/types';
  import { settings } from '../stores/settings.svelte';
  import { go } from '../stores/router.svelte';
  import PosterCard from './PosterCard.svelte';
  import Icon from './Icon.svelte';

  let {
    addon,
    catalog,
    title,
    extra,
  }: { addon: InstalledAddon; catalog: CatalogDef; title: string; extra?: Record<string, string> } = $props();

  let items: MetaPreview[] = $state([]);
  let status: 'idle' | 'loading' | 'done' | 'error' = $state('idle');
  let el: HTMLElement;
  let scroller: HTMLElement | undefined = $state();

  async function load() {
    status = 'loading';
    try {
      items = (await getCatalog(addon, catalog.type, catalog.id, extra)).slice(0, settings.rowItemLimit);
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
    scroller?.scrollBy({ left: dir * (scroller?.clientWidth ?? 0) * 0.85, behavior: settings.reduceMotion ? 'auto' : 'smooth' });
  }
</script>

<section class="row" bind:this={el}>
  {#if status !== 'error' && !(status === 'done' && items.length === 0)}
    <header>
      <button class="title" onclick={() => go('discover', [], { addon: addon.manifest.id, type: catalog.type, catalog: catalog.id })}>
        {title}<span class="src">{addon.manifest.name}</span><Icon name="chevronRight" size={16} />
      </button>
      <div class="nav">
        <button class="icon-btn" onclick={() => scroll(-1)} aria-label="Scroll left"><Icon name="chevronLeft" /></button>
        <button class="icon-btn" onclick={() => scroll(1)} aria-label="Scroll right"><Icon name="chevronRight" /></button>
      </div>
    </header>
    <div class="scroller" bind:this={scroller}>
      {#if status === 'done'}
        {#each items as meta (meta.id)}
          <PosterCard {meta} />
        {/each}
      {:else}
        {#each Array(8) as _, i (i)}
          <div class="ph skeleton"></div>
        {/each}
      {/if}
    </div>
  {/if}
</section>

<style>
  .row { margin-bottom: 28px; min-height: 40px; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .title {
    display: inline-flex; align-items: center; gap: 8px; background: none; border: 0; padding: 0; cursor: pointer;
    font-size: 17px; font-weight: 700; letter-spacing: -0.01em;
  }
  .title:hover { color: var(--accent); }
  .src { font-size: 12px; font-weight: 500; color: var(--text-3); }
  .nav { display: flex; gap: 2px; }
  .scroller {
    display: flex; gap: 14px; overflow-x: auto; overflow-y: hidden; padding: 4px 2px 10px;
    scrollbar-width: none;
  }
  .scroller::-webkit-scrollbar { display: none; }
  .ph { width: var(--poster-w); aspect-ratio: 2 / 3; border-radius: var(--radius); flex-shrink: 0; }
</style>
