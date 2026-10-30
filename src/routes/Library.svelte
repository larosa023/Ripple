<script lang="ts">
  import Icon from '../lib/components/Icon.svelte';
  import PosterCard from '../lib/components/PosterCard.svelte';
  import { typeLabel } from '../lib/home';
  import { library, removeFromHistory } from '../lib/stores/library.svelte';

  let tab: 'saved' | 'history' = $state('saved');
  let typeFilter = $state('');
  let sort: 'recent' | 'name' = $state('recent');

  const items = $derived.by(() => {
    const base =
      tab === 'saved'
        ? library.saved.map((i) => ({ meta: i.meta, at: i.addedAt, sub: '' }))
        : library.history.map((h) => ({ meta: h.meta, at: h.watchedAt, sub: h.label }));
    const filtered = typeFilter ? base.filter((i) => i.meta.type === typeFilter) : base;
    return sort === 'name' ? [...filtered].sort((a, b) => a.meta.name.localeCompare(b.meta.name)) : filtered;
  });
  const types = $derived([...new Set([...library.saved, ...library.history].map((i) => i.meta.type))]);
</script>

<div class="page">
  <h1 class="page-title">Library</h1>
  <div class="bar">
    <div class="tabs">
      <button class="tab" class:active={tab === 'saved'} onclick={() => (tab = 'saved')}>Saved · {library.saved.length}</button>
      <button class="tab" class:active={tab === 'history'} onclick={() => (tab = 'history')}>History · {library.history.length}</button>
    </div>
    <select class="select" bind:value={typeFilter}>
      <option value="">All types</option>
      {#each types as t (t)}<option value={t}>{typeLabel(t)}</option>{/each}
    </select>
    <select class="select" bind:value={sort}>
      <option value="recent">Most recent</option>
      <option value="name">A–Z</option>
    </select>
  </div>

  {#if items.length}
    <div class="grid">
      {#each items as i (i.meta.id)}
        <div class="cell">
          <PosterCard meta={i.meta} subtitle={i.sub} fill />
          {#if tab === 'history'}
            <button class="icon-btn rm" title="Remove from history" onclick={() => removeFromHistory(i.meta.id)}><Icon name="x" size={14} /></button>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty">
      {tab === 'saved' ? 'Nothing saved yet. Use “Add to library” on any title.' : 'Nothing watched yet.'}
    </div>
  {/if}
</div>

<style>
  .bar { display: flex; gap: 10px; margin-bottom: 22px; flex-wrap: wrap; }
  .bar .select { width: auto; }
  .tabs { display: flex; gap: 4px; background: var(--bg-2); border: 1px solid var(--line); padding: 3px; border-radius: 9px; }
  .tab { border: 0; background: none; padding: 6px 14px; border-radius: 7px; cursor: pointer; color: var(--text-2); font-weight: 600; }
  .tab.active { background: var(--accent); color: var(--on-accent); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--poster-w), 1fr)); gap: calc(var(--gap) * 1.6) var(--gap); }
  .cell { position: relative; }
  .rm { position: absolute; top: 4px; left: 4px; width: 26px; height: 26px; background: rgb(0 0 0 / 0.65); color: #fff; opacity: 0; }
  .cell:hover .rm { opacity: 1; }
</style>
