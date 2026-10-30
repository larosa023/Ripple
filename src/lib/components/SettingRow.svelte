<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    description = '',
    wide = false,
    children,
  }: {
    title: string;
    description?: string;
    /** Controls that need the full width (text inputs) go under the label. */
    wide?: boolean;
    children?: Snippet;
  } = $props();
</script>

<div class="srow" class:wide>
  <div class="text">
    <div class="title">{title}</div>
    {#if description}<div class="desc">{description}</div>{/if}
  </div>
  {#if children}<div class="control">{@render children()}</div>{/if}
</div>

<style>
  .srow {
    display: flex; align-items: center; justify-content: space-between; gap: 24px;
    padding: 14px 18px; min-height: 64px;
  }
  .srow + :global(.srow) { border-top: 1px solid var(--line); }
  .text { min-width: 0; flex: 1; }
  .title { font-weight: 600; font-size: 14px; }
  .desc { font-size: 12.5px; color: var(--text-2); margin-top: 2px; line-height: 1.45; }
  .control { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .wide { flex-direction: column; align-items: stretch; gap: 10px; }
  .wide .control { flex-shrink: 1; flex-direction: column; align-items: stretch; }
  @media (max-width: 720px) {
    .srow { flex-direction: column; align-items: stretch; gap: 10px; }
  }
</style>
