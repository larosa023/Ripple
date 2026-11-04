<script lang="ts">
  import CatalogRow from '../lib/components/CatalogRow.svelte';
  import Hero from '../lib/components/Hero.svelte';
  import { dragScroll } from '../lib/actions/dragScroll';
  import PosterCard from '../lib/components/PosterCard.svelte';
  import { boardCatalogs, syncRows } from '../lib/home';
  import { addons } from '../lib/stores/addons.svelte';
  import { library, removeFromContinue } from '../lib/stores/library.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import Icon from '../lib/components/Icon.svelte';
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
      <div class="scroller" use:dragScroll>
        {#each library.history.slice(0, 20) as h (h.meta.id)}
          <div class="cw-item">
            <PosterCard meta={h.meta} subtitle={h.label} variant={look.cwStyle === 'wide' ? 'wide' : 'poster'} progress={library.progress?.[h.videoId]?.d ? Math.min(1, library.progress[h.videoId].t / library.progress[h.videoId].d) : 0} />
            <button
              class="cw-remove"
              title="Remove from Continue watching"
              aria-label={`Remove ${h.meta.name} from Continue watching`}
              onclick={() => {
                const undo = removeFromContinue(h.meta.id);
                toast(`Removed ${h.meta.name}`, 'info', 6000, { label: 'Undo', run: undo });
              }}
            ><Icon name="x" size={14} stroke={2.4} /></button>
          </div>
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
  .cw-item { position: relative; flex-shrink: 0; }
  .cw-remove {
    position: absolute; top: 8px; left: 8px; z-index: 2; width: 26px; height: 26px; padding: 0; display: grid; place-items: center;
    border: 0; border-radius: 50%; background: rgb(0 0 0 / 0.72); color: #fff; cursor: pointer;
    opacity: 0; transform: scale(0.85); transition: opacity var(--dur), transform var(--dur), background var(--dur);
  }
  .cw-item:hover .cw-remove, .cw-remove:focus-visible { opacity: 1; transform: none; }
  .cw-remove:hover { background: var(--danger); }
</style>
