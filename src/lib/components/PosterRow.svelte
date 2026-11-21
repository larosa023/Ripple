<script lang="ts">
  // A titled row of posters from a list you already have (recommendations, collections, filmographies).
  import Icon from './Icon.svelte';
  import PosterCard from './PosterCard.svelte';
  import { dragScroll } from '../actions/dragScroll';
  import { look } from '../theme/look.svelte';
  import type { MetaPreview } from '../stremio/types';

  let { title, items, subtitles }: { title: string; items: MetaPreview[]; subtitles?: string[] } = $props();
  let scroller: HTMLDivElement | undefined = $state();

  function scroll(dir: 1 | -1) {
    scroller?.scrollBy({ left: dir * (scroller?.clientWidth ?? 0) * 0.85, behavior: look.reduceMotion ? 'auto' : 'smooth' });
  }
</script>

{#if items.length}
  <section class="prow">
    <header>
      <h2>{title}</h2>
      <div class="nav">
        <button class="icon-btn" onclick={() => scroll(-1)} aria-label="Scroll left"><Icon name="chevronLeft" /></button>
        <button class="icon-btn" onclick={() => scroll(1)} aria-label="Scroll right"><Icon name="chevronRight" /></button>
      </div>
    </header>
    <div class="scroller" use:dragScroll bind:this={scroller}>
      {#each items as meta, i (meta.type + meta.id)}
        <PosterCard {meta} subtitle={subtitles?.[i] ?? ''} />
      {/each}
    </div>
  </section>
{/if}

<style>
  .prow { margin-bottom: 26px; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  h2 { font-family: var(--font-display); font-size: 19px; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
  .nav { display: flex; gap: 2px; }
</style>
