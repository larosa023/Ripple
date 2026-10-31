<script lang="ts">
  import { onMount } from 'svelte';
  import Backdrop from './lib/components/Backdrop.svelte';
  import Nav from './lib/components/Nav.svelte';
  import Studio from './lib/components/Studio.svelte';
  import Player from './lib/components/Player.svelte';
  import { playback } from './lib/stores/playback.svelte';
  import Toasts from './lib/components/Toasts.svelte';
  import TitleBar from './lib/components/TitleBar.svelte';
  import { isTauri } from './lib/stremio/http';
  import UpdateBanner from './lib/components/UpdateBanner.svelte';
  import { checkForUpdate, loadVersion } from './lib/stores/updater.svelte';
  import { setRequestTimeout } from './lib/stremio/client';
  import { refreshAddons } from './lib/stores/addons.svelte';
  import { go, router } from './lib/stores/router.svelte';
  import { settings } from './lib/stores/settings.svelte';
  import { applyLook, look } from './lib/theme/look.svelte';
  import { startDiscordSync } from './lib/discord.svelte';
  import Calendar from './routes/Calendar.svelte';
  import Addons from './routes/Addons.svelte';
  import Detail from './routes/Detail.svelte';
  import Discover from './routes/Discover.svelte';
  import Home from './routes/Home.svelte';
  import Library from './routes/Library.svelte';
  import Search from './routes/Search.svelte';
  import Settings from './routes/Settings.svelte';

  const pages = { home: Home, discover: Discover, search: Search, detail: Detail, library: Library, calendar: Calendar, addons: Addons, settings: Settings };
  const Page = $derived(pages[router.route.name]);

  // Apply the whole look (colors, fonts, layout attributes, custom CSS) whenever any part changes.
  $effect(() => {
    applyLook($state.snapshot(look) as typeof look);
  });

  $effect(() => setRequestTimeout(settings.requestTimeoutSec * 1000));

  // Ripple draws its own themed title bar unless the user picks the standard Windows one.
  const customChrome = $derived(isTauri && !settings.nativeTitleBar);
  $effect(() => {
    const native = settings.nativeTitleBar;
    if (!isTauri) return;
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().setDecorations(native)).catch(() => {});
  });
  // Height of the window-button area, so overlays (Customize panel) never cover the buttons.
  $effect(() => {
    const h = !customChrome ? '0px' : look.nav === 'top' ? '56px' : '32px';
    document.documentElement.style.setProperty('--chrome-h', h);
  });

  startDiscordSync();

  onMount(() => {
    if (!location.hash && settings.startPage !== 'home') go(settings.startPage);
    // Refresh manifests in the background so new catalogs appear without blocking startup.
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb) => setTimeout(cb, 1500));
    idle(() => void refreshAddons());
    void loadVersion();
    // Look for a newer GitHub release a few seconds after launch.
    if (settings.checkUpdates) setTimeout(() => void checkForUpdate(), 4000);
  });

  function onKey(e: KeyboardEvent) {
    if (playback.active && !playback.mini) return; // the player handles its own keys
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName);
    if ((e.ctrlKey && e.key.toLowerCase() === 'k') || (!typing && e.key === '/')) {
      e.preventDefault();
      go('search');
    } else if (!typing && e.altKey && e.key === 'ArrowLeft') {
      history.back();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<Backdrop />
<div class="shell" class:column={look.nav === 'top'} class:has-bg={!!look.bgImage || look.bgAnimation !== 'none'}>
  <Nav />
  <main>
    {#if customChrome && look.nav !== 'top'}<TitleBar />{/if}
    <UpdateBanner />
    <div class="view">
      {#key router.route.name === 'detail' ? router.route.params.join('/') : router.route.name}
        <Page />
      {/key}
    </div>
  </main>
</div>
<Studio />
<Player />
<Toasts />

<style>
  .shell { position: relative; z-index: 1; display: flex; height: 100%; }
  .shell.column { flex-direction: column; }
  main { flex: 1; min-width: 0; min-height: 0; height: 100%; display: flex; flex-direction: column; }
  .view { flex: 1; min-height: 0; }
  /* Let a custom background show through the main area. */
  :global(html:has(.shell.has-bg)) { background: var(--bg); }
  :global(html:has(.shell.has-bg) body) { background: transparent; }
</style>
