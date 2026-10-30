<script lang="ts">
  import Icon from '../lib/components/Icon.svelte';
  import StreamList from '../lib/components/StreamList.svelte';
  import { getMeta } from '../lib/stremio/client';
  import type { MetaDetail, Video } from '../lib/stremio/types';
  import { openExternal } from '../lib/player';
  import { enabledAddons } from '../lib/stores/addons.svelte';
  import { isSaved, isWatched, library, toggleSaved, toggleWatched } from '../lib/stores/library.svelte';
  import { back, router } from '../lib/stores/router.svelte';
  import { untrack } from 'svelte';
  import { backdropOf, logoOf } from '../lib/stremio/images';
  import { look } from '../lib/theme/look.svelte';

  const type = $derived(router.route.params[0] ?? 'movie');
  const id = $derived(router.route.params[1] ?? '');

  let meta = $state<MetaDetail | null>(null);
  let error = $state('');
  let logoFailed = $state(false);
  let season = $state<number | null>(null);
  let selected = $state<{ videoId: string; label: string } | null>(null);

  $effect(() => {
    const t = type;
    const i = id;
    meta = null;
    error = '';
    selected = null;
    season = null;
    let live = true;
    getMeta(untrack(enabledAddons), t, i)
      .then((m) => {
        if (!live) return;
        meta = m;
        const vids = m.videos ?? [];
        if (!vids.length || t === 'movie') {
          selected = { videoId: m.behaviorHints?.defaultVideoId ?? m.id, label: '' };
        } else {
          // Start on the season of the last played episode, else the first real season.
          const last = library.history.find((h) => h.meta.id === m.id);
          const lastVid = last && vids.find((v) => v.id === last.videoId);
          season = lastVid?.season ?? seasonsOf(vids).find((s) => s > 0) ?? seasonsOf(vids)[0] ?? null;
        }
      })
      .catch((e) => {
        if (live) error = (e as Error).message;
      });
    return () => {
      live = false;
    };
  });

  function seasonsOf(vids: Video[]): number[] {
    return [...new Set(vids.map((v) => v.season ?? 0))].sort((a, b) => a - b);
  }

  const videos = $derived(meta?.videos ?? []);
  const hasEpisodes = $derived(videos.length > 0 && type !== 'movie');
  const seasons = $derived(seasonsOf(videos));
  const episodes = $derived(
    videos
      .filter((v) => (v.season ?? 0) === (season ?? 0))
      .sort((a, b) => (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0)),
  );

  function epLabel(v: Video): string {
    const n = v.episode ?? v.number;
    const prefix = v.season != null && n != null ? `S${v.season}E${n}` : '';
    const name = v.title ?? v.name ?? '';
    return [prefix, name].filter(Boolean).join(' · ');
  }

  function fmtDate(d?: string) {
    if (!d) return '';
    const dt = new Date(d);
    return isNaN(+dt) ? '' : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  const unreleased = (v: Video) => !!v.released && new Date(v.released) > new Date();
  const trailer = $derived(meta?.trailers?.find((t) => t.type === 'Trailer') ?? meta?.trailers?.[0]);
  const imdb = $derived(meta?.id.startsWith('tt') ? `https://www.imdb.com/title/${meta.id}/` : '');
</script>

<div class="detail {look.detailLayout}">
  {#if meta && backdropOf(meta, 'large')}
    <div class="bg" style:opacity={look.backdropStrength} style:background-image={`url("${backdropOf(meta, 'large')}")`}></div>
  {/if}
  <div class="scroll">
    <button class="btn ghost backbtn" onclick={back}><Icon name="back" size={18} />Back</button>

    {#if error}
      <div class="empty">Couldn't load details. <span class="faint">{error}</span></div>
    {:else if !meta}
      <div class="hero"><div class="poster skeleton"></div><div class="info"><div class="sk-title skeleton"></div></div></div>
    {:else}
      <div class="layout" class:split={!!selected && !hasEpisodes}>
        <div class="main">
          <div class="hero">
            {#if meta.poster && look.detailLayout === 'classic'}<img class="poster" src={meta.poster} alt="" />{/if}
            <div class="info">
              {#if logoOf(meta) && !logoFailed}
                <img class="logo" src={logoOf(meta)} alt={meta.name} onerror={() => (logoFailed = true)} />
              {:else}
                <h1>{meta.name}</h1>
              {/if}
              <div class="facts">
                {#if meta.releaseInfo ?? meta.year}<span>{meta.releaseInfo ?? meta.year}</span>{/if}
                {#if meta.runtime}<span>{meta.runtime}</span>{/if}
                {#if meta.imdbRating}<span class="rating"><Icon name="star" size={13} fill />{meta.imdbRating}</span>{/if}
              </div>
              {#if meta.genres?.length}<div class="genres">{#each meta.genres as g (g)}<span class="chip">{g}</span>{/each}</div>{/if}
              {#if meta.description}<p class="desc">{meta.description}</p>{/if}
              {#if look.showCast && meta.cast?.length}<p class="faint small">Cast: {meta.cast.slice(0, 6).join(', ')}</p>{/if}
              <div class="actions">
                {#if !hasEpisodes && !selected}
                  <button class="btn primary" onclick={() => (selected = { videoId: meta!.behaviorHints?.defaultVideoId ?? meta!.id, label: '' })}>
                    <Icon name="play" size={14} fill />Show streams
                  </button>
                {/if}
                <button class="btn" class:primary={!isSaved(meta.id) && hasEpisodes} onclick={() => toggleSaved(meta!)}>
                  <Icon name={isSaved(meta.id) ? 'check' : 'plus'} size={16} />{isSaved(meta.id) ? 'In library' : 'Add to library'}
                </button>
                {#if trailer?.source}
                  <button class="btn" onclick={() => openExternal(`https://www.youtube.com/watch?v=${trailer.source}`)}>
                    <Icon name="play" size={14} fill />Trailer
                  </button>
                {/if}
                {#if imdb}<button class="btn ghost" onclick={() => openExternal(imdb)}><Icon name="external" size={16} />IMDb</button>{/if}
              </div>
            </div>
          </div>

          {#if hasEpisodes}
            <div class="episodes-wrap" class:with-streams={!!selected}>
              <div class="episodes" class:grid={look.episodeLayout === 'grid'}>
                {#if seasons.length > 1}
                  <div class="seasons">
                    {#each seasons as s (s)}
                      <button class="pill" class:on={s === season} onclick={() => (season = s)}>{s === 0 ? 'Specials' : `Season ${s}`}</button>
                    {/each}
                  </div>
                {/if}
                {#each episodes as v (v.id)}
                  <div
                    class="ep"
                    class:active={selected?.videoId === v.id}
                    class:dim={unreleased(v)}
                    role="button"
                    tabindex="0"
                    onclick={() => (selected = { videoId: v.id, label: epLabel(v) })}
                    onkeydown={(e) => e.key === 'Enter' && (selected = { videoId: v.id, label: epLabel(v) })}
                  >
                    <div class="thumb">
                      {#if v.thumbnail}<img src={v.thumbnail} alt="" loading="lazy" />{/if}
                    </div>
                    <div class="ep-body">
                      <div class="ep-title">{epLabel(v)}</div>
                      <div class="faint small">{unreleased(v) ? 'Airs ' : ''}{fmtDate(v.released)}</div>
                      {#if v.overview ?? v.description}<div class="ep-desc">{v.overview ?? v.description}</div>{/if}
                    </div>
                    <button
                      class="icon-btn"
                      class:seen={isWatched(v.id)}
                      title={isWatched(v.id) ? 'Mark unwatched' : 'Mark watched'}
                      onclick={(e) => { e.stopPropagation(); toggleWatched(v.id); }}
                    ><Icon name={isWatched(v.id) ? 'check' : 'eye'} size={16} /></button>
                  </div>
                {/each}
              </div>
              {#if selected}
                <aside class="streams card">
                  {#key selected.videoId}
                    <StreamList {meta} videoId={selected.videoId} label={selected.label} onclose={() => (selected = null)} />
                  {/key}
                </aside>
              {/if}
            </div>
          {/if}
        </div>

        {#if selected && !hasEpisodes}
          <aside class="streams card side">
            <StreamList {meta} videoId={selected.videoId} label="" />
          </aside>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .detail { position: relative; height: 100%; overflow: hidden; }
  .bg {
    position: absolute; inset: 0; background-size: cover; background-position: center top;
    mask-image: linear-gradient(to bottom, #000 0%, transparent 75%);
    pointer-events: none;
  }
  .scroll { position: relative; height: 100%; overflow-y: auto; padding: 18px var(--page-pad) 40px; }
  .backbtn { margin-left: -10px; margin-bottom: 10px; }
  .layout.split { display: grid; grid-template-columns: minmax(0, 1fr) 440px; gap: 28px; align-items: start; }
  .hero { display: flex; gap: 28px; margin-bottom: 28px; }
  .poster { width: 210px; aspect-ratio: 2 / 3; border-radius: var(--radius); object-fit: cover; flex-shrink: 0; box-shadow: 0 16px 40px rgb(0 0 0 / 0.45); }
  .info { min-width: 0; max-width: 760px; }
  .sk-title { height: 40px; width: 300px; border-radius: 8px; }
  h1 { font-size: 36px; margin: 6px 0 10px; letter-spacing: -0.02em; line-height: 1.1; }
  .logo { max-width: 360px; max-height: 110px; object-fit: contain; margin: 4px 0 14px; }
  .facts { display: flex; gap: 14px; color: var(--text-2); font-weight: 600; margin-bottom: 10px; }
  .rating { display: inline-flex; gap: 4px; align-items: center; color: #ffd25e; }
  .genres { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
  .desc { color: var(--text); opacity: 0.9; max-width: 70ch; line-height: 1.6; margin: 0 0 10px; }
  .small { font-size: 12.5px; }

  /* Cinematic layout: tall full-bleed backdrop, big logo, no poster */
  .cinematic .bg { height: 78vh; inset: 0 0 auto 0; mask-image: linear-gradient(to bottom, #000 35%, transparent 100%); }
  .cinematic .hero { min-height: 50vh; align-items: flex-end; padding-bottom: 8px; }
  .cinematic .logo { max-width: 460px; max-height: 150px; filter: drop-shadow(0 6px 22px rgb(0 0 0 / 0.55)); }
  .cinematic h1 { font-size: 52px; text-shadow: 0 4px 24px rgb(0 0 0 / 0.45); }
  .cinematic .desc { text-shadow: 0 1px 12px rgb(0 0 0 / 0.5); }
  :global(:root:not([data-light='1'])) .cinematic .info { color: #fff; }
  :global(:root:not([data-light='1'])) .cinematic .facts { color: rgb(255 255 255 / 0.8); }
  .actions { display: flex; gap: 8px; margin-top: 18px; flex-wrap: wrap; }

  .side { position: sticky; top: 0; height: calc(100vh - 80px); padding: 16px; }
  .episodes-wrap.with-streams { display: grid; grid-template-columns: minmax(0, 1fr) 440px; gap: 24px; align-items: start; }
  .episodes-wrap .streams { position: sticky; top: 0; height: calc(100vh - 80px); padding: 16px; }
  .seasons { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
  .pill {
    border: 1px solid var(--line); background: var(--bg-2); height: 30px; padding: 0 14px; border-radius: 15px;
    cursor: pointer; color: var(--text-2); font-weight: 600; font-size: 13px;
  }
  .pill.on { background: var(--accent); border-color: transparent; color: var(--on-accent); }
  .ep {
    display: flex; gap: 14px; align-items: center; padding: 10px; border-radius: var(--radius); cursor: pointer;
    border: 1px solid transparent; transition: background var(--dur), border-color var(--dur);
  }
  .ep:hover { background: var(--bg-2); }
  .ep.active { background: var(--bg-2); border-color: var(--accent); }
  .ep.dim { opacity: 0.55; }
  .thumb { width: 160px; aspect-ratio: 16 / 9; border-radius: calc(var(--radius) * 0.75); overflow: hidden; background: var(--bg-3); flex-shrink: 0; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .ep-body { flex: 1; min-width: 0; }
  .ep-title { font-weight: 600; }
  .ep-desc { font-size: 12.5px; color: var(--text-2); margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .seen { color: var(--ok); }

  /* Episode grid */
  .episodes.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
  .episodes.grid .seasons { grid-column: 1 / -1; }
  .episodes.grid .ep { flex-direction: column; align-items: stretch; position: relative; background: var(--bg-2); }
  .episodes.grid .thumb { width: 100%; }
  .episodes.grid .icon-btn { position: absolute; top: 16px; right: 16px; background: rgb(0 0 0 / 0.6); color: #fff; }

  @media (max-width: 1100px) {
    .layout.split, .episodes-wrap.with-streams { grid-template-columns: 1fr; }
    .side, .episodes-wrap .streams { position: static; height: 520px; }
    .poster { width: 160px; }
  }
</style>
