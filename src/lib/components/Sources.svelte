<script lang="ts">
  // Full-page source picker (opened by Play or an episode): artwork + logo on
  // the left, every addon's streams on the right, grouped by addon.
  import { backdropOf, logoOf } from '../stremio/images';
  import type { MetaDetail, Video } from '../stremio/types';
  import { playback } from '../stores/playback.svelte';
  import Icon from './Icon.svelte';
  import StreamList from './StreamList.svelte';

  let {
    meta,
    videoId,
    label,
    episode,
    onclose,
  }: { meta: MetaDetail; videoId: string; label: string; episode?: Video; onclose: () => void } = $props();

  let logoFailed = $state(false);
  const art = $derived(episode?.thumbnail || backdropOf(meta, 'large'));

  // Mouse Back closes the source list (like Esc) instead of leaving the title page.
  $effect(() => {
    const onMouseNav = (e: Event) => {
      if ((playback.active && !playback.mini) || (e as CustomEvent).detail !== 'back') return;
      e.preventDefault();
      onclose();
    };
    window.addEventListener('ripple:mouse-nav', onMouseNav);
    return () => window.removeEventListener('ripple:mouse-nav', onMouseNav);
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && !(playback.active && !playback.mini)) {
      e.preventDefault();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="sources" role="dialog" aria-label="Choose a source">
  {#if art}<div class="bg" style:background-image={`url("${art}")`}></div>{/if}
  <div class="shade"></div>

  <button class="back" onclick={onclose} aria-label="Back" title="Back (Esc)"><Icon name="back" size={20} /></button>

  <div class="left">
    {#if logoOf(meta) && !logoFailed}
      <img class="logo" src={logoOf(meta)} alt={meta.name} onerror={() => (logoFailed = true)} />
    {:else}
      <h1>{meta.name}</h1>
    {/if}
    {#if label}
      <div class="ep">{label}</div>
      {#if episode?.overview ?? episode?.description}<p>{episode?.overview ?? episode?.description}</p>{/if}
    {/if}
  </div>

  <div class="right">
    {#key videoId}<StreamList {meta} {videoId} {label} />{/key}
  </div>
</div>

<style>
  .sources {
    position: absolute; inset: 0; z-index: 5; display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(420px, 1.2fr);
    background: var(--bg); animation: in 220ms var(--ease);
  }
  @keyframes in { from { opacity: 0; } }
  :global(:root[data-motion='reduce']) .sources { animation: none; }
  .bg { position: absolute; inset: 0; background-size: cover; background-position: center; opacity: 0.55; }
  .shade {
    position: absolute; inset: 0;
    background:
      linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--bg) 55%, transparent) 38%, color-mix(in srgb, var(--bg) 92%, transparent) 52%),
      linear-gradient(0deg, color-mix(in srgb, var(--bg) 70%, transparent), transparent 40%);
  }
  .back {
    position: absolute; top: 18px; left: 22px; z-index: 2; width: 42px; height: 42px; display: grid; place-items: center;
    border: 0; border-radius: 50%; cursor: pointer; color: #fff; background: rgb(0 0 0 / 0.4); backdrop-filter: blur(8px);
    transition: background var(--dur);
  }
  .back:hover { background: rgb(0 0 0 / 0.65); }
  .left {
    position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
    padding: 80px 40px; color: #fff; min-width: 0;
  }
  .logo { max-width: min(80%, 460px); max-height: 180px; object-fit: contain; filter: drop-shadow(0 8px 30px rgb(0 0 0 / 0.6)); }
  h1 { font-size: 44px; margin: 0; letter-spacing: -0.02em; line-height: 1.05; text-shadow: 0 4px 24px rgb(0 0 0 / 0.6); }
  .ep { margin-top: 18px; font-weight: 700; font-size: 16px; text-shadow: 0 2px 10px rgb(0 0 0 / 0.7); }
  .left p {
    margin: 8px 0 0; max-width: 46ch; font-size: 13.5px; line-height: 1.55; color: rgb(255 255 255 / 0.82); text-shadow: 0 1px 8px rgb(0 0 0 / 0.8);
    display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
  }
  .right { position: relative; min-width: 0; min-height: 0; padding: 22px 26px 0 8px; display: flex; flex-direction: column; }
  @media (max-width: 1000px) {
    .sources { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
    .left { padding: 70px 30px 10px; }
    .logo { max-height: 90px; }
    .left p { display: none; }
    .right { padding: 10px 20px 0; }
  }
</style>
