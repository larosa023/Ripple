<script lang="ts">
  let { checked = $bindable(false), label = '', onchange }: { checked?: boolean; label?: string; onchange?: (v: boolean) => void } =
    $props();
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  class="switch"
  class:on={checked}
  onclick={() => {
    checked = !checked;
    onchange?.(checked);
  }}
><span></span></button>

<style>
  .switch {
    position: relative; width: 42px; height: 24px; flex-shrink: 0; padding: 0; cursor: pointer;
    border-radius: 12px; border: 1px solid var(--line); background: var(--bg-3);
    transition: background var(--dur), border-color var(--dur);
  }
  .switch span {
    position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%;
    background: var(--text-2); transition: transform var(--dur) var(--ease), background var(--dur);
  }
  .switch.on { background: var(--accent); border-color: transparent; }
  .switch.on span { transform: translateX(18px); background: var(--on-accent); }
  .switch:hover:not(.on) { border-color: var(--text-3); }
</style>
