<script lang="ts">
  import type { MetaPreview } from '../stremio/types';
  import { href } from '../stores/router.svelte';
  import { settings } from '../stores/settings.svelte';
  import Icon from './Icon.svelte';

  let { meta, subtitle = '' }: { meta: MetaPreview; subtitle?: string } = $props();
  let failed = $state(false);
  const landscape = $derived(meta.posterShape === 'landscape');
  const square = $derived(meta.posterShape === 'square');
</script>

<a class="card" class:landscape class:square href={href('detail', meta.type, meta.id)} title={meta.name}>
  <div class="art">
    {#if meta.poster && !failed}
      <img src={meta.poster} alt="" loading="lazy" decoding="async" onerror={() => (failed = true)} />
    {:else}
      <div class="fallback">{meta.name}</div>
    {/if}
    {#if settings.showRatings && meta.imdbRating}
      <span class="rating"><Icon name="star" size={11} fill />{meta.imdbRating}</span>
    {/if}
  </div>
  {#if settings.showTitles}
    <div class="name">{meta.name}</div>
    {#if subtitle || meta.releaseInfo}<div class="sub">{subtitle || meta.releaseInfo}</div>{/if}
  {/if}
</a>

<style>
  .card { width: var(--poster-w); flex-shrink: 0; display: block; }
  .card.landscape { width: calc(var(--poster-w) * 1.78); }
  .art {
    position: relative;
    aspect-ratio: 2 / 3;
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--bg-3);
    transition: transform var(--dur) var(--ease), box-shadow var(--dur);
  }
  .landscape .art { aspect-ratio: 16 / 9; }
  .square .art { aspect-ratio: 1; }
  .card:hover .art, .card:focus-visible .art {
    transform: translateY(-3px);
    box-shadow: 0 0 0 2px var(--accent), 0 10px 24px rgb(0 0 0 / 0.4);
  }
  img { width: 100%; height: 100%; object-fit: cover; }
  .fallback {
    height: 100%; display: grid; place-items: center; padding: 12px; text-align: center;
    color: var(--text-2); font-weight: 600; font-size: 13px;
  }
  .rating {
    position: absolute; top: 6px; right: 6px; display: inline-flex; gap: 3px; align-items: center;
    padding: 2px 6px; border-radius: 6px; font-size: 11px; font-weight: 700;
    background: rgb(0 0 0 / 0.7); color: #ffd25e;
  }
  .name {
    margin-top: 8px; font-size: 13px; font-weight: 600;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .sub { font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
