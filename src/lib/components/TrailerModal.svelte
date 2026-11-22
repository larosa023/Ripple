<script lang="ts">
  // In-app trailer player (YouTube embed), opened from title pages and the Home banner.
  import Icon from './Icon.svelte';
  import { closeTrailer, trailer } from '../trailer.svelte';
  import { openExternal } from '../player';

  const src = $derived(
    trailer.id
      ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailer.id)}?autoplay=1&rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(location.origin)}`
      : '',
  );
  function onKey(e: KeyboardEvent) {
    if (trailer.id && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeTrailer();
    }
  }
</script>

<svelte:window onkeydowncapture={onKey} />

{#if trailer.id}
  <div class="tm" role="dialog" aria-modal="true" aria-label={trailer.title || 'Trailer'} onclick={closeTrailer} onkeydown={() => {}} tabindex="-1">
    <div class="box" onclick={(e) => e.stopPropagation()} onkeydown={() => {}} role="presentation">
      <header>
        <b>{trailer.title || 'Trailer'}</b>
        <button class="btn ghost sm" onclick={() => openExternal(`https://www.youtube.com/watch?v=${trailer.id}`)}><Icon name="external" size={14} />Watch on YouTube</button>
        <button class="x" onclick={closeTrailer} aria-label="Close trailer" title="Close (Esc)"><Icon name="x" size={18} /></button>
      </header>
      <div class="frame">
        <iframe
          {src}
          title={trailer.title || 'Trailer'}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowfullscreen
          referrerpolicy="strict-origin-when-cross-origin"
        ></iframe>
      </div>
    </div>
  </div>
{/if}

<style>
  .tm {
    position: fixed; inset: 0; z-index: 140; display: grid; place-items: center; padding: 40px;
    background: rgb(0 0 0 / 0.78); backdrop-filter: blur(6px); animation: fade var(--dur) ease;
  }
  @keyframes fade { from { opacity: 0; } }
  .box { width: min(1200px, 100%); display: flex; flex-direction: column; gap: 10px; animation: rise calc(var(--dur) + 100ms) cubic-bezier(0.2, 0.8, 0.2, 1); }
  @keyframes rise { from { transform: translateY(10px) scale(0.98); opacity: 0; } }
  header { display: flex; align-items: center; gap: 10px; color: #fff; }
  header b { flex: 1; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .x { width: 36px; height: 36px; display: grid; place-items: center; border: 0; border-radius: 50%; background: rgb(255 255 255 / 0.12); color: #fff; cursor: pointer; }
  .x:hover { background: rgb(255 255 255 / 0.22); }
  .frame { position: relative; aspect-ratio: 16 / 9; border-radius: 14px; overflow: hidden; background: #000; box-shadow: 0 30px 90px rgb(0 0 0 / 0.6); }
  iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
</style>
