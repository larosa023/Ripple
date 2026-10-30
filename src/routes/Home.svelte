<script lang="ts">
  import CatalogRow from '../lib/components/CatalogRow.svelte';
  import Hero from '../lib/components/Hero.svelte';
  import PosterCard from '../lib/components/PosterCard.svelte';
  import { boardCatalogs, syncRows } from '../lib/home';
  import { addons } from '../lib/stores/addons.svelte';
  import { library } from '../lib/stores/library.svelte';
  import { href } from '../lib/stores/router.svelte';
  import { settings } from '../lib/stores/settings.svelte';
  import { look } from '../lib/theme/look.svelte';

  const available = $derived(boardCatalogs(addons.list, settings.hideAdultAddons));

  // Keep saved row order in sync with installed addons.
  $effect(() => {
    const next = syncRows($state.snapshot(settings.homeRows), available);
    if (JSON.stringify(next) !== JSON.stringify($state.snapshot(settings.homeRows))) settings.homeRows = next;
  });

  const rows = $derived(
    settings.homeRows
      .filter((r) => r.enabled)
      .map((r) => {
        const b = available.find((x) => x.key === r.key);
        return b ? { ...b, title: r.title?.trim() || b.title, display: r.display ?? 'poster' } : null;
      })
      .filter((b) => !!b),
  );

  const heroSource = $derived(
    available.find((b) => b.key === look.heroSource) ?? rows[0] ?? available[0],
  );
</script>

<div class="page">
  {#if look.hero !== 'off' && heroSource}
    {#key heroSource.key}<Hero source={heroSource} />{/key}
  {/if}

  {#if settings.showContinueWatching && library.history.length}
    <section class="cw">
      <h2>Continue watching</h2>
      <div class="scroller">
        {#each library.history.slice(0, 20) as h (h.meta.id)}
          <PosterCard meta={h.meta} subtitle={h.label} variant={look.cwStyle === 'wide' ? 'wide' : 'poster'} />
        {/each}
      </div>
    </section>
  {/if}

  {#each rows as row (row.key)}
    <CatalogRow addon={row.addon} catalog={row.catalog} title={row.title} display={row.display} />
  {:else}
    <div class="empty">
      <p>No catalogs to show yet.</p>
      <a class="btn primary" href={href('addons')}>Add addons</a>
    </div>
  {/each}
</div>

<style>
  .cw { margin-bottom: var(--row-gap); }
  h2 { font-size: 18px; font-weight: 700; margin: 0 0 10px; }
</style>
