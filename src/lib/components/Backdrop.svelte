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
  .backdrop { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  .img { position: absolute; background-size: cover; background-position: center; }
  .dim { position: absolute; inset: 0; background: var(--bg); }

  .aurora span {
    position: absolute; width: 60vmax; height: 60vmax; border-radius: 50%; filter: blur(90px); opacity: 0.35;
    background: var(--accent); animation: drift 26s ease-in-out infinite alternate;
  }
  .aurora span:nth-child(1) { top: -25vmax; left: -15vmax; }
  .aurora span:nth-child(2) {
    bottom: -30vmax; right: -20vmax; animation-duration: 32s; animation-delay: -8s;
    background: color-mix(in srgb, var(--accent) 50%, #7a3cff);
  }
  .aurora span:nth-child(3) {
    top: 30%; left: 40%; width: 40vmax; height: 40vmax; animation-duration: 38s; opacity: 0.2;
    background: color-mix(in srgb, var(--accent) 40%, #00d4ff);
  }
  @keyframes drift {
    to { transform: translate(12vmax, 8vmax) scale(1.15); }
  }

  .bokeh span {
    --size: calc(40px + (var(--i) * 13px) % 120px);
    position: absolute; width: var(--size); height: var(--size); border-radius: 50%;
    left: calc((var(--i) * 37%) % 100%); top: calc((var(--i) * 53%) % 100%);
    background: radial-gradient(circle, color-mix(in srgb, var(--accent) 70%, transparent), transparent 70%);
    opacity: 0.4; animation: float 18s ease-in-out infinite alternate;
    animation-delay: calc(var(--i) * -1.7s);
  }
  @keyframes float {
    to { transform: translate(40px, -60px); opacity: 0.15; }
  }
  :global(:root[data-motion='reduce']) .aurora span,
  :global(:root[data-motion='reduce']) .bokeh span { animation: none; }
</style>
