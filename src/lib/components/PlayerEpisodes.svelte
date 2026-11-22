<script lang="ts">
  // The player's right-hand Episodes panel: every season of the show that's playing,
  // with thumbnails, your progress, and one click to play.
  import Icon from './Icon.svelte';
  import { playback } from '../stores/playback.svelte';
  import { isWatched, library } from '../stores/library.svelte';
  import { backdropOf } from '../stremio/images';
  import { airDate } from '../dates';
  import { epCode, playEpisode } from '../watch';
  import type { Video } from '../stremio/types';

  let { onclose }: { onclose: () => void } = $props();

  const videos = $derived((playback.meta?.videos ?? []) as Video[]);
  const current = $derived(videos.find((v) => v.id === playback.videoId));
  const seasons = $derived([...new Set(videos.map((v) => v.season ?? 0))].sort((a, b) => (a || 999) - (b || 999)));
  let season = $state<number | null>(null);
  const shown = $derived(season ?? current?.season ?? seasons.find((s) => s > 0) ?? seasons[0] ?? 0);
  const list = $derived(
    videos.filter((v) => (v.season ?? 0) === shown).sort((a, b) => (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0)),
  );
  const fallbackThumb = $derived(playback.meta ? backdropOf(playback.meta, 'small') : '');

  let pending = $state('');
  async function play(v: Video) {
    if (v.id === playback.videoId || pending) return;
    pending = v.id;
    try {
      await playEpisode(v);
    } finally {
      pending = '';
    }
  }

  const soon = (v: Video) => !!v.released && airDate(v.released) > new Date();
  const DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const date = (v: Video) => (v.released ? DATE.format(airDate(v.released)) : '');
  function pct(v: Video) {
    const p = library.progress?.[v.id];
    return p && p.d > 0 ? Math.min(100, (p.t / p.d) * 100) : 0;
  }

  // Open with the playing episode in view.
  let listEl: HTMLDivElement | undefined = $state();
  $effect(() => {
    void shown;
    requestAnimationFrame(() => listEl?.querySelector('.now')?.scrollIntoView({ block: 'center' }));
  });

  // Seasons strip: keep the chosen one visible.
  let tabsEl: HTMLDivElement | undefined = $state();
  $effect(() => {
    void shown;
    tabsEl?.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  });
</script>

