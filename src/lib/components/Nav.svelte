<script lang="ts" module>
  export const NAV_META: Record<string, { label: string; icon: string }> = {
    home: { label: 'Home', icon: 'home' },
    discover: { label: 'Discover', icon: 'compass' },
    search: { label: 'Search', icon: 'search' },
    library: { label: 'Library', icon: 'library' },
    addons: { label: 'Addons', icon: 'puzzle' },
  };
</script>

<script lang="ts">
  import Icon from './Icon.svelte';
  import WindowControls from './WindowControls.svelte';
  import { isTauri } from '../stremio/http';
  import { settings } from '../stores/settings.svelte';
  import { href, router, type RouteName } from '../stores/router.svelte';
  import { look } from '../theme/look.svelte';
  import { openStudio, ui } from '../stores/ui.svelte';

  const items = $derived(look.navItems.filter((n) => n.visible));
  const labels = $derived(look.nav === 'sidebar' || look.nav === 'rail' || look.nav === 'top');
  const active = (name: RouteName) => router.route.name === name;
  const customChrome = $derived(isTauri && !settings.nativeTitleBar);
  const iconSize = $derived(look.nav === 'top' ? 18 : look.nav === 'dock' ? 23 : 21);
  const iconStroke = $derived(look.nav === 'dock' ? 2.2 : 1.8);
</script>

<nav class="nav {look.nav}" class:chrome={customChrome && look.nav === 'top'} style:--dock-alpha={`${Math.round(look.dockOpacity * 100)}%`} data-tauri-drag-region={look.nav === 'dock' ? undefined : true}>
  <a class="brand" href={href('home')} aria-label="Ripple home">
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <circle cx="16" cy="16" r="4" fill="var(--accent)" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="var(--accent)" stroke-width="2" opacity="0.6" />
      <circle cx="16" cy="16" r="14" fill="none" stroke="var(--accent)" stroke-width="2" opacity="0.3" />
    </svg>
    {#if look.nav === 'sidebar' || look.nav === 'top'}<span class="word">Ripple</span>{/if}
  </a>

  <div class="items">
    {#each items as item (item.id)}
      {@const m = NAV_META[item.id]}
      <a class="item" class:active={active(item.id)} href={href(item.id)} title={m.label}>
        <Icon name={m.icon} size={iconSize} stroke={iconStroke} />
        {#if labels}<span>{m.label}</span>{/if}
      </a>
    {/each}
  </div>

  <div class="end">
    <button class="item" class:active={ui.studioOpen} onclick={() => (ui.studioOpen = !ui.studioOpen)} title="Customize">
      <Icon name="brush" size={iconSize} stroke={iconStroke} />
      {#if labels}<span>Customize</span>{/if}
    </button>
    <a class="item" class:active={active('settings')} href={href('settings')} title="Settings">
      <Icon name="settings" size={iconSize} stroke={iconStroke} />
      {#if labels}<span>Settings</span>{/if}
    </a>
  </div>
  {#if customChrome && look.nav === 'top'}<WindowControls />{/if}
</nav>

<svelte:window onkeydown={(e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); openStudio(); }
}} />

<style>
  .nav { display: flex; flex-shrink: 0; z-index: 20; }
  .brand { display: flex; align-items: center; gap: 10px; color: var(--text); }
  .word { font-family: var(--font-display); font-weight: 800; font-size: 18px; letter-spacing: -0.02em; }
  .items, .end { display: flex; gap: 4px; }
  .item {
    display: flex; align-items: center; gap: 10px; border: 0; background: none; cursor: pointer;
    color: var(--text-3); font-weight: 600; transition: color var(--dur), background var(--dur);
    border-radius: min(var(--btn-radius), 12px);
  }
  .item:hover { color: var(--text); background: var(--bg-3); }
  .item.active { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }

  /* Vertical layouts */
  .sidebar, .rail, .icons {
    flex-direction: column; height: 100%; padding: 14px 10px; gap: 6px;
    background: color-mix(in srgb, var(--bg-2) 88%, transparent); backdrop-filter: blur(16px); border-right: 1px solid var(--line);
  }
  .sidebar .items, .sidebar .end, .rail .items, .rail .end, .icons .items, .icons .end { flex-direction: column; }
  .sidebar .items, .rail .items, .icons .items { flex: 1; }

  .sidebar { width: 216px; }
  .sidebar .brand { padding: 4px 10px 18px; }
  .sidebar .item { padding: 9px 12px; font-size: 14px; }

  .rail { width: 80px; align-items: center; }
  .rail .brand { margin-bottom: 14px; height: 40px; }
  .rail .item { width: 60px; flex-direction: column; gap: 3px; padding: 8px 0 6px; font-size: 10.5px; }

  .icons { width: 62px; align-items: center; }
  .icons .brand { margin-bottom: 14px; height: 40px; }
  .icons .item { width: 42px; height: 42px; justify-content: center; }

  /* Top bar */
  .top {
    height: 56px; align-items: center; gap: 22px; padding: 0 var(--page-pad);
    background: var(--glass); backdrop-filter: blur(16px); border-bottom: 1px solid var(--line);
  }
  .top .items { flex: 1; }
  .top.chrome { padding-right: 0; }
  .top.chrome .end { margin-right: 8px; }
  .top .item { padding: 7px 12px; font-size: 13.5px; gap: 8px; }

  /* Floating dock: opaque enough (and with bright, shadowed icons) to stay readable over busy artwork */
  .dock {
    position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
    align-items: center; gap: 4px; padding: 7px;
    background: color-mix(in srgb, var(--bg-2) var(--dock-alpha, 88%), transparent);
    backdrop-filter: blur(28px) saturate(1.6) brightness(0.8);
    border: 1px solid color-mix(in srgb, var(--text) 14%, transparent);
    border-radius: 24px;
    box-shadow: 0 18px 50px rgb(0 0 0 / 0.55), inset 0 1px 0 color-mix(in srgb, var(--text) 10%, transparent);
  }
  .dock .brand { padding: 0 8px 0 6px; }
  .dock .item {
    width: 50px; height: 50px; justify-content: center; border-radius: 17px;
    color: color-mix(in srgb, var(--text) 82%, transparent);
    filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.55));
  }
  .dock .item:hover { color: var(--text); background: color-mix(in srgb, var(--text) 12%, transparent); }
  .dock .item.active {
    color: var(--on-accent); background: var(--accent); filter: none;
    box-shadow: 0 4px 16px color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .dock .end { padding-left: 4px; margin-left: 4px; border-left: 1px solid color-mix(in srgb, var(--text) 16%, transparent); }
</style>
