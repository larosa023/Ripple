<script lang="ts">
  import { look } from '../theme/look.svelte';
</script>

{#if look.bgImage || look.bgAnimation !== 'none'}
  <div class="backdrop" aria-hidden="true">
    {#if look.bgImage}
      <div
        class="img"
        style:background-image={`url("${look.bgImage.replace(/"/g, '%22')}")`}
        style:filter={look.bgBlur ? `blur(${look.bgBlur}px)` : undefined}
        style:inset={look.bgBlur ? `-${look.bgBlur * 2}px` : '0'}
      ></div>
    {/if}
    {#if look.bgAnimation === 'aurora'}
      <div class="aurora"><span></span><span></span><span></span></div>
    {:else if look.bgAnimation === 'bokeh'}
      <div class="bokeh">
        {#each Array(14) as _, i (i)}<span style:--i={i}></span>{/each}
      </div>
    {/if}
    <div class="dim" style:opacity={look.bgImage ? look.bgDim : 0.35}></div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; contain: strict; }
  .img { position: absolute; background-size: cover; background-position: center; }
  .dim { position: absolute; inset: 0; background: var(--bg); }

  /* Soft glows drawn with gradients (no blur filter) and moved with transforms only, so the GPU
     composites them cheaply and nothing behind or in front has to re-render each frame. */
  .aurora { position: absolute; inset: 0; }
  .aurora span {
    position: absolute; width: 90vmax; height: 90vmax; border-radius: 50%; opacity: 0.32;
    background: radial-gradient(closest-side, var(--accent), transparent);
    animation: drift 30s ease-in-out infinite alternate; will-change: transform;
  }
  .aurora span:nth-child(1) { top: -45vmax; left: -30vmax; }
  .aurora span:nth-child(2) {
    bottom: -50vmax; right: -35vmax; animation-duration: 36s; animation-delay: -10s;
    background: radial-gradient(closest-side, color-mix(in srgb, var(--accent) 55%, #7a3cff), transparent);
  }
  .aurora span:nth-child(3) {
    top: 15%; left: 30%; width: 60vmax; height: 60vmax; animation-duration: 42s; opacity: 0.18;
    background: radial-gradient(closest-side, color-mix(in srgb, var(--accent) 45%, #00d4ff), transparent);
  }
  @keyframes drift {
    to { transform: translate3d(10vmax, 7vmax, 0) scale(1.12); }
  }

  .bokeh span {
    --size: calc(40px + (var(--i) * 13px) % 120px);
    position: absolute; width: var(--size); height: var(--size); border-radius: 50%;
    left: calc((var(--i) * 37%) % 100%); top: calc((var(--i) * 53%) % 100%);
    background: radial-gradient(circle, color-mix(in srgb, var(--accent) 70%, transparent), transparent 70%);
    opacity: 0.4; animation: float 18s ease-in-out infinite alternate; will-change: transform, opacity;
    animation-delay: calc(var(--i) * -1.7s);
  }
  @keyframes float {
    to { transform: translate3d(40px, -60px, 0); opacity: 0.15; }
  }
  :global(:root[data-motion='reduce']) .aurora span,
  :global(:root[data-motion='reduce']) .bokeh span { animation: none; }
</style>