<div class="eps" role="dialog" aria-label="Episodes">
  <header>
    <div class="h">
      <span class="over">Episodes</span>
      <b title={playback.title}>{playback.title}</b>
    </div>
    <button class="x" onclick={onclose} aria-label="Close episodes" title="Close (E)"><Icon name="x" size={18} /></button>
  </header>

  {#if seasons.length > 1}
    <div class="tabs" bind:this={tabsEl}>
      {#each seasons as s (s)}
        <button class:on={s === shown} onclick={() => (season = s)}>{s === 0 ? 'Specials' : `Season ${s}`}</button>
      {/each}
    </div>
  {/if}

  <div class="list" bind:this={listEl}>
    {#each list as v (v.id)}
      {@const now = v.id === playback.videoId}
      {@const done = isWatched(v.id)}
      {@const p = pct(v)}
      {@const later = soon(v)}
      <button class="ep" class:now class:later disabled={later} onclick={() => play(v)} aria-current={now ? 'true' : undefined}>
        <span class="thumb" style:background-image={v.thumbnail || fallbackThumb ? `url("${v.thumbnail || fallbackThumb}")` : undefined}>
          {#if now}
            <span class="badge live"><i></i><i></i><i></i>Now playing</span>
          {:else if pending === v.id}
            <span class="spin" aria-label="Finding a source"></span>
          {:else if !later}
            <span class="play"><Icon name="play" size={18} fill /></span>
          {/if}
          {#if done && !now}<span class="badge seen"><Icon name="check" size={12} stroke={3} />Watched</span>{/if}
          {#if p > 0 && p < 97 && !done}<span class="prog"><i style:width="{p}%"></i></span>{/if}
        </span>
        <span class="info">
          <span class="code">{epCode(v) || `Episode ${v.episode ?? v.number ?? ''}`}{#if date(v)}<em>{later ? 'Airs ' : ''}{date(v)}</em>{/if}</span>
          <b>{v.title || v.name || `Episode ${v.episode ?? v.number ?? ''}`}</b>
          {#if v.overview || v.description}<small>{v.overview || v.description}</small>{/if}
        </span>
      </button>
    {:else}
      <p class="none">No episodes listed for this season.</p>
    {/each}
  </div>
</div>

<style>
  .eps {
    /* Floats between the top bar and the controls, so window buttons and the controls stay usable. */
    position: absolute; top: 76px; right: 16px; bottom: 92px; z-index: 6; width: min(420px, calc(100vw - 32px));
    display: flex; flex-direction: column; overflow: hidden; border-radius: 18px;
    background: rgb(12 13 18 / 0.9);
    border: 1px solid rgb(255 255 255 / 0.09);
    box-shadow: 0 30px 80px rgb(0 0 0 / 0.55);
    backdrop-filter: blur(28px) saturate(1.3); -webkit-backdrop-filter: blur(28px) saturate(1.3);
    animation: slide-in calc(var(--dur) + 120ms) cubic-bezier(0.2, 0.8, 0.2, 1);
    color: #fff;
  }
  :global(:root[data-pmenu='solid']) .eps { background: rgb(14 15 20); backdrop-filter: none; -webkit-backdrop-filter: none; }
  @keyframes slide-in { from { transform: translateX(40px); opacity: 0; } }

  header { display: flex; align-items: center; gap: 10px; padding: 18px 14px 10px 20px; }
  .h { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .over { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--player-accent); }
  .h b { font: 700 20px var(--font-display); letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .x { width: 36px; height: 36px; display: grid; place-items: center; border: 0; border-radius: 50%; background: rgb(255 255 255 / 0.08); color: #fff; cursor: pointer; }
  .x:hover { background: rgb(255 255 255 / 0.16); }

  .tabs { display: flex; gap: 6px; padding: 4px 14px 12px 20px; overflow-x: auto; scrollbar-width: none; flex-shrink: 0; }
  .tabs::-webkit-scrollbar { display: none; }
  .tabs button {
    flex-shrink: 0; height: 32px; padding: 0 14px; border-radius: 999px; border: 1px solid rgb(255 255 255 / 0.14);
    background: transparent; color: rgb(255 255 255 / 0.75); font: 600 12.5px var(--font); cursor: pointer;
    transition: background var(--dur), color var(--dur), border-color var(--dur);
  }
  .tabs button:hover { background: rgb(255 255 255 / 0.08); color: #fff; }
  .tabs button.on { background: #fff; border-color: #fff; color: #000; }

  .list { flex: 1; overflow-y: auto; padding: 4px 12px 24px 14px; scrollbar-width: thin; scrollbar-color: rgb(255 255 255 / 0.2) transparent; }
  .list::-webkit-scrollbar { width: 6px; }
  .list::-webkit-scrollbar-thumb { background: rgb(255 255 255 / 0.18); border: 0; border-radius: 6px; }

  .ep {
    display: flex; gap: 12px; width: 100%; padding: 8px; margin-bottom: 2px; border: 0; border-radius: 12px;
    background: none; color: inherit; text-align: left; cursor: pointer; font: inherit;
    transition: background var(--dur);
  }
  .ep:hover:not(:disabled) { background: rgb(255 255 255 / 0.07); }
  .ep:focus-visible { outline: 2px solid var(--player-accent); outline-offset: -2px; }
  .ep.now { background: color-mix(in srgb, var(--player-accent) 16%, transparent); cursor: default; }
  .ep.later { opacity: 0.45; cursor: default; }

  .thumb {
    position: relative; flex-shrink: 0; width: 148px; aspect-ratio: 16 / 9; border-radius: 8px; overflow: hidden;
    background: rgb(255 255 255 / 0.06) center / cover no-repeat;
    box-shadow: 0 0 0 1px rgb(255 255 255 / 0.06) inset;
  }
  .ep.now .thumb { box-shadow: 0 0 0 2px var(--player-accent); }
  .play, .spin {
    position: absolute; inset: 0; margin: auto; width: 38px; height: 38px; border-radius: 50%;
    display: grid; place-items: center; background: rgb(0 0 0 / 0.55); color: #fff;
    opacity: 0; transform: scale(0.85); transition: opacity var(--dur), transform var(--dur);
  }
  .ep:hover .play, .ep:focus-visible .play { opacity: 1; transform: none; }
  .spin { opacity: 1; transform: none; border: 3px solid rgb(255 255 255 / 0.25); border-top-color: #fff; background: rgb(0 0 0 / 0.4); animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .badge {
    position: absolute; left: 6px; bottom: 6px; display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 7px; border-radius: 6px; font: 700 10.5px var(--font); background: rgb(0 0 0 / 0.7);
  }
  .badge.live { background: var(--player-accent); color: var(--on-accent); }
  .badge.live i { width: 2px; height: 8px; border-radius: 1px; background: currentColor; animation: eq 0.9s ease-in-out infinite; }
  .badge.live i:nth-child(2) { animation-delay: -0.3s; }
  .badge.live i:nth-child(3) { animation-delay: -0.6s; margin-right: 2px; }
  @keyframes eq { 50% { transform: scaleY(0.35); } }
  :global(:root[data-motion='reduce']) .badge.live i { animation: none; }
  .badge.seen { left: auto; right: 6px; top: 6px; bottom: auto; }
  .prog { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgb(255 255 255 / 0.25); }
  .prog i { display: block; height: 100%; background: var(--player-accent); }

  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; padding-top: 2px; }
  .code { display: flex; gap: 8px; align-items: baseline; font-size: 11.5px; font-weight: 700; letter-spacing: 0.04em; color: rgb(255 255 255 / 0.55); }
  .code em { font-style: normal; font-weight: 500; letter-spacing: 0; }
  .info b { font-size: 14px; font-weight: 600; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .info small { font-size: 12px; line-height: 1.4; color: rgb(255 255 255 / 0.55); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .none { padding: 20px 10px; color: rgb(255 255 255 / 0.6); font-size: 13px; }

  @media (max-width: 620px) { .thumb { width: 112px; } }
</style>
