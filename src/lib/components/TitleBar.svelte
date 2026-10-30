<script lang="ts">
  // Ripple's own title bar: transparent so it blends into whatever theme or
  // background is active, draggable, double-click to maximize (Tauri handles
  // both via data-tauri-drag-region), with themed window buttons.
  import WindowControls from './WindowControls.svelte';
</script>

<div class="titlebar" data-tauri-drag-region>
  <div class="drag" data-tauri-drag-region></div>
  <WindowControls />
</div>

<style>
  .titlebar {
    position: relative; z-index: 30; display: flex; align-items: stretch; height: 32px; flex-shrink: 0;
    background: transparent; user-select: none;
  }
  .drag { flex: 1; }
</style>
