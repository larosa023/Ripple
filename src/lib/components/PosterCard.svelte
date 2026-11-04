<script lang="ts">
  import type { MetaPreview } from '../stremio/types';
  import { go, href } from '../stores/router.svelte';
  import { isSaved, isWatched, library, removeFromContinue, toggleSaved, toggleWatched } from '../stores/library.svelte';
  import { openMenu, type MenuItem } from '../stores/ui.svelte';
  import { toast } from '../stores/toast.svelte';
  import { openExternal } from '../player';
  import { filmUrl } from '../letterboxd';
  import { look } from '../theme/look.svelte';
  import Icon from './Icon.svelte';
  import { backdropOf, logoOf } from '../stremio/images';

  let {
    meta,
    subtitle = '',
    variant = 'poster',
    rank = 0,
    fill = false,
    progress = 0,
  }: {
    meta: MetaPreview;
    subtitle?: string;
    /** poster = 2:3 art, wide = 16:9 backdrop, top10 = poster with a big rank numeral */
    variant?: 'poster' | 'wide' | 'top10';
    rank?: number;
    /** Stretch to the grid cell instead of the fixed poster width */
    fill?: boolean;
    /** 0..1 watched fraction, drawn as a bar along the bottom of the art */
    progress?: number;
  } = $props();

  function menu(e: MouseEvent) {
    const movie = meta.type === 'movie';
    const items: MenuItem[] = [
      { label: 'Open', icon: 'chevronRight', run: () => go('detail', [meta.type, meta.id]) },
      isSaved(meta.id)
        ? { label: 'Remove from library', icon: 'check', run: () => toggleSaved(meta) }
        : { label: 'Add to library', icon: 'plus', run: () => toggleSaved(meta) },
    ];
    if (movie) {
      items.push({ label: isWatched(meta.id) ? 'Mark as unwatched' : 'Mark as watched', icon: 'eye', run: () => toggleWatched(meta.id) });
    }
    if (library.history.some((h) => h.meta.id === meta.id)) {
      items.push({
        label: 'Remove from Continue watching',
        icon: 'x',
        run: () => {
          const undo = removeFromContinue(meta.id);
          toast(`Removed ${meta.name}`, 'info', 6000, { label: 'Undo', run: undo });
        },
      });
    }
    if (meta.id.startsWith('tt')) items.push({ label: 'Open on IMDb', icon: 'external', run: () => openExternal(`https://www.imdb.com/title/${meta.id.split(':')[0]}/`) });
    const lb = movie ? filmUrl(meta) : null;
    if (lb) items.push({ label: 'Open on Letterboxd', icon: 'external', run: () => openExternal(lb) });
    openMenu(e, items, meta.name);
  }

  let failed = $state(false);
  const wide = $derived(variant === 'wide' || meta.posterShape === 'landscape');
  const square = $derived(!wide && meta.posterShape === 'square');
  const art = $derived(wide ? backdropOf(meta) : meta.poster);
  const logo = $derived(wide ? logoOf(meta) : undefined);
  let logoFailed = $state(false);
  const sub = $derived(subtitle || meta.releaseInfo || '');
</script>

<a
  class="pc"
  class:wide
  class:square
  class:top10={variant === 'top10'}
  class:fill
  href={href('detail', meta.type, meta.id)}
  title={meta.name}
  oncontextmenu={menu}
