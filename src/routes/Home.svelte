<script lang="ts">
  import CatalogRow from '../lib/components/CatalogRow.svelte';
  import PosterCard from '../lib/components/PosterCard.svelte';
  import { boardCatalogs, syncRows } from '../lib/home';
  import { addons } from '../lib/stores/addons.svelte';
  import { library } from '../lib/stores/library.svelte';
  import { href } from '../lib/stores/router.svelte';
  import { settings } from '../lib/stores/settings.svelte';

  const available = $derived(boardCatalogs(addons.list, settings.hideAdultAddons));

  // Keep saved row order in sync with installed addons.
  $effect(() => {
    const next = syncRows($state.snapshot(settings.homeRows), available);
    if (JSON.stringify(next) !== JSON.stringify($state.snapshot(settings.homeRows))) settings.homeRows = next;
  });

  const rows = $derived(
    settings.homeRows
      .filter((r) => r.enabled)
      .map((r) => available.find((b) => b.key === r.key))
      .filter((b) => !!b),
  );
</script>

<div class="page">
  {#if settings.showContinueWatching && library.history.length}
    <section class="cw">
      <h2>Continue watching</h2>
      <div class="scroller">
        {#each library.history.slice(0, 20) as h (h.meta.id)}
          <PosterCard meta={h.meta} subtitle={h.label} />
        {/each}
      </div>
    </section>
  {/if}

  {#each rows as row (row.key)}
    <CatalogRow addon={row.addon} catalog={row.catalog} title={row.title} />
  {:else}
    <div class="empty">
      <p>No catalogs to show yet.</p>
      <a class="btn primary" href={href('addons')}>Add addons</a>
    </div>
  {/each}
</div>

<style>
  .cw { margin-bottom: 28px; }
  h2 { font-size: 17px; font-weight: 700; margin: 0 0 12px; }
  .scroller { display: flex; gap: 14px; overflow-x: auto; padding: 4px 2px 10px; scrollbar-width: none; }
  .scroller::-webkit-scrollbar { display: none; }
</style>
