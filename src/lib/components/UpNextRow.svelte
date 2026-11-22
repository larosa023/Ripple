<script lang="ts">
  // "Up Next": the next unwatched episode of each show you're following, one click to play.
  import Icon from './Icon.svelte';
  import { dragScroll } from '../actions/dragScroll';
  import { look } from '../theme/look.svelte';
  import { href } from '../stores/router.svelte';
  import { backdropOf } from '../stremio/images';
  import { epCode, playVideo } from '../watch';
  import { downloadedCopy } from '../downloads.svelte';
  import type { UpNextItem } from '../upnext.svelte';

  let { items }: { items: UpNextItem[] } = $props();
  let scroller: HTMLDivElement | undefined = $state();
  let starting = $state('');

  async function play(it: UpNextItem) {
    if (starting) return;
    starting = it.video.id;
    try {
      await playVideo(it.meta, it.video);
    } finally {
      starting = '';
    }
  }
  function scroll(dir: 1 | -1) {
    scroller?.scrollBy({ left: dir * (scroller?.clientWidth ?? 0) * 0.85, behavior: look.reduceMotion ? 'auto' : 'smooth' });
  }
</script>

{#if items.length}
  <section class="un">
    <header>
      <h2>Up next</h2>
      <div class="nav">
        <button class="icon-btn" onclick={() => scroll(-1)} aria-label="Scroll left"><Icon name="chevronLeft" /></button>
        <button class="icon-btn" onclick={() => scroll(1)} aria-label="Scroll right"><Icon name="chevronRight" /></button>
      </div>
    </header>
    <div class="scroller" use:dragScroll bind:this={scroller}>
      {#each items as it (it.video.id)}
        {@const thumb = it.video.thumbnail || backdropOf(it.meta, 'small')}
        <div class="card">
          <button class="art" onclick={() => play(it)} style:background-image={thumb ? `url("${thumb}")` : undefined} aria-label="Play {it.meta.name} {epCode(it.video)}">
            <span class="shade"></span>
            {#if it.meta.logo}
              <img class="logo" src={it.meta.logo} alt="" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
            {/if}
            <span class="badges">
              {#if it.fresh}<em class="new">New</em>{/if}
              {#if downloadedCopy(it.video.id)}<em class="dl"><Icon name="download" size={11} stroke={2.6} />Downloaded</em>{/if}
            </span>
            <span class="go" class:busy={starting === it.video.id}>
              {#if starting === it.video.id}<i class="spin"></i>{:else}<Icon name="play" size={18} fill />{/if}
            </span>
          </button>
          <a class="txt" href={href('detail', 'series', it.meta.id)}>
            <b>{it.meta.name}</b>
            <span>{[epCode(it.video), it.video.title || it.video.name].filter(Boolean).join(' · ')}</span>
          </a>
        </div>
      {/each}
    </div>
  </section>
{/if}

<style>
  .un { margin-bottom: var(--row-gap); }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  h2 { font-size: 18px; font-weight: 700; margin: 0; }
  .nav { display: flex; gap: 2px; }
  .card { flex-shrink: 0; width: clamp(240px, 22vw, 320px); display: flex; flex-direction: column; gap: 8px; }
  .art {
    position: relative; aspect-ratio: 16 / 9; border: 0; padding: 0; cursor: pointer; overflow: hidden;
    border-radius: var(--radius, 12px); background: var(--bg-3) center / cover;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--text) 6%, transparent) inset;
    transition: transform var(--dur), box-shadow var(--dur);
  }
  .art:hover, .art:focus-visible { transform: translateY(-2px); box-shadow: 0 0 0 2px var(--accent); }
  .shade { position: absolute; inset: 0; background: linear-gradient(180deg, transparent 40%, rgb(0 0 0 / 0.65)); }
  .logo { position: absolute; left: 12px; bottom: 10px; max-width: 55%; max-height: 38%; object-fit: contain; object-position: left bottom; filter: drop-shadow(0 2px 8px rgb(0 0 0 / 0.6)); }
  .badges { position: absolute; top: 8px; left: 8px; display: flex; gap: 5px; }
  .badges em { display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; border-radius: 6px; font: 800 10.5px var(--font); font-style: normal; letter-spacing: 0.04em; text-transform: uppercase; }
  .new { background: var(--accent); color: var(--on-accent); }
  .dl { background: rgb(0 0 0 / 0.72); color: #fff; }
  .go {
    position: absolute; right: 10px; bottom: 10px; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center;
    background: #fff; color: #000; box-shadow: 0 4px 16px rgb(0 0 0 / 0.4);
    opacity: 0; transform: scale(0.85); transition: opacity var(--dur), transform var(--dur);
  }
  .art:hover .go, .art:focus-visible .go, .go.busy { opacity: 1; transform: none; }
  .spin { width: 16px; height: 16px; border-radius: 50%; border: 2.5px solid rgb(0 0 0 / 0.2); border-top-color: #000; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; color: inherit; text-decoration: none; padding: 0 2px; }
  .txt b { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .txt span { font-size: 12.5px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .txt:hover b { text-decoration: underline; }
</style>
