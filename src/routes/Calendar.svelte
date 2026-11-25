<script lang="ts">
  // Episodes of the shows in your library, on a month calendar (or as a list).
  import Icon from '../lib/components/Icon.svelte';
  import { untrack } from 'svelte';
  import { airDate } from '../lib/dates';
  import { getMeta } from '../lib/stremio/client';
  import { backdropOf } from '../lib/stremio/images';
  import type { MetaDetail, MetaPreview, Video } from '../lib/stremio/types';
  import { enabledAddons } from '../lib/stores/addons.svelte';
  import { isWatched, library } from '../lib/stores/library.svelte';
  import { load, save } from '../lib/stores/persist';
  import { href } from '../lib/stores/router.svelte';
  import { epCode } from '../lib/watch';
  import { markEpisodesSeen } from '../lib/episodes.svelte';

  markEpisodesSeen();

  interface Entry {
    show: MetaDetail;
    video: Video;
    date: Date;
  }
  /** One show's episodes on one day (a whole season drop is one chip). */
  interface Chip {
    key: string;
    show: MetaDetail;
    items: Entry[];
  }

  const DAY = 86_400_000;
  let view: 'month' | 'list' = $state(load<string>('calendarView', 'month') === 'list' ? 'list' : 'month');
  let range: 'week' | 'month' = $state('week');
  let entries = $state<Entry[]>([]);
  let loading = $state(true);
  let loaded = $state(0);

  $effect(() => save('calendarView', view));

  // Every series you've saved or watched.
  const followed = $derived.by(() => {
    const seen = new Map<string, MetaPreview>();
    for (const h of library.history) if (h.meta.type !== 'movie') seen.set(h.meta.id, h.meta);
    for (const s of library.saved) if (s.meta.type !== 'movie') seen.set(s.meta.id, s.meta);
    return [...seen.values()];
  });

  // Refetch only when the set of shows changes, not every time something is played.
  const followedKey = $derived(followed.map((m) => m.id).sort().join(','));

  $effect(() => {
    void followedKey;
    const list = untrack(() => followed);
    let live = true;
    loading = true;
    loaded = 0;
    const found: Entry[] = [];
    const queue = [...list];
    const worker = async () => {
      for (let m = queue.shift(); m; m = queue.shift()) {
        try {
          const meta = await getMeta(enabledAddons(), m.type, m.id);
          for (const v of meta.videos ?? []) {
            if (!v.released || (v.season ?? 0) === 0) continue;
            const d = airDate(v.released);
            if (!isNaN(+d)) found.push({ show: meta, video: v, date: d });
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
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const startOfToday = () => startOfDay(new Date());

  // ---------- month view ----------

  const now = new Date();
  let month = $state(new Date(now.getFullYear(), now.getMonth(), 1));
  let selected = $state(dayKey(now));

  // First day of the week from your system's region (Sunday in the US, Monday in most of Europe).
  const firstDay = (() => {
    try {
      const loc = new Intl.Locale(navigator.language) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } };
      const f = (loc.getWeekInfo?.() ?? loc.weekInfo)?.firstDay;
      return f ? f % 7 : 0;
    } catch {
      return 0;
    }
  })();
  const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const weekdays = Array.from({ length: 7 }, (_, i) => WEEKDAY.format(new Date(2023, 0, 1 + ((firstDay + i) % 7)))); // Jan 1 2023 was a Sunday
  const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

  const byDay = $derived.by(() => {
    const map = new Map<string, Chip[]>();
    const sorted = [...entries].sort((a, b) => a.show.name.localeCompare(b.show.name) || (a.video.season ?? 0) - (b.video.season ?? 0) || (a.video.episode ?? 0) - (b.video.episode ?? 0));
    for (const e of sorted) {
      const k = dayKey(e.date);
      let chips = map.get(k);
      if (!chips) map.set(k, (chips = []));
      let c = chips.find((x) => x.show.id === e.show.id);
      if (!c) chips.push((c = { key: `${k}|${e.show.id}`, show: e.show, items: [] }));
      c.items.push(e);
    }
    return map;
  });

  const cells = $derived.by(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const lead = (first.getDay() - firstDay + 7) % 7;
    const daysIn = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const count = Math.ceil((lead + daysIn) / 7) * 7;
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(month.getFullYear(), month.getMonth(), 1 - lead + i);
      const k = dayKey(d);
      return { date: d, key: k, inMonth: d.getMonth() === month.getMonth(), chips: byDay.get(k) ?? [] };
    });
  });

  const todayKey = $derived(dayKey(new Date(+startOfToday())));
  const monthCount = $derived(cells.filter((c) => c.inMonth).reduce((n, c) => n + c.chips.reduce((a, ch) => a + ch.items.length, 0), 0));
  const isThisMonth = $derived(month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth());

  function shift(n: number) {
    month = new Date(month.getFullYear(), month.getMonth() + n, 1);
  }
  function goToday() {
    const t = new Date();
    month = new Date(t.getFullYear(), t.getMonth(), 1);
    selected = dayKey(t);
  }
  /** Jumps to the month of the next day (after the shown month) that has episodes. */
  const nextAiring = $derived.by(() => {
    const after = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    let best: Date | null = null;
    for (const e of entries) if (+e.date >= +after && (!best || +e.date < +best)) best = e.date;
    return best;
  });
  function jump(d: Date) {
    month = new Date(d.getFullYear(), d.getMonth(), 1);
    selected = dayKey(d);
  }

  const selectedCell = $derived(cells.find((c) => c.key === selected));
  const selectedItems = $derived(selectedCell ? selectedCell.chips.flatMap((c) => c.items) : []);

  function onKey(e: KeyboardEvent) {
    if (view !== 'month' || (e.target as HTMLElement)?.closest('input, textarea, select')) return;
    if (e.key === 'PageUp') shift(-1);
    else if (e.key === 'PageDown') shift(1);
    else return;
    e.preventDefault();
  }

  const MAX_CHIPS = 3;
  const chipCode = (c: Chip) => {
    if (c.items.length === 1) return epCode(c.items[0].video);
    const a = c.items[0].video;
    const b = c.items[c.items.length - 1].video;
    return a.season === b.season ? `S${a.season} E${a.episode ?? a.number}–${b.episode ?? b.number}` : `${c.items.length} episodes`;
  };
  const chipState = (c: Chip) => {
    if (c.items.every((e) => isWatched(e.video.id))) return 'seen';
    return +c.items[0].date <= Date.now() ? 'out' : 'soon';
  };

  // ---------- list view ----------

  const DAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  function dayTitle(d: Date): string {
    const diff = Math.round((+startOfDay(d) - +startOfToday()) / DAY);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    return DAY_FMT.format(d);
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

<svelte:window onkeydown={onKey} />

<div class="page">
  <div class="head">
    <h1 class="page-title">Calendar</h1>
    {#if loading && followed.length}<span class="muted small">Checking {loaded}/{followed.length} shows…</span>{/if}
    <div class="tabs views">
      <button class="tab" class:active={view === 'month'} onclick={() => (view = 'month')}><Icon name="grid" size={14} />Month</button>
      <button class="tab" class:active={view === 'list'} onclick={() => (view = 'list')}><Icon name="list" size={14} />List</button>
    </div>
  </div>

  {#if !followed.length}
    <div class="empty">
      <Icon name="calendar" size={30} />
      <p>Save shows to your library (or start watching one) and their new episodes show up here.</p>
    </div>
  {:else if view === 'month'}
    <div class="bar">
      <div class="monthnav">
        <button class="icon-btn" onclick={() => shift(-1)} aria-label="Previous month" title="Previous month (Page Up)"><Icon name="chevronLeft" /></button>
        <button class="icon-btn" onclick={() => shift(1)} aria-label="Next month" title="Next month (Page Down)"><Icon name="chevronRight" /></button>
        <h2>{MONTH_FMT.format(month)}</h2>
        <button class="btn today" onclick={goToday} disabled={isThisMonth && selected === todayKey}>Today</button>
      </div>
      <span class="muted small">
        {#if monthCount}{monthCount} episode{monthCount === 1 ? '' : 's'} this month{:else if !loading}No episodes this month{/if}
        {#if !monthCount && !loading && nextAiring}
          · <button class="link" onclick={() => jump(nextAiring!)}>Next: {DAY_FMT.format(nextAiring)}</button>
        {/if}
      </span>
    </div>

    <div class="cal" role="grid" aria-label={MONTH_FMT.format(month)}>
      <div class="wk" role="row">
        {#each weekdays as w (w)}<div class="wd" role="columnheader">{w}</div>{/each}
      </div>
      <div class="days">
        {#each cells as c (c.key)}
          {@const isToday = c.key === todayKey}
          {@const past = +c.date < today}
          <div
            class="cell"
            class:out={!c.inMonth}
            class:past
            class:today={isToday}
            class:sel={c.key === selected}
            role="gridcell"
            tabindex="-1"
            aria-selected={c.key === selected}
            onclick={() => (selected = c.key)}
            onkeydown={(e) => e.key === 'Enter' && (selected = c.key)}
          >
            <span class="num">{c.date.getDate() === 1 && !c.inMonth ? `${c.date.toLocaleString(undefined, { month: 'short' })} 1` : c.date.getDate()}</span>
            <div class="chips">
              {#each c.chips.slice(0, MAX_CHIPS) as ch (ch.key)}
                {@const st = chipState(ch)}
                <a
                  class="ev is-{st}"
                  href={href('detail', ch.show.type, ch.show.id)}
                  title="{ch.show.name} · {chipCode(ch)}{ch.items.length === 1 && (ch.items[0].video.title || ch.items[0].video.name) ? ` · ${ch.items[0].video.title || ch.items[0].video.name}` : ''}"
                  onclick={(e) => e.stopPropagation()}
                >
                  {#if ch.show.poster}<img src={ch.show.poster} alt="" loading="lazy" onerror={(ev) => ((ev.currentTarget as HTMLElement).style.visibility = 'hidden')} />{:else}<i class="noposter"></i>{/if}
                  <span class="ct">
                    <b>{ch.show.name}</b>
                    <small>{chipCode(ch)}</small>
                  </span>
                  {#if st === 'seen'}<span class="mark mk-seen"><Icon name="check" size={10} stroke={3.2} /></span>{:else if st === 'out'}<span class="mark mk-dot"></span>{/if}
                </a>
              {/each}
              {#if c.chips.length > MAX_CHIPS}
                <button class="more" onclick={(e) => { e.stopPropagation(); selected = c.key; }}>+{c.chips.length - MAX_CHIPS} more</button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>

    {#if selectedCell}
      <section class="dayview">
        <h3>{dayTitle(selectedCell.date)}{#if !['Today', 'Tomorrow', 'Yesterday'].includes(dayTitle(selectedCell.date)) && selectedCell.date.getFullYear() !== now.getFullYear()}, {selectedCell.date.getFullYear()}{/if}</h3>
        {#if selectedItems.length}
          <div class="grid">
            {#each selectedItems as e (e.video.id)}{@render card(e)}{/each}
          </div>
        {:else}
          <p class="muted none">{loading ? 'Still checking your shows…' : 'Nothing out on this day.'}</p>
        {/if}
      </section>
    {/if}
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
  .head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
  .views { margin-left: auto; align-self: center; }
  .views .tab { display: inline-flex; align-items: center; gap: 6px; }
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

  /* ---------- month ---------- */
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 4px 0 12px; }
  .monthnav { display: flex; align-items: center; gap: 4px; }
  .monthnav h2 { margin: 0 10px 0 6px; font-size: 22px; min-width: 9ch; }
  .today { padding: 5px 14px; font-size: 13px; }
  .today:disabled { opacity: 0.45; cursor: default; }
  .link { border: 0; background: none; padding: 0; color: var(--accent); font: inherit; font-weight: 600; cursor: pointer; }
  .link:hover { text-decoration: underline; }

  .cal { border: 1px solid var(--line); border-radius: var(--radius, 12px); overflow: hidden; background: var(--bg-2); }
  .wk, .days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
  .wd {
    padding: 9px 10px; font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-2);
    border-bottom: 1px solid var(--line);
  }
  .days { grid-auto-rows: minmax(118px, auto); }
  .cell {
    position: relative; min-width: 0; padding: 6px 6px 8px; display: flex; flex-direction: column; gap: 5px; cursor: pointer;
    border-right: 1px solid var(--line); border-bottom: 1px solid var(--line);
    transition: background var(--dur);
  }
  .cell:nth-child(7n) { border-right: 0; }
  .cell:nth-last-child(-n + 7) { border-bottom: 0; }
  .cell:hover { background: color-mix(in srgb, var(--text) 3%, transparent); }
  .cell.out { background: color-mix(in srgb, var(--bg) 55%, transparent); }
  .cell.out .num, .cell.out .chips { opacity: 0.45; }
  .cell.sel { box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 70%, transparent); }
  .num {
    align-self: flex-start; min-width: 26px; height: 26px; padding: 0 7px; display: grid; place-items: center; border-radius: 13px;
    font-size: 13px; font-weight: 700; color: var(--text-2); font-variant-numeric: tabular-nums;
  }
  .cell.past:not(.today) .num { color: color-mix(in srgb, var(--text-2) 70%, transparent); }
  .cell.today .num { background: var(--accent); color: var(--on-accent); }
  .chips { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex-shrink: 0; }
  .ev {
    position: relative; display: flex; flex-shrink: 0; align-items: center; gap: 7px; min-width: 0; padding: 3px 8px 3px 3px; border-radius: 8px;
    color: inherit; text-decoration: none; background: var(--bg-3); border: 1px solid transparent;
    transition: border-color var(--dur), background var(--dur), transform var(--dur);
  }
  .ev:hover { border-color: color-mix(in srgb, var(--accent) 60%, transparent); transform: translateY(-1px); }
  .ev.is-out { background: color-mix(in srgb, var(--accent) 16%, var(--bg-3)); }
  .ev.is-seen { opacity: 0.62; }
  .ev img, .noposter { width: 22px; height: 33px; flex-shrink: 0; border-radius: 4px; object-fit: cover; background: var(--bg-2); }
  .ct { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
  .ct b { font-size: 12px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ct small { font-size: 10.5px; font-weight: 700; color: var(--text-2); letter-spacing: 0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mark { position: absolute; top: 4px; right: 4px; }
  .mark.mk-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
  .mark.mk-seen { width: 14px; height: 14px; border-radius: 50%; display: grid; place-items: center; background: var(--ok); color: #000; }
  .ev:has(.mark) { padding-right: 16px; }
  .more {
    align-self: flex-start; border: 0; background: none; padding: 1px 4px; border-radius: 5px; cursor: pointer;
    font: 700 11.5px var(--font); color: var(--text-2);
  }
  .more:hover { color: var(--text); background: var(--bg-3); }
  .dayview { margin-top: 6px; }

  @media (max-width: 900px) {
    .days { grid-auto-rows: minmax(84px, auto); }
    .ev img, .noposter { display: none; }
    .ev { padding: 3px 6px; }
    .ct small { display: none; }
  }

  /* ---------- cards (list + selected day) ---------- */
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
