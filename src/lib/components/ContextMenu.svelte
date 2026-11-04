<script lang="ts">
  // Right-click menu for posters and episodes. Stays inside the window and closes on any
  // outside click, Esc, scroll, or when the window loses focus.
  import Icon from './Icon.svelte';
  import { closeMenu, contextMenu } from '../stores/ui.svelte';

  let el: HTMLDivElement | undefined = $state();
  let pos = $state({ x: 0, y: 0 });

  $effect(() => {
    if (!contextMenu.open || !el) return;
    const r = el.getBoundingClientRect();
    const z = parseFloat(document.body.style.zoom) || 1;
    const vw = window.innerWidth / z;
    const vh = window.innerHeight / z;
    const x = contextMenu.x / z;
    const y = contextMenu.y / z;
    pos = { x: Math.max(6, Math.min(x, vw - r.width - 6)), y: Math.max(6, Math.min(y, vh - r.height - 6)) };
    el.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  });

  function onKey(e: KeyboardEvent) {
    if (!contextMenu.open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeMenu();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...(el?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }
  }
</script>

<svelte:window
  onkeydowncapture={onKey}
  onpointerdowncapture={(e) => contextMenu.open && el && !el.contains(e.target as Node) && closeMenu()}
  onblur={closeMenu}
  onresize={closeMenu}
  onwheelcapture={() => contextMenu.open && closeMenu()}
/>

{#if contextMenu.open}
  <div class="cm" role="menu" tabindex="-1" bind:this={el} style:left="{pos.x}px" style:top="{pos.y}px" oncontextmenu={(e) => e.preventDefault()}>
    {#if contextMenu.title}<div class="head">{contextMenu.title}</div>{/if}
    {#each contextMenu.items as item, i (i)}
      <button role="menuitem" class:danger={item.danger} onclick={() => { closeMenu(); item.run(); }}>
        {#if item.icon}<Icon name={item.icon} size={15} />{/if}{item.label}
      </button>
    {/each}
  </div>
{/if}

<style>
  .cm {
    position: fixed; z-index: 120; min-width: 210px; max-width: 300px; padding: 5px; border-radius: 12px;
    background: var(--bg-2); border: 1px solid var(--line); box-shadow: 0 16px 44px rgb(0 0 0 / 0.45);
    animation: pop 110ms var(--ease);
  }
  @keyframes pop { from { opacity: 0; transform: scale(0.97); } }
  :global(:root[data-motion='reduce']) .cm { animation: none; }
  .head { padding: 6px 10px 6px; font-size: 11.5px; font-weight: 700; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: 1px solid var(--line); margin-bottom: 4px; }
  button {
    display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: 0; border-radius: 8px;
    background: none; color: var(--text); font: 500 13px var(--font); text-align: left; cursor: pointer;
  }
  button:hover, button:focus-visible { background: var(--bg-3); outline: none; }
  button :global(svg) { color: var(--text-2); flex-shrink: 0; }
  .danger { color: var(--danger); }
  .danger :global(svg) { color: var(--danger); }
</style>
