<script lang="ts">
  // New episodes for the shows in your library: what just came out, and what's coming.
  import Icon from '../lib/components/Icon.svelte';
  import { getMeta } from '../lib/stremio/client';
  import { backdropOf } from '../lib/stremio/images';
  import type { MetaDetail, MetaPreview, Video } from '../lib/stremio/types';
  import { enabledAddons } from '../lib/stores/addons.svelte';
  import { isWatched, library } from '../lib/stores/library.svelte';
  import { href } from '../lib/stores/router.svelte';
  import { epCode } from '../lib/watch';

  interface Entry {
    show: MetaDetail;
    video: Video;
    date: Date;
  }

  const DAY = 86_400_000;
  let range: 'week' | 'month' = $state('week');
  let entries = $state<Entry[]>([]);
  let loading = $state(true);
  let loaded = $state(0);

  // Every series you've saved or watched, newest activity first.
  const followed = $derived.by(() => {
    const seen = new Map<string, MetaPreview>();
    for (const h of library.history) if (h.meta.type !== 'movie') seen.set(h.meta.id, h.meta);
    for (const s of library.saved) if (s.meta.type !== 'movie') seen.set(s.meta.id, s.meta);
    return [...seen.values()];
  });

  $effect(() => {
    const list = followed;
    let live = true;
    loading = true;
    loaded = 0;
    const found: Entry[] = [];
    const from = Date.now() - 8 * DAY;
    const to = Date.now() + 62 * DAY;
    const queue = [...list];
    const worker = async () => {
      for (let m = queue.shift(); m; m = queue.shift()) {
        try {
          const meta = await getMeta(enabledAddons(), m.type, m.id);
          for (const v of meta.videos ?? []) {
            if (!v.released || (v.season ?? 0) === 0) continue;
            const d = new Date(v.released);
            if (+d >= from && +d <= to) found.push({ show: meta, video: v, date: d });
          }
        } catch {
          /* skip shows whose details don't load */
        }
        if (!live) return;
        loaded++;
        entries = [...found];
      }
    };
    Promise.all(Array.from({ length: Math.min(4, list.length) }, worker)).then(() => {
      if (live) loading = false;
    });
    if (!list.length) loading = false;
    return () => {
      live = false;
    };
  });

  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const startOfToday = () => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  };

  function dayTitle(d: Date): string {
    const diff = Math.round((+new Date(d.getFullYear(), d.getMonth(), d.getDate()) - +startOfToday()) / DAY);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function group(list: Entry[], newestFirst: boolean) {
    const sorted = [...list].sort((a, b) => (newestFirst ? +b.date - +a.date : +a.date - +b.date));
    const out: { key: string; title: string; items: Entry[] }[] = [];
    for (const e of sorted) {
      const k = dayKey(e.date);
      let g = out.find((x) => x.key === k);
      if (!g) out.push((g = { key: k, title: dayTitle(e.date), items: [] }));
      g.items.push(e);
    }
    return out;
  }

  const today = $derived(+startOfToday());
  const recent = $derived(group(entries.filter((e) => +e.date < today + DAY && +e.date >= today - 7 * DAY), true));
  const upcoming = $derived(
    group(entries.filter((e) => +e.date >= today + DAY && +e.date < today + (range === 'week' ? 8 : 62) * DAY), false),
  );
</script>

<div class="page">
  <div class="head">
    <h1 class="page-title">Calendar</h1>
    {#if loading && followed.length}<span class="muted small">Checking {loaded}/{followed.length} shows…</span>{/if}
  </div>

  {#if !followed.length}
    <div class="empty">
      <Icon name="calendar" size={30} />
      <p>Save shows to your library (or start watching one) and their new episodes show up here.</p>
    </div>
  {:else}
    <section>
      <h2>Out this week</h2>
      {#each recent as g (g.key)}
        <h3>{g.title}</h3>
        <div class="grid">
          {#each g.items as e (e.video.id)}{@render card(e)}{/each}
        </div>
      {:else}
        {#if !loading}<p class="muted none">No new episodes in the last 7 days.</p>{:else}<div class="grid">{#each Array(3) as _, i (i)}<div class="ghost skeleton"></div>{/each}</div>{/if}
      {/each}
    </section>

    <section>
      <div class="sec-head">
        <h2>Coming up</h2>
        <div class="tabs">
          <button class="tab" class:active={range === 'week'} onclick={() => (range = 'week')}>Next 7 days</button>
          <button class="tab" class:active={range === 'month'} onclick={() => (range = 'month')}>Next 2 months</button>
        </div>
      </div>
      {#each upcoming as g (g.key)}
        <h3>{g.title}</h3>
        <div class="grid">
          {#each g.items as e (e.video.id)}{@render card(e)}{/each}
        </div>
      {:else}
        {#if !loading}<p class="muted none">Nothing scheduled {range === 'week' ? 'this week' : 'in the next two months'} for your shows.</p>{/if}
      {/each}
    </section>
  {/if}
</div>

{#snippet card(e: Entry)}
  {@const thumb = e.video.thumbnail || backdropOf(e.show, 'small')}
  {@const out = +e.date <= Date.now()}
  <a class="ep" href={href('detail', e.show.type, e.show.id)}>
    <div class="thumb">
      {#if thumb}<img src={thumb} alt="" loading="lazy" onerror={(ev) => ((ev.currentTarget as HTMLElement).style.display = 'none')} />{/if}
      <span class="code">{epCode(e.video)}</span>
      {#if isWatched(e.video.id)}<span class="seen"><Icon name="check" size={12} stroke={3} /></span>{:else if out}<span class="new">New</span>{/if}
    </div>
    <div class="info">
      <div class="show">{e.show.name}</div>
      <div class="title">{e.video.title ?? e.video.name ?? `Episode ${e.video.episode ?? ''}`}</div>
    </div>
  </a>
{/snippet}

<style>
  .head { display: flex; align-items: baseline; gap: 14px; }
  .small { font-size: 12.5px; }
  section { margin-bottom: 34px; }
  h2 { font-size: 19px; font-weight: 700; margin: 0 0 6px; }
  h3 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-2); margin: 18px 0 10px; }
  .sec-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .tabs { display: flex; gap: 4px; background: var(--bg-2); border: 1px solid var(--line); padding: 3px; border-radius: 9px; }
  .tab { border: 0; background: none; padding: 5px 12px; border-radius: 7px; cursor: pointer; color: var(--text-2); font-weight: 600; font-size: 12.5px; }
  .tab.active { background: var(--accent); color: var(--on-accent); }
  .none { margin: 10px 0 0; }
  .empty { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .empty p { max-width: 42ch; }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .ghost { height: 84px; border-radius: 12px; }
  .ep {
    display: flex; gap: 12px; align-items: center; padding: 8px; border-radius: 12px; color: inherit; text-decoration: none;
    background: var(--bg-2); border: 1px solid var(--line); transition: border-color var(--dur), background var(--dur);
  }
  .ep:hover { border-color: color-mix(in srgb, var(--accent) 55%, transparent); background: var(--bg-3); }
  .thumb { position: relative; width: 124px; aspect-ratio: 16 / 9; flex-shrink: 0; border-radius: 8px; overflow: hidden; background: var(--bg-3); }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .code {
    position: absolute; left: 5px; bottom: 5px; padding: 1px 6px; border-radius: 5px; font-size: 10.5px; font-weight: 800;
    background: rgb(0 0 0 / 0.72); color: #fff; letter-spacing: 0.02em;
  }
  .new, .seen {
    position: absolute; top: 5px; right: 5px; padding: 1px 6px; border-radius: 5px; font-size: 10px; font-weight: 800;
    background: var(--accent); color: var(--on-accent); text-transform: uppercase; letter-spacing: 0.04em;
  }
  .seen { padding: 3px; border-radius: 50%; background: var(--ok); color: #000; }
  .info { min-width: 0; }
  .show { font-weight: 700; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .title { font-size: 12.5px; color: var(--text-2); margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
</style>
