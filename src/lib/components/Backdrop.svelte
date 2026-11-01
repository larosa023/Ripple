<script lang="ts">
  // Animated backgrounds are drawn on a tiny canvas (about 1/8 of the window)
  // that the GPU stretches to full size. Soft glows look identical at that
  // resolution, and each frame costs a few thousand pixels instead of millions.
  // The animation runs at ~12 fps and pauses while scrolling, during playback,
  // and when the window is hidden, so it never competes with the UI.
  import { look } from '../theme/look.svelte';

  let canvas: HTMLCanvasElement | undefined = $state();

  function mix(hex: string, other: string, t: number): [number, number, number] {
    const p = (h: string) => {
      const n = parseInt(h.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const a = p(hex);
    const b = p(other);
    return [0, 1, 2].map((i) => Math.round(a[i] * (1 - t) + b[i] * t)) as [number, number, number];
  }

  $effect(() => {
    const cv = canvas;
    const kind = look.bgAnimation;
    const accent = look.colors.accent || '#5b8cff';
    const still = look.reduceMotion;
    if (!cv || kind === 'none') return;
    const ctx = cv.getContext('2d', { alpha: true });
    if (!ctx) return;

    const SCALE = kind === 'bokeh' ? 0.25 : 0.125;
    const size = () => {
      cv.width = Math.max(32, Math.round(window.innerWidth * SCALE));
      cv.height = Math.max(20, Math.round(window.innerHeight * SCALE));
    };
    size();

    const c1 = mix(accent, accent, 0);
    const c2 = mix(accent, '#7a3cff', 0.45);
    const c3 = mix(accent, '#00d4ff', 0.55);
    const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

    function glow(x: number, y: number, r: number, c: number[], a: number) {
      const g = ctx!.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(c, a));
      g.addColorStop(1, rgba(c, 0));
      ctx!.fillStyle = g;
      ctx!.fillRect(x - r, y - r, r * 2, r * 2);
    }

    function draw(t: number) {
      const w = cv!.width;
      const h = cv!.height;
      const m = Math.max(w, h);
      ctx!.clearRect(0, 0, w, h);
      if (kind === 'aurora') {
        // Three slow drifting glows (periods 30s / 36s / 42s), like the old CSS version.
        const e = (period: number, phase = 0) => (1 - Math.cos(((t / 1000 + phase) / period) * Math.PI * 2)) / 2;
        const a1 = e(60);
        const a2 = e(72, 10);
        const a3 = e(84);
        glow(-0.3 * m + 0.45 * m + a1 * 0.1 * m, -0.45 * m + 0.45 * m + a1 * 0.07 * m, 0.45 * m * (1 + 0.12 * a1), c1, 0.32);
        glow(w + 0.35 * m - 0.45 * m + a2 * 0.1 * m, h + 0.5 * m - 0.45 * m + a2 * 0.07 * m, 0.45 * m * (1 + 0.12 * a2), c2, 0.32);
        glow(w * 0.3 + 0.3 * m + a3 * 0.1 * m, h * 0.15 + 0.3 * m + a3 * 0.07 * m, 0.3 * m * (1 + 0.12 * a3), c3, 0.18);
      } else {
        for (let i = 0; i < 14; i++) {
          const r = ((40 + ((i * 13) % 120)) / 2) * SCALE;
          const p = (1 - Math.cos(((t / 1000 + i * 1.7) / 36) * Math.PI * 2)) / 2;
          const x = (((i * 37) % 100) / 100) * w + r + p * 40 * SCALE;
          const y = (((i * 53) % 100) / 100) * h + r - p * 60 * SCALE;
          glow(x, y, r, c1, 0.4 - 0.25 * p);
        }
      }
    }

    let raf = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    let scrolling = 0;
    const onScroll = () => (scrolling = performance.now());
    const paused = () =>
      document.hidden ||
      (document.documentElement.classList.contains('playing') && !document.documentElement.classList.contains('mini'));

    // A timer (not a per-vsync loop) so the page sleeps between frames: ~12 fps is plenty for glows
    // that drift a few pixels a second. Skips frames while scrolling, playing or hidden.
    function tick() {
      if (performance.now() - scrolling < 250 || paused()) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    }

    draw(performance.now());
    if (!still) timer = setInterval(tick, 83);
    const onResize = () => {
      size();
      draw(performance.now());
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('wheel', onScroll, { capture: true, passive: true });
    window.addEventListener('pointermove', onPointer, { capture: true, passive: true });
    function onPointer(e: PointerEvent) {
      if (e.buttons) onScroll(); // dragging a row
    }
    return () => {
      clearInterval(timer);
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('wheel', onScroll, { capture: true });
      window.removeEventListener('pointermove', onPointer, { capture: true });
    };
  });
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
    {#if look.bgAnimation !== 'none'}
      <canvas class="anim" bind:this={canvas}></canvas>
    {/if}
    <div class="dim" style:opacity={look.bgImage ? look.bgDim : 0.35}></div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; contain: strict; }
  .img { position: absolute; background-size: cover; background-position: center; }
  .dim { position: absolute; inset: 0; background: var(--bg); }
  .anim { position: absolute; inset: 0; width: 100%; height: 100%; }
</style>
