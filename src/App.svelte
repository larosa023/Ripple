<script lang="ts">
  import { onMount } from 'svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import Toasts from './lib/components/Toasts.svelte';
  import UpdateBanner from './lib/components/UpdateBanner.svelte';
  import { checkForUpdate, loadVersion } from './lib/stores/updater.svelte';
  import { setRequestTimeout } from './lib/stremio/client';
  import { refreshAddons } from './lib/stores/addons.svelte';
  import { go, router } from './lib/stores/router.svelte';
  import { settings } from './lib/stores/settings.svelte';
  import Addons from './routes/Addons.svelte';
  import Detail from './routes/Detail.svelte';
  import Discover from './routes/Discover.svelte';
  import Home from './routes/Home.svelte';
  import Library from './routes/Library.svelte';
  import Search from './routes/Search.svelte';
  import Settings from './routes/Settings.svelte';

  const pages = { home: Home, discover: Discover, search: Search, detail: Detail, library: Library, addons: Addons, settings: Settings };
  const Page = $derived(pages[router.route.name]);

  // Apply appearance settings to the document root.
  $effect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.dataset.poster = settings.posterSize;
    root.dataset.motion = settings.reduceMotion ? 'reduce' : '';
    root.style.setProperty('--accent', settings.accent);
    root.style.setProperty('--sidebar', settings.compactSidebar ? '64px' : '76px');
  });

  $effect(() => setRequestTimeout(settings.requestTimeoutSec * 1000));

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

<div class="shell">
  <Sidebar />
  <main>
    <UpdateBanner />
    <div class="view">
    {#key router.route.name === 'detail' ? router.route.params.join('/') : router.route.name}
      <Page />
    {/key}
    </div>
  </main>
</div>
<Toasts />

<style>
  .shell { display: flex; height: 100%; }
  main { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; }
  .view { flex: 1; min-height: 0; }
</style>