>
  {#if variant === 'top10'}<span class="rank" aria-hidden="true">{rank}</span>{/if}
  <div class="frame">
    <div class="art">
      {#if art && !failed}
        <img src={art} alt="" loading="lazy" decoding="async" onerror={() => (failed = true)} />
      {:else}
        <div class="fallback">{meta.name}</div>
      {/if}
      {#if look.showRatings && meta.imdbRating}
        <span class="rating"><Icon name="star" size={11} fill />{meta.imdbRating}</span>
      {/if}
      {#if wide && art && !failed}
        <div class="wide-label">
          {#if logo && !logoFailed}
            <img class="logo" src={logo} alt={meta.name} loading="lazy" onerror={() => (logoFailed = true)} />
          {:else}
            <span>{meta.name}</span>
          {/if}
        </div>
      {/if}
      {#if progress > 0}<div class="prog"><i style:width="{Math.min(100, progress * 100)}%"></i></div>{/if}
      <div class="overlay-label">
        <div class="name">{meta.name}</div>
        {#if sub}<div class="sub">{sub}</div>{/if}
      </div>
    </div>
    {#if look.showTitles}
      <div class="below">
        <div class="name">{meta.name}</div>
        {#if sub}<div class="sub">{sub}</div>{/if}
      </div>
    {/if}
  </div>
</a>

<style>
  .pc { --w: var(--poster-w); width: var(--w); flex-shrink: 0; display: flex; align-items: flex-end; position: relative; }
  .pc.wide { --w: calc(var(--poster-w) * 1.9); }
  .pc.top10 { --w: calc(var(--poster-w) * 1.42); }
  .pc.fill { --w: 100%; }
  .frame { flex: 1; min-width: 0; border-radius: var(--radius); transition: transform var(--dur) var(--ease), box-shadow var(--dur), background var(--dur); }

  .rank {
    flex: 0 0 42%; margin-right: -12%; font-family: var(--font-display); font-weight: 900; line-height: 0.78;
    font-size: calc(var(--poster-w) * 1.05); letter-spacing: -0.08em; text-align: right;
    color: transparent; -webkit-text-stroke: 2px color-mix(in srgb, var(--text) 45%, transparent);
    user-select: none; z-index: 0;
  }
  .top10 .frame { z-index: 1; flex: 0 0 var(--poster-w); }

  .art {
    position: relative; aspect-ratio: 2 / 3; border-radius: var(--radius); overflow: hidden; background: var(--bg-3);
    transition: transform var(--dur) var(--ease), box-shadow var(--dur);
  }
  .wide .art { aspect-ratio: 16 / 9; }
  .square .art { aspect-ratio: 1; }
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
  .wide-label {
    position: absolute; inset: auto 0 0 0; padding: 30px 12px 10px; color: #fff; font-weight: 700; font-size: 14px;
    background: linear-gradient(transparent, rgb(0 0 0 / 0.75));
  }
  .wide-label .logo { width: auto; height: auto; max-width: 60%; max-height: 42px; object-fit: contain; }
  .prog { position: absolute; left: 8px; right: 8px; bottom: 8px; height: 4px; border-radius: 2px; background: rgb(255 255 255 / 0.3); overflow: hidden; z-index: 1; }
  .prog i { display: block; height: 100%; background: var(--accent); }
  .below { padding: 8px 2px 2px; }
  .name { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wide .below .name { display: none; }
  .wide .below .sub:only-child { margin-top: 0; }
  .overlay-label { display: none; }

  /* ---- Card styles (look.cardStyle) ---- */
  :global(:root[data-card='outlined']) .frame { border: 1px solid var(--line); padding: 6px; background: var(--bg-2); }
  :global(:root[data-card='outlined']) .art { border-radius: calc(var(--radius) * 0.7); }
  :global(:root[data-card='elevated']) .frame { background: var(--bg-2); padding: 6px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.35); }
  :global(:root[data-card='elevated']) .art { border-radius: calc(var(--radius) * 0.7); }
  :global(:root[data-card='glass']) .frame {
    /* Frosted look from translucency + a light edge; no per-card backdrop blur (that re-renders every card while scrolling). */
    padding: 6px; background: color-mix(in srgb, var(--bg-2) 55%, transparent);
    border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text) 8%, transparent);
  }
  :global(:root[data-card='glass']) .art { border-radius: calc(var(--radius) * 0.7); }
  :global(:root[data-card='outlined']) .below,
  :global(:root[data-card='elevated']) .below,
  :global(:root[data-card='glass']) .below { padding: 8px 4px 2px; }
  :global(:root[data-card='overlay']) .below { display: none; }
  :global(:root[data-card='overlay']) .pc:not(.wide) .overlay-label {
    display: block; position: absolute; inset: auto 0 0 0; padding: 40px 10px 9px; color: #fff;
    background: linear-gradient(transparent, rgb(0 0 0 / 0.85));
  }
  :global(:root[data-card='overlay']) .overlay-label .sub { color: rgb(255 255 255 / 0.7); }

  /* ---- Hover effects (look.hover) ---- */
  :global(:root[data-hover='lift']) .pc:hover .frame,
  :global(:root[data-hover='lift']) .pc:focus-visible .frame { transform: translateY(-4px); }
  :global(:root[data-hover='lift']) .pc:hover .art,
  :global(:root[data-hover='lift']) .pc:focus-visible .art { box-shadow: 0 0 0 2px var(--accent), 0 12px 26px rgb(0 0 0 / 0.4); }
  :global(:root[data-hover='zoom']) .pc:hover .frame,
  :global(:root[data-hover='zoom']) .pc:focus-visible .frame { transform: scale(1.06); }
  :global(:root[data-hover='glow']) .pc:hover .art,
  :global(:root[data-hover='glow']) .pc:focus-visible .art {
    box-shadow: 0 0 0 2px var(--accent), 0 0 28px color-mix(in srgb, var(--accent) 60%, transparent);
  }
  :global(:root[data-hover='none']) .pc:focus-visible .art { box-shadow: 0 0 0 2px var(--accent); }
  .pc:focus-visible { outline: none; }
</style>
