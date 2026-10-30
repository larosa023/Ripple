<script lang="ts">
  // Ripple's own title bar: transparent so it blends into whatever theme or
  // background is active, draggable, double-click to maximize (Tauri handles
  // both via data-tauri-drag-region), with themed window buttons.
  import { look } from '../theme/look.svelte';
  import WindowControls from './WindowControls.svelte';

  // The sidebar layout already shows the logo and name at its top.
  const showBrand = $derived(look.nav !== 'sidebar');
</script>

<div class="titlebar" data-tauri-drag-region>
  <div class="drag" data-tauri-drag-region>
    {#if showBrand}
      <div class="brand" data-tauri-drag-region>
        <svg viewBox="0 0 32 32" width="16" height="16" aria-hidden="true">
          <circle cx="16" cy="16" r="4.5" fill="var(--accent)" />
          <circle cx="16" cy="16" r="9.5" fill="none" stroke="var(--accent)" stroke-width="2.6" opacity="0.65" />
          <circle cx="16" cy="16" r="14.5" fill="none" stroke="var(--accent)" stroke-width="2.6" opacity="0.32" />
        </svg>
        <span>Ripple</span>
      </div>
    {/if}
  </div>
  <WindowControls />
</div>

<style>
  .titlebar {
    position: relative; z-index: 30; display: flex; align-items: stretch; height: 32px; flex-shrink: 0;
    background: transparent; user-select: none;
  }
  .drag { flex: 1; display: flex; align-items: center; padding-left: var(--page-pad); }
  .brand { display: flex; align-items: center; gap: 8px; color: var(--text-2); }
  /* Clicks on the logo and name still drag the window. */
  .brand > * { pointer-events: none; }
  .brand span { font-family: var(--font-display); font-size: 13px; font-weight: 700; letter-spacing: 0.01em; }
</style>
