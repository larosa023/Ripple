<script lang="ts">
  import { getCatalog } from '../stremio/client';
  import { backdropOf, logoOf } from '../stremio/images';
  import type { MetaPreview } from '../stremio/types';
  import type { BoardCatalog } from '../home';
  import { isSaved, toggleSaved } from '../stores/library.svelte';
  import { go } from '../stores/router.svelte';
  import { look } from '../theme/look.svelte';
  import Icon from './Icon.svelte';
  import { settings } from '../stores/settings.svelte';
  import { getMeta } from '../stremio/client';
  import { enabledAddons } from '../stores/addons.svelte';
  import { openTrailer, trailer, trailerIds } from '../trailer.svelte';

  let { source }: { source: BoardCatalog } = $props();

  const SLIDES = 6;
  let slides: MetaPreview[] = $state([]);
  let index = $state(0);
  let paused = $state(false);
  // Also hold the slideshow while it's scrolled out of view or the window is hidden, so it
  // never cross-fades (repainting the whole width) while you scroll the rows below.
  let offscreen = $state(false);
  let hidden = $state(typeof document !== 'undefined' && document.hidden);
  let el: HTMLElement | undefined = $state();
  $effect(() => {
    if (!el) return;
    const io = new IntersectionObserver(([e]) => (offscreen = !e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  });
  $effect(() => {
    const on = () => (hidden = document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  });
  let logoFailed: Record<string, boolean> = $state({});

  $effect(() => {
    const src = source;
    let live = true;
    index = 0;
    getCatalog(src.addon, src.catalog.type, src.catalog.id)
      .then((items) => {
        if (live) slides = items.filter((m) => m.poster || m.background).slice(0, SLIDES);
      })
      .catch(() => {
        if (live) slides = [];
      });
    return () => {
      live = false;
    };
  });

  $effect(() => {
    if (!look.heroInterval || paused || offscreen || hidden || tId || slides.length < 2) return;
    const t = setInterval(() => void advance(), look.heroInterval * 1000);
    return () => clearInterval(t);
  });

  // The next picture is fetched and decoded before the cross-fade starts, so the fade never
  // stalls on a half-loaded image.
  const ready = new Set<string>();
  function decode(url: string | undefined) {
    if (!url || ready.has(url)) return Promise.resolve();
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    return img.decode().then(
      () => void ready.add(url),
      () => void ready.add(url), // broken image: don't hold the slideshow up over it
    );
  }
  async function advance() {
    const want = (index + 1) % slides.length;
    await decode(backdropOf(slides[want], 'large'));
    if (want === (index + 1) % slides.length) index = want;
  }
  // ---------- banner trailers (optional, muted) ----------
  // A beat after a slide shows, its trailer fades in over the picture. The slideshow waits for
  // it to end; scrolling away, hiding the window or opening a trailer stops it.
  let tId = $state('');
  let tPlaying = $state(false);
  let muted = $state(true);
  let frame: HTMLIFrameElement | undefined = $state();
  const trailerIdsCache = new Map<string, string>();
  $effect(() => {
    const s = cur;
    tId = '';
    tPlaying = false;
    muted = true;
    if (!settings.heroTrailers || !s || look.reduceMotion || offscreen || hidden || trailer.id) return;
    let live = true;
    const t = setTimeout(async () => {
      let id = trailerIdsCache.get(s.id) ?? trailerIds(s as never)[0];
      if (!id) {
        try {
          id = trailerIds((await getMeta(enabledAddons(), s.type, s.id)) as never)[0];
        } catch {
          /* no details: keep the picture */
        }
      }
      trailerIdsCache.set(s.id, id ?? '');
      if (live && id) tId = id;
    }, 2500);
    // Never got going (blocked, region-locked…): give up and carry on with the pictures.
    const giveUp = setTimeout(() => live && !tPlaying && (tId = ''), 14000);
    return () => {
      live = false;
      clearTimeout(t);
      clearTimeout(giveUp);
    };
  });
  const tSrc = $derived(
    tId
      ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(tId)}?autoplay=1&mute=1&controls=0&disablekb=1&fs=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`
      : '',
  );
  function yt(func: string) {
    frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*');
  }
  $effect(() => {
    if (!tId) return;
    const onMsg = (e: MessageEvent) => {
      if (!/^https:\/\/(www\.)?youtube(-nocookie)?\.com$/.test(e.origin)) return;
      let d: { event?: string; info?: unknown } = {};
      try {
        d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      const state = d.event === 'onStateChange' ? d.info : (d.info as { playerState?: number } | undefined)?.playerState;
      if (state === 1) tPlaying = true;
      if (state === 0 || d.event === 'onError') {
        // Finished (or failed): back to the pictures, and move on.
        tId = '';
        tPlaying = false;
        if (state === 0 && slides.length > 1) void advance();
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  });
  function frameLoaded() {
    // Ask the player to tell us when it starts and ends.
    frame?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
  }
  function toggleSound() {
    muted = !muted;
    yt(muted ? 'mute' : 'unMute');
  }

  /** Only the current slide and the one fading out are drawn, not every slide at once. */
  let prev = $state(-1);
  let last = 0;
  $effect.pre(() => {
    const i = index;
    if (i !== last) {
      prev = last;
      last = i;
    }
  });
  const drawn = (i: number) => i === index || i === prev;

  const cur = $derived(slides[index]);
  // Warm up the next backdrop a little ahead of time.
  $effect(() => {
    const next = slides[(index + 1) % Math.max(slides.length, 1)];
    if (next) void decode(backdropOf(next, 'large'));
  });
</script>

{#if slides.length}
  <section
    bind:this={el}
    class="hero {look.hero}"
    onmouseenter={() => (paused = true)}
    onmouseleave={() => (paused = false)}
    aria-label="Featured"
    aria-roledescription="carousel"
  >
    <div class="bgs">
      {#each slides as s, i (s.id)}
        {#if drawn(i)}
          <div class="bg" class:on={i === index} style:background-image={`url("${backdropOf(s, 'large')}")`}></div>
        {/if}
      {/each}
      {#if tSrc}
        <iframe
          class="tframe"
          class:on={tPlaying}
          bind:this={frame}
          src={tSrc}
          title="Trailer"
          tabindex="-1"
          allow="autoplay; encrypted-media"
          referrerpolicy="strict-origin-when-cross-origin"
          onload={frameLoaded}
        ></iframe>
      {/if}
    </div>
    <div class="shade"></div>
    {#if tPlaying}
      <div class="tctl">
        <button class="tbtn" onclick={toggleSound} aria-label={muted ? 'Turn sound on' : 'Mute'} title={muted ? 'Sound on' : 'Mute'}>
          <Icon name={muted ? 'mute' : 'volume'} size={17} />
        </button>
        <button class="tbtn" onclick={() => { const id = trailerIdsCache.get(cur!.id) ?? ''; tId = ''; if (id) openTrailer(id, cur!.name); }} aria-label="Watch the trailer with sound" title="Watch full screen">
          <Icon name="expand" size={16} />
        </button>
      </div>
    {/if}

    {#if cur}
      {#key cur.id}
        <div class="content">
          {#if logoOf(cur) && !logoFailed[cur.id]}
            <img class="logo" src={logoOf(cur)} alt={cur.name} onerror={() => (logoFailed[cur.id] = true)} />
          {:else}
            <h1>{cur.name}</h1>
          {/if}
          <div class="facts">
            {#if cur.imdbRating}<span class="rating"><Icon name="star" size={13} fill />{cur.imdbRating}</span>{/if}
            {#if cur.releaseInfo}<span>{cur.releaseInfo}</span>{/if}
            {#if cur.genres?.length}<span>{cur.genres.slice(0, 3).join(' · ')}</span>{/if}
          </div>
          {#if cur.description && look.hero === 'full'}<p>{cur.description}</p>{/if}
          <div class="actions">
            <button class="btn primary lg" onclick={() => go('detail', [cur.type, cur.id])}>
              <Icon name="play" size={16} fill />Watch
            </button>
            <button class="btn glass lg" onclick={() => toggleSaved(cur)}>
              <Icon name={isSaved(cur.id) ? 'check' : 'plus'} size={16} />{isSaved(cur.id) ? 'In library' : 'Library'}
            </button>
          </div>
        </div>
      {/key}
    {/if}

    {#if slides.length > 1}
      <div class="dots">
        {#each slides as s, i (s.id)}
          <button class:on={i === index} aria-label={`Show ${s.name}`} onclick={() => (index = i)}></button>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .hero {
    position: relative; overflow: hidden; color: #fff;
    margin: -28px calc(-1 * var(--page-pad)) var(--row-gap);
    height: min(64vh, 600px); min-height: 360px;
  }
  .hero.compact { height: 300px; min-height: 0; margin: 0 0 var(--row-gap); border-radius: calc(var(--radius) * 1.6); }
  /* The incoming slide sits underneath at full strength and slowly settles from a slight zoom;
     the outgoing one stays on top and fades away, so only two layers ever exist. */
  .bgs { position: absolute; inset: 0; isolation: isolate; overflow: hidden; }
  .bg {
    position: absolute; inset: 0; background-size: cover; background-position: center 20%;
    z-index: 1; opacity: 0; transition: opacity 900ms ease;
  }
  .bg.on { z-index: 0; opacity: 1; animation: settle 8s ease-out both; transition: none; }
  /* Trailer: covers the banner (cropping YouTube's edges), fades in once it's actually playing. */
  .bgs { container-type: size; }
  .tframe {
    position: absolute; top: 50%; left: 50%; z-index: 2; border: 0; pointer-events: none;
    width: max(100cqw, 177.78cqh); height: max(100cqh, 56.25cqw);
    transform: translate(-50%, -50%) scale(1.18); opacity: 0; transition: opacity 1.2s ease;
  }
  .tframe.on { opacity: 1; }
  .tctl { position: absolute; right: var(--page-pad); bottom: 22%; z-index: 3; display: flex; gap: 8px; animation: rise 400ms var(--ease) both; }
  .tbtn {
    width: 40px; height: 40px; display: grid; place-items: center; border-radius: 50%; cursor: pointer;
    border: 1.5px solid rgb(255 255 255 / 0.55); background: rgb(0 0 0 / 0.35); color: #fff; backdrop-filter: blur(8px);
    transition: background var(--dur), border-color var(--dur);
  }
  .tbtn:hover { background: rgb(255 255 255 / 0.18); border-color: #fff; }
  @keyframes settle { from { transform: scale(1.04); } }
  :global(:root[data-motion='reduce']) .bg.on { animation: none; }
  .shade {
    position: absolute; inset: 0;
    background:
      linear-gradient(90deg, rgb(0 0 0 / 0.78) 0%, rgb(0 0 0 / 0.35) 50%, transparent 75%),
      linear-gradient(0deg, var(--bg) 0%, transparent 38%);
  }
  .compact .shade { background: linear-gradient(90deg, rgb(0 0 0 / 0.8) 0%, rgb(0 0 0 / 0.3) 60%, transparent); }
  .content {
    position: absolute; left: var(--page-pad); bottom: 18%; max-width: min(560px, 60%);
    animation: rise 520ms var(--ease) both;
  }
  .compact .content { bottom: 30px; left: 34px; }
  @keyframes rise { from { opacity: 0; transform: translateY(12px); } }
  :global(:root[data-motion='reduce']) .content { animation: none; }
  .logo { max-width: 380px; max-height: 130px; object-fit: contain; object-position: left bottom; margin-bottom: 14px; filter: drop-shadow(0 4px 18px rgb(0 0 0 / 0.5)); }
  .compact .logo { max-height: 80px; max-width: 280px; }
  h1 { font-size: 46px; line-height: 1.02; margin: 0 0 12px; letter-spacing: -0.03em; text-shadow: 0 4px 24px rgb(0 0 0 / 0.5); }
  .compact h1 { font-size: 32px; }
  .facts { display: flex; gap: 14px; font-weight: 600; font-size: 13.5px; color: rgb(255 255 255 / 0.85); margin-bottom: 10px; }
  .rating { display: inline-flex; gap: 4px; align-items: center; color: #ffd25e; }
  p {
    margin: 0 0 18px; line-height: 1.55; color: rgb(255 255 255 / 0.85); font-size: 14.5px;
    display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  }
  .actions { display: flex; gap: 10px; }
  .dots { position: absolute; right: var(--page-pad); bottom: 20%; display: flex; gap: 7px; }
  .compact .dots { bottom: 30px; right: 30px; }
  .dots button {
    width: 8px; height: 8px; padding: 0; border: 0; border-radius: 4px; background: rgb(255 255 255 / 0.4);
    cursor: pointer; transition: width var(--dur), background var(--dur);
  }
  .dots button.on { width: 26px; background: #fff; }
</style>
