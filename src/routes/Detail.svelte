<script lang="ts">
  import Icon from '../lib/components/Icon.svelte';
  import Sources from '../lib/components/Sources.svelte';
  import { dragScroll } from '../lib/actions/dragScroll';
  import { getMeta } from '../lib/stremio/client';
  import type { MetaDetail, Video } from '../lib/stremio/types';
  import { openExternal } from '../lib/player';
  import { enabledAddons } from '../lib/stores/addons.svelte';
  import { isSaved, isWatched, library, resumePoint, toggleSaved, toggleWatched } from '../lib/stores/library.svelte';
  import { fmtTime, playback, setFullscreen } from '../lib/stores/playback.svelte';
  import { back, router } from '../lib/stores/router.svelte';
  import { isTauri } from '../lib/stremio/http';
  import { untrack } from 'svelte';
  import { backdropOf, logoOf } from '../lib/stremio/images';
  import { look } from '../lib/theme/look.svelte';

  const type = $derived(router.route.params[0] ?? 'movie');
  const id = $derived(router.route.params[1] ?? '');

  let meta = $state<MetaDetail | null>(null);
  let error = $state('');
  let logoFailed = $state(false);
  let season = $state<number | null>(null);
  let selected = $state<{ videoId: string; label: string; episode?: Video } | null>(null);
  let moreOpen = $state(false);
  let fullscreen = $state(false);

  $effect(() => {
    const t = type;
    const i = id;
    meta = null;
    error = '';
    selected = null;
    season = null;
    logoFailed = false;
    let live = true;
    getMeta(untrack(enabledAddons), t, i)
      .then((m) => {
        if (!live) return;
        meta = m;
        const vids = m.videos ?? [];
        if (vids.length && t !== 'movie') {
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

  function epCode(v: Video): string {
    const n = v.episode ?? v.number;
    return v.season != null && n != null ? `S${v.season}E${n}` : '';
  }
  function epLabel(v: Video): string {
    return [epCode(v), v.title ?? v.name ?? ''].filter(Boolean).join(' · ');
  }
  function fmtDate(d?: string) {
    if (!d) return '';
    const dt = new Date(d);
    return isNaN(+dt) ? '' : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  const unreleased = (v: Video) => !!v.released && new Date(v.released) > new Date();
  const byOrder = (a: Video, b: Video) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0);

  /** What Play does: resume the last episode/position, else start from the beginning. */
  const playTarget = $derived.by(() => {
    if (!meta) return null;
    if (!hasEpisodes) {
      const vid = meta.behaviorHints?.defaultVideoId ?? meta.id;
      const t = resumePoint(vid);
      return { videoId: vid, label: '', episode: undefined as Video | undefined, text: t ? `Resume ${fmtTime(t)}` : 'Play' };
    }
    const ordered = videos.filter((v) => (v.season ?? 0) > 0).sort(byOrder);
    const last = library.history.find((h) => h.meta.id === meta!.id);
    let target = last ? videos.find((v) => v.id === last.videoId) : undefined;
    if (target && !resumePoint(target.id) && isWatched(target.id)) {
      // Finished that one: move on to the next released episode.
      const next = ordered[ordered.indexOf(target) + 1];
      if (next && !unreleased(next)) target = next;
    }
    target ??= ordered.find((v) => !unreleased(v)) ?? videos[0];
    if (!target) return null;
    const verb = resumePoint(target.id) ? 'Resume' : last ? 'Continue' : 'Play';
    return { videoId: target.id, label: epLabel(target), episode: target, text: `${verb} ${epCode(target)}`.trim() };
  });

  function openSources(t: { videoId: string; label: string; episode?: Video }) {
    selected = { videoId: t.videoId, label: t.label, episode: t.episode };
  }

  const trailers = $derived.by(() => {
    const out: { id: string; title: string }[] = [];
    for (const t of meta?.trailerStreams ?? []) {
      if (t.ytId) out.push({ id: t.ytId, title: t.title?.replace(meta?.name ?? '', '').trim() || 'Trailer' });
    }
    for (const t of meta?.trailers ?? []) {
      if (t.source && !out.some((o) => o.id === t.source)) out.push({ id: t.source, title: t.type || 'Trailer' });
    }
    return out.slice(0, 12);
  });

  const cast = $derived(
    meta?.app_extras?.cast?.length
      ? meta.app_extras.cast.slice(0, 24)
      : (meta?.cast ?? []).slice(0, 24).map((name) => ({ name, character: '', photo: '' })),
  );
  const directors = $derived(meta?.app_extras?.directors?.map((d) => d.name) ?? meta?.director ?? []);
  const writers = $derived(meta?.app_extras?.writers?.map((d) => d.name) ?? meta?.writer ?? []);
  const imdb = $derived(meta?.id.startsWith('tt') ? `https://www.imdb.com/title/${meta.id}/` : '');

  const details = $derived(
    meta
      ? ([
          ['Directed by', directors.join(', ')],
          ['Written by', writers.slice(0, 4).join(', ')],
          ['Released', fmtDate(meta.released) || String(meta.releaseInfo ?? meta.year ?? '')],
          ['Runtime', meta.runtime ?? ''],
          ['Genres', (meta.genres ?? []).join(', ')],
          ['Country', meta.country ?? ''],
          ['Language', meta.language ?? ''],
          ['Awards', meta.awards ?? ''],
        ].filter(([, v]) => !!v) as [string, string][])
      : [],
  );

  function initials(name: string) {
    return name
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  // Fullscreen for the whole app window, like Nuvio's top-right toggle.
  async function toggleWindowFullscreen() {
    fullscreen = !fullscreen;
    await setFullscreen(fullscreen);
    playback.fullscreen = false; // the player tracks its own fullscreen state
  }
</script>

<svelte:window onclick={() => (moreOpen = false)} />

<div class="detail" class:classic={look.detailLayout === 'classic'}>
  {#if meta && backdropOf(meta, 'large')}
    <div class="bg" style:opacity={0.35 + 0.65 * look.backdropStrength} style:background-image={`url("${backdropOf(meta, 'large')}")`}></div>
    <div class="shade"></div>
  {/if}

  <div class="scroll">
    <div class="topbar">
      <button class="circle" onclick={back} aria-label="Back" title="Back"><Icon name="back" size={20} /></button>
      {#if isTauri}
        <button class="circle" onclick={toggleWindowFullscreen} aria-label="Fullscreen" title="Fullscreen">
          <Icon name={fullscreen ? 'shrink' : 'expand'} size={18} />
        </button>
      {/if}
    </div>

    {#if error}
      <div class="empty">Couldn't load details. <span class="faint">{error}</span></div>
    {:else if !meta}
      <div class="hero loading"><div class="sk-logo skeleton"></div><div class="sk-line skeleton"></div><div class="sk-line short skeleton"></div></div>
    {:else}
      <section class="hero">
        {#if look.detailLayout === 'classic' && meta.poster}<img class="poster" src={meta.poster} alt="" />{/if}
        <div class="info">
          {#if logoOf(meta) && !logoFailed}
            <img class="logo" src={logoOf(meta)} alt={meta.name} onerror={() => (logoFailed = true)} />
          {:else}
            <h1>{meta.name}</h1>
          {/if}

          <div class="facts">
            {#if meta.releaseInfo ?? meta.year}<span>{meta.releaseInfo ?? meta.year}</span>{/if}
            {#if meta.runtime}<span>{meta.runtime.replace(/\s*min$/, 'm')}</span>{/if}
            {#if meta.certification}<span class="cert">{meta.certification}</span>{/if}
            {#if meta.imdbRating}<span class="imdb"><b>IMDb</b>{meta.imdbRating}</span>{/if}
          </div>
          {#if meta.genres?.length}<div class="genres">{meta.genres.join(' • ')}</div>{/if}
          {#if meta.description}<p class="desc">{meta.description}</p>{/if}

          <div class="actions">
            {#if playTarget}
              <button class="play" onclick={() => openSources(playTarget!)}>
                <Icon name="play" size={16} fill />{playTarget.text}
              </button>
            {/if}
            <div class="more-wrap">
              <button class="circle more" aria-label="More" title="More" onclick={(e) => { e.stopPropagation(); moreOpen = !moreOpen; }}>
                <Icon name="dots" size={22} stroke={3} />
              </button>
              {#if moreOpen}
                <div class="menu" role="menu">
                  <button role="menuitem" onclick={() => toggleSaved(meta!)}>
                    <Icon name={isSaved(meta.id) ? 'check' : 'plus'} size={16} />{isSaved(meta.id) ? 'Remove from library' : 'Add to library'}
                  </button>
                  {#if !hasEpisodes}
                    <button role="menuitem" onclick={() => toggleWatched(meta!.behaviorHints?.defaultVideoId ?? meta!.id)}>
                      <Icon name="eye" size={16} />{isWatched(meta.behaviorHints?.defaultVideoId ?? meta.id) ? 'Mark as unwatched' : 'Mark as watched'}
                    </button>
                  {/if}
                  {#if imdb}<button role="menuitem" onclick={() => openExternal(imdb)}><Icon name="external" size={16} />Open on IMDb</button>{/if}
                </div>
              {/if}
            </div>
            {#if isSaved(meta.id)}<span class="saved"><Icon name="check" size={14} stroke={2.4} />In library</span>{/if}
          </div>
        </div>
      </section>

      {#if hasEpisodes}
        <section class="block">
          <div class="block-head">
            <h2>Episodes</h2>
            {#if seasons.length > 1}
              <select class="select season" value={season} onchange={(e) => (season = +e.currentTarget.value)} aria-label="Season">
                {#each seasons as s (s)}<option value={s}>{s === 0 ? 'Specials' : `Season ${s}`}</option>{/each}
              </select>
            {/if}
          </div>
          <div class="episodes" class:grid={look.episodeLayout === 'grid'}>
            {#each episodes as v (v.id)}
              {@const rp = library.progress?.[v.id]}
              <div
                class="ep"
                class:dim={unreleased(v)}
                role="button"
                tabindex="0"
                onclick={() => openSources({ videoId: v.id, label: epLabel(v), episode: v })}
                onkeydown={(e) => e.key === 'Enter' && openSources({ videoId: v.id, label: epLabel(v), episode: v })}
              >
                <div class="thumb">
                  {#if v.thumbnail}<img src={v.thumbnail} alt="" loading="lazy" />{/if}
                  <span class="epn">{v.episode ?? v.number ?? ''}</span>
                  {#if rp}<span class="bar"><i style:width="{(rp.t / rp.d) * 100}%"></i></span>{/if}
                  <span class="hover-play"><Icon name="play" size={16} fill /></span>
                </div>
                <div class="ep-body">
                  <div class="ep-title">{v.title ?? v.name ?? `Episode ${v.episode ?? ''}`}</div>
                  <div class="ep-date">{unreleased(v) ? 'Airs ' : ''}{fmtDate(v.released)}</div>
                  {#if v.overview ?? v.description}<div class="ep-desc">{v.overview ?? v.description}</div>{/if}
                </div>
                <button
                  class="icon-btn seen"
                  class:on={isWatched(v.id)}
                  title={isWatched(v.id) ? 'Mark unwatched' : 'Mark watched'}
                  onclick={(e) => { e.stopPropagation(); toggleWatched(v.id); }}
                ><Icon name={isWatched(v.id) ? 'check' : 'eye'} size={16} /></button>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if look.showCast && cast.length}
        <section class="block">
          <h2>Cast</h2>
          <div class="cast" use:dragScroll>
            {#each cast as c, i (i)}
              <div class="person">
                <div class="face">
                  <span>{initials(c.name)}</span>
                  {#if c.photo}<img src={c.photo} alt="" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')} />{/if}
                </div>
                <div class="pname" title={c.name}>{c.name}</div>
                {#if c.character}<div class="role" title={c.character}>{c.character}</div>{/if}
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if trailers.length}
        <section class="block">
          <h2>Trailers</h2>
          <div class="trailers" use:dragScroll>
            {#each trailers as t (t.id)}
              <button class="trailer" onclick={() => openExternal(`https://www.youtube.com/watch?v=${t.id}`)} title="Watch on YouTube">
                <span class="tthumb">
                  <img src={`https://i.ytimg.com/vi/${t.id}/hqdefault.jpg`} alt="" loading="lazy" />
                  <span class="tplay"><Icon name="play" size={18} fill /></span>
                </span>
                <span class="tname">{t.title}</span>
              </button>
            {/each}
          </div>
        </section>
      {/if}

      {#if details.length}
        <section class="block">
          <h2>{hasEpisodes ? 'Series details' : 'Movie details'}</h2>
          <dl class="details">
            {#each details as [k, v] (k)}<div><dt>{k}</dt><dd>{v}</dd></div>{/each}
          </dl>
        </section>
      {/if}
    {/if}
  </div>

  {#if selected && meta}
    <Sources {meta} videoId={selected.videoId} label={selected.label} episode={selected.episode} onclose={() => (selected = null)} />
  {/if}
</div>

<style>
  .detail { position: relative; height: 100%; overflow: hidden; }
  .bg { position: absolute; inset: 0; background-size: cover; background-position: center top; pointer-events: none; }
  .shade {
    position: absolute; inset: 0; pointer-events: none;
    background:
      linear-gradient(90deg, var(--bg) 0%, color-mix(in srgb, var(--bg) 88%, transparent) 26%, color-mix(in srgb, var(--bg) 40%, transparent) 50%, transparent 72%),
      linear-gradient(0deg, var(--bg) 0%, color-mix(in srgb, var(--bg) 60%, transparent) 30%, transparent 60%);
  }
  .scroll { position: relative; height: 100%; overflow-y: auto; padding: 18px var(--page-pad) calc(var(--dock-space, 0px) + 50px); }

  .topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .circle {
    width: 42px; height: 42px; display: grid; place-items: center; border: 0; border-radius: 50%; cursor: pointer;
    color: var(--text); background: color-mix(in srgb, var(--bg-3) 70%, transparent); backdrop-filter: blur(8px);
    transition: background var(--dur);
  }
  .circle:hover { background: color-mix(in srgb, var(--text) 18%, transparent); }

  .hero { display: flex; gap: 32px; align-items: flex-end; min-height: max(320px, calc(52vh - 60px)); padding-bottom: 8px; }
  .hero.loading { flex-direction: column; align-items: flex-start; justify-content: flex-end; gap: 0; }
  .poster { width: 200px; aspect-ratio: 2 / 3; border-radius: var(--radius); object-fit: cover; box-shadow: 0 16px 40px rgb(0 0 0 / 0.45); flex-shrink: 0; }
  .info { max-width: 600px; min-width: 0; }
  .logo { display: block; max-width: min(440px, 100%); max-height: 150px; object-fit: contain; object-position: left bottom; margin-bottom: 18px; filter: drop-shadow(0 6px 22px rgb(0 0 0 / 0.5)); }
  h1 { font-size: 50px; margin: 0 0 14px; letter-spacing: -0.03em; line-height: 1.02; }
  .sk-logo { width: 340px; height: 110px; border-radius: 12px; margin-bottom: 16px; }
  .sk-line { width: 520px; max-width: 100%; height: 14px; border-radius: 6px; margin-top: 10px; }
  .sk-line.short { width: 300px; }

  .facts { display: flex; align-items: center; gap: 14px; font-weight: 700; font-size: 14px; }
  .cert { padding: 0 5px; border: 1.5px solid var(--text-2); border-radius: 4px; font-size: 11.5px; line-height: 17px; color: var(--text-2); }
  .imdb { display: inline-flex; align-items: center; gap: 6px; color: #f5c518; }
  .imdb b { background: #f5c518; color: #000; font-size: 10.5px; font-weight: 900; padding: 1px 4px; border-radius: 3px; letter-spacing: -0.01em; }
  .genres { margin-top: 6px; font-size: 13.5px; color: var(--text-2); font-weight: 600; }
  .desc { margin: 14px 0 0; font-size: 15px; line-height: 1.6; max-width: 62ch; text-shadow: 0 1px 12px color-mix(in srgb, var(--bg) 70%, transparent); }

  .actions { display: flex; align-items: center; gap: 12px; margin-top: 22px; }
  .play {
    display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-width: 300px; height: 48px; padding: 0 28px;
    border: 0; border-radius: 24px; cursor: pointer; background: #fff; color: #0b0b0d; font-size: 15.5px; font-weight: 800;
    box-shadow: 0 8px 26px rgb(0 0 0 / 0.35); transition: transform var(--dur), filter var(--dur);
  }
  :global(:root[data-light='1']) .play { background: var(--text); color: var(--bg); }
  .play:hover { transform: scale(1.02); filter: brightness(0.94); }
  .play:active { transform: scale(0.99); }
  .more-wrap { position: relative; }
  .more { width: 48px; height: 48px; }
  .menu {
    position: absolute; top: 56px; left: 0; z-index: 10; min-width: 220px; padding: 6px; border-radius: 12px;
    background: var(--bg-2); border: 1px solid var(--line); box-shadow: 0 16px 40px rgb(0 0 0 / 0.45);
  }
  .menu button {
    display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border: 0; border-radius: 8px;
    background: none; cursor: pointer; font-size: 13.5px; text-align: left;
  }
  .menu button:hover { background: var(--bg-3); }
  .saved { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: var(--text-2); }

  .block { margin-top: 34px; }
  h2 { font-size: 20px; font-weight: 800; margin: 0 0 14px; letter-spacing: -0.01em; }
  .block-head { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
  .block-head h2 { margin: 0; }
  .season { width: auto; height: 34px; border-radius: 17px; padding-left: 14px; font-weight: 700; }

  /* Cast */
  .cast { display: flex; gap: 18px; overflow-x: auto; padding: 2px 2px 8px; scrollbar-width: none; }
  .cast::-webkit-scrollbar { display: none; }
  .person { width: 92px; flex-shrink: 0; text-align: center; }
  .face {
    position: relative; width: 84px; height: 84px; margin: 0 auto 8px; border-radius: 50%; overflow: hidden;
    background: color-mix(in srgb, var(--accent) 22%, var(--bg-3)); display: grid; place-items: center;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--text) 12%, transparent);
  }
  .face span { font-weight: 800; font-size: 22px; color: var(--text-2); }
  .face img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .pname { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .role { font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Trailers */
  .trailers { display: flex; gap: 14px; overflow-x: auto; padding: 2px 2px 8px; scrollbar-width: none; }
  .trailers::-webkit-scrollbar { display: none; }
  .trailer { flex-shrink: 0; width: 230px; border: 0; background: none; padding: 0; text-align: left; cursor: pointer; }
  .tthumb { position: relative; display: block; aspect-ratio: 16 / 9; border-radius: var(--radius); overflow: hidden; background: var(--bg-3); }
  .tthumb img { width: 100%; height: 100%; object-fit: cover; transition: transform var(--dur) var(--ease); }
  .trailer:hover .tthumb img { transform: scale(1.04); }
  .tplay {
    position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
    display: grid; place-items: center; background: rgb(0 0 0 / 0.55); color: #fff; opacity: 0; transition: opacity var(--dur);
  }
  .trailer:hover .tplay { opacity: 1; }
  .tname { display: block; margin-top: 8px; font-size: 13.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Episodes */
  .episodes { display: flex; flex-direction: column; gap: 6px; max-width: 900px; }
  .ep {
    display: flex; gap: 16px; align-items: center; padding: 10px; border-radius: calc(var(--radius) + 2px); cursor: pointer;
    background: color-mix(in srgb, var(--bg-2) 70%, transparent); border: 1px solid transparent;
    transition: background var(--dur), border-color var(--dur);
  }
  .ep:hover, .ep:focus-visible { background: color-mix(in srgb, var(--bg-3) 85%, transparent); border-color: color-mix(in srgb, var(--accent) 50%, transparent); outline: none; }
  .ep.dim { opacity: 0.55; }
  .thumb { position: relative; width: 190px; aspect-ratio: 16 / 9; border-radius: var(--radius); overflow: hidden; background: var(--bg-3); flex-shrink: 0; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .epn { position: absolute; left: 8px; bottom: 6px; font-weight: 900; font-size: 22px; color: #fff; text-shadow: 0 2px 8px rgb(0 0 0 / 0.8); }
  .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: rgb(255 255 255 / 0.25); }
  .bar i { display: block; height: 100%; background: var(--accent); }
  .hover-play {
    position: absolute; inset: 0; display: grid; place-items: center; color: #fff; background: rgb(0 0 0 / 0.35);
    opacity: 0; transition: opacity var(--dur);
  }
  .ep:hover .hover-play { opacity: 1; }
  .ep-body { flex: 1; min-width: 0; }
  .ep-title { font-weight: 700; font-size: 15px; }
  .ep-date { font-size: 12.5px; color: var(--text-3); margin-top: 1px; }
  .ep-desc { font-size: 13px; color: var(--text-2); margin-top: 5px; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .seen.on { color: var(--ok); }
  .episodes.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); max-width: none; gap: 12px; }
  .episodes.grid .ep { flex-direction: column; align-items: stretch; position: relative; }
  .episodes.grid .thumb { width: 100%; }
  .episodes.grid .seen { position: absolute; top: 16px; right: 16px; background: rgb(0 0 0 / 0.6); color: #fff; }

  /* Details */
  .details { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px 28px; margin: 0; max-width: 1000px; }
  .details dt { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-3); font-weight: 700; }
  .details dd { margin: 4px 0 0; font-size: 14px; line-height: 1.5; }

  .empty { padding: 80px 20px; text-align: center; color: var(--text-2); }
  @media (max-width: 900px) {
    .poster { display: none; }
    .play { min-width: 0; flex: 1; }
  }
</style>
