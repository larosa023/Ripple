<script lang="ts">
  import Icon from './Icon.svelte';
  import { href, router, type RouteName } from '../stores/router.svelte';
  import { settings } from '../stores/settings.svelte';

  const items: { name: RouteName; label: string; icon: string }[] = [
    { name: 'home', label: 'Home', icon: 'home' },
    { name: 'discover', label: 'Discover', icon: 'compass' },
    { name: 'search', label: 'Search', icon: 'search' },
    { name: 'library', label: 'Library', icon: 'library' },
    { name: 'addons', label: 'Addons', icon: 'puzzle' },
  ];
</script>

<nav class="sidebar" class:compact={settings.compactSidebar}>
  <a class="logo" href={href('home')} aria-label="Ripple home">
    <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
      <circle cx="16" cy="16" r="4" fill="var(--accent)" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="var(--accent)" stroke-width="2" opacity="0.6" />
      <circle cx="16" cy="16" r="14" fill="none" stroke="var(--accent)" stroke-width="2" opacity="0.3" />
    </svg>
  </a>
  <div class="items">
    {#each items as item (item.name)}
      <a class="item" class:active={router.route.name === item.name} href={href(item.name)} title={item.label}>
        <Icon name={item.icon} size={22} />
        {#if !settings.compactSidebar}<span>{item.label}</span>{/if}
      </a>
    {/each}
  </div>
  <a class="item" class:active={router.route.name === 'settings'} href={href('settings')} title="Settings">
    <Icon name="settings" size={22} />
    {#if !settings.compactSidebar}<span>Settings</span>{/if}
  </a>
</nav>

<style>
  .sidebar {
    width: var(--sidebar);
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 14px 0;
    gap: 6px;
    background: var(--bg-2);
    border-right: 1px solid var(--line);
    flex-shrink: 0;
  }
  .logo { margin-bottom: 14px; display: grid; place-items: center; height: 40px; }
  .items { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .item {
    width: 60px;
    padding: 8px 0 6px;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    color: var(--text-3);
    font-size: 10.5px;
    font-weight: 600;
    transition: color var(--dur), background var(--dur);
  }
  .compact .item { padding: 10px 0; }
  .item:hover { color: var(--text); background: var(--bg-3); }
  .item.active { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
</style>
