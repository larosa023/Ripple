<script lang="ts">
  import Icon from '../lib/components/Icon.svelte';
  import { hm, log, summarize, type Period } from '../lib/stats.svelte';
  import { href } from '../lib/stores/router.svelte';
  import { clockTime } from '../lib/stores/settings.svelte';

  let period: Period = $state('year');
  const now = new Date();
  const s = $derived.by(() => {
    void log.days; // recompute as the log grows
    return summarize(period, now);
  });
  const shows = $derived(s.titles.filter((t) => t.info.type === 'series').slice(0, 8));
  const movies = $derived(s.titles.filter((t) => t.info.type === 'movie').slice(0, 8));
  const maxBar = $derived(Math.max(1, ...s.bars.map((b) => b.seconds)));
  const maxGenre = $derived(Math.max(1, ...s.genres.map((g) => g.seconds)));
  const maxShow = $derived(Math.max(1, shows[0]?.seconds ?? 0, movies[0]?.seconds ?? 0));
  const hours = $derived(log.hours.length === 24 ? log.hours : Array(24).fill(0));
  const maxHour = $derived(Math.max(1, ...hours));

  // A light-hearted label from when you usually watch.
  const persona = $derived.by(() => {
    const total = hours.reduce((a, b) => a + b, 0);
    if (total < 3600) return null;
    const share = (from: number, to: number) => {
      let n = 0;
      for (let h = from; h !== to; h = (h + 1) % 24) n += hours[h];
      return n / total;
    };
    if (share(22, 4) > 0.4) return { title: 'Night owl', text: 'Most of your watching happens after 10 PM.' };
    if (share(5, 12) > 0.35) return { title: 'Early bird', text: 'You do a lot of your watching in the morning.' };
    if (share(12, 17) > 0.4) return { title: 'Afternoon viewer', text: 'Your favorite time to watch is the afternoon.' };
    return { title: 'Prime-time viewer', text: 'You mostly watch in the evening.' };
  });

  const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const day = (k: string) => DAY.format(new Date(`${k}T12:00:00`));
  const hourLabel = (h: number) => clockTime(new Date(2000, 0, 1, h)).replace(':00', '');
  const PERIODS: [Period, string][] = [
    ['month', 'This month'],
    ['year', String(now.getFullYear())],
    ['all', 'All time'],
  ];
  let tip: { x: number; text: string } | null = $state(null);
</script>

<div class="page">
  <div class="head">
    <h1 class="page-title">Your stats</h1>
    <div class="seg" role="tablist" aria-label="Period">
      {#each PERIODS as [v, l] (v)}
        <button role="tab" aria-selected={period === v} class:on={period === v} onclick={() => (period = v)}>{l}</button>
      {/each}
    </div>
  </div>

  {#if s.seconds < 60}
    <div class="empty">
      <div class="eicon"><Icon name="chart" size={30} /></div>
      <h2>Nothing here yet</h2>
      <p class="faint">Your stats fill in as you watch in Ripple's player: hours watched, top shows, favorite genres, binges and more.</p>
    </div>
  {:else}
    <section class="tiles">
      <div class="tile hero">
        <span class="k">Watch time</span>
        <b class="v">{hm(s.seconds)}</b>
        <span class="sub">{s.activeDays} day{s.activeDays === 1 ? '' : 's'} with something on</span>
      </div>
      <div class="tile"><span class="k">Finished</span><b class="v">{s.finished}</b><span class="sub">episodes &amp; movies</span></div>
      <div class="tile"><span class="k">Titles</span><b class="v">{s.titles.length}</b><span class="sub">{#if shows.length}{@const n = s.titles.filter((t) => t.info.type === 'series').length}{n} show{n === 1 ? '' : 's'}{:else}watched{/if}</span></div>
      <div class="tile"><span class="k">Longest streak</span><b class="v">{s.streak}</b><span class="sub">day{s.streak === 1 ? '' : 's'} in a row</span></div>
      {#if s.busiest}
        <div class="tile"><span class="k">Busiest day</span><b class="v">{hm(s.busiest.seconds)}</b><span class="sub">{day(s.busiest.day)}</span></div>
      {/if}
    </section>

    {#if s.binge || persona}
      <section class="callouts">
        {#if s.binge}
          {@const t = log.titles[s.binge.id]}
          <a class="callout" href={href('detail', 'series', s.binge.id)}>
            {#if t?.poster}<span class="cposter" style:background-image={`url("${t.poster}")`}></span>{/if}
            <span><em>Biggest binge</em><b>{s.binge.count} episodes of {t?.name ?? 'a show'}</b><small>{day(s.binge.day)}</small></span>
          </a>
        {/if}
        {#if persona}
          <div class="callout"><span class="cicon"><Icon name="clock" size={22} /></span><span><em>Your watching style</em><b>{persona.title}</b><small>{persona.text}</small></span></div>
        {/if}
      </section>
    {/if}

    <section class="card">
      <h2>Watch time {period === 'month' ? 'by day' : 'by month'}</h2>
      <div class="chart" role="img" aria-label="Watch time {period === 'month' ? 'per day this month' : 'per month'}">
        <div class="bars" style:--n={s.bars.length} onmouseleave={() => (tip = null)} role="presentation">
          {#each s.bars as b, i (b.full)}
            <div
              class="col"
              role="presentation"
              onmouseenter={(e) => (tip = { x: (e.currentTarget as HTMLElement).offsetLeft + (e.currentTarget as HTMLElement).offsetWidth / 2, text: `${b.full} · ${b.seconds ? hm(b.seconds) : 'nothing'}` })}
            >
              <i class="bar" class:zero={!b.seconds} style:height="{b.seconds ? Math.max(2, (b.seconds / maxBar) * 100) : 0}%"></i>
              {#if period !== 'month' || i % 5 === 0 || i === s.bars.length - 1}<span class="lab">{b.label}</span>{/if}
            </div>
          {/each}
          {#if tip}<div class="tip" style:left="{tip.x}px">{tip.text}</div>{/if}
        </div>
      </div>
      <details class="table">
        <summary>Show as a table</summary>
        <table><tbody>{#each s.bars as b (b.full)}<tr><td>{b.full}</td><td>{hm(b.seconds)}</td></tr>{/each}</tbody></table>
      </details>
    </section>

    <div class="two">
      {#each [['Top shows', shows, 'series'], ['Top movies', movies, 'movie']] as [title, list, type] (title)}
        {#if (list as typeof shows).length}
          <section class="card">
            <h2>{title}</h2>
            <ol class="top">
              {#each list as typeof shows as t, i (t.id)}
                <li>
                  <span class="rank">{i + 1}</span>
                  <a class="tposter" href={href('detail', type as string, t.id)} style:background-image={t.info.poster ? `url("${t.info.poster}")` : undefined} aria-label={t.info.name}></a>
                  <span class="tbody">
                    <a href={href('detail', type as string, t.id)}>{t.info.name}</a>
                    <span class="meter"><i style:width="{(t.seconds / maxShow) * 100}%"></i></span>
                  </span>
                  <b>{hm(t.seconds)}</b>
                </li>
              {/each}
            </ol>
          </section>
        {/if}
      {/each}
    </div>

    <div class="two">
      {#if s.genres.length}
        <section class="card">
          <h2>Favorite genres</h2>
          <ul class="hbars">
            {#each s.genres as g (g.name)}
              <li><span>{g.name}</span><span class="meter"><i style:width="{(g.seconds / maxGenre) * 100}%"></i></span><b>{hm(g.seconds)}</b></li>
            {/each}
          </ul>
        </section>
      {/if}
      <section class="card">
        <h2>When you watch <span class="faint">all time</span></h2>
        <div class="hours" role="img" aria-label="Watch time by hour of day">
          {#each hours as h, i (i)}
            <div class="hcol" title="{hourLabel(i)} · {hm(h)}">
              <i style:height="{h ? Math.max(3, (h / maxHour) * 100) : 0}%"></i>
            </div>
          {/each}
        </div>
        <div class="hlabels"><span>{hourLabel(0)}</span><span>{hourLabel(6)}</span><span>{hourLabel(12)}</span><span>{hourLabel(18)}</span><span>{hourLabel(23)}</span></div>
      </section>
    </div>
    <p class="faint foot">Counted from time actually playing in Ripple's player. Before this version, watch time is estimated from where you left off in each episode.</p>
  {/if}
</div>

<style>
  .head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 22px; flex-wrap: wrap; }
  .seg { display: flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--bg-2); }
  .seg button { height: 32px; padding: 0 16px; border: 0; border-radius: 999px; background: none; color: var(--text-2); font: 600 13px var(--font); cursor: pointer; }
  .seg button.on { background: var(--text); color: var(--bg); }

  .empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 70px 20px; }
  .empty p { max-width: 46ch; margin: 0; }
  .empty h2 { margin: 8px 0 0; }
  .eicon { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }

  .tiles { display: grid; grid-template-columns: 1.6fr repeat(4, 1fr); gap: 12px; margin-bottom: 14px; }
  @media (max-width: 1100px) { .tiles { grid-template-columns: repeat(3, 1fr); } .tile.hero { grid-column: span 3; } }
  .tile { display: flex; flex-direction: column; gap: 4px; padding: 16px 18px; border-radius: var(--radius, 14px); background: var(--bg-2); min-width: 0; }
  .tile.hero { background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 26%, var(--bg-2)), var(--bg-2) 70%); }
  .k { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-2); }
  .v { font: 800 30px / 1.1 var(--font-display); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .hero .v { font-size: 44px; }
  .sub { font-size: 12.5px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .callouts { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; margin-bottom: 14px; }
  .callout { display: flex; align-items: center; gap: 14px; padding: 12px 16px; border-radius: var(--radius, 14px); background: var(--bg-2); color: inherit; text-decoration: none; }
  a.callout:hover { background: color-mix(in srgb, var(--text) 6%, var(--bg-2)); }
  .callout > span:last-child { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .callout em { font-style: normal; font-size: 11.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); }
  .callout b { font-size: 16px; }
  .callout small { font-size: 12.5px; color: var(--text-2); }
  .cposter { flex-shrink: 0; width: 40px; aspect-ratio: 2 / 3; border-radius: 6px; background: var(--bg-3) center / cover; }
  .cicon { flex-shrink: 0; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }

  .card { padding: 18px 20px; border-radius: var(--radius, 14px); background: var(--bg-2); margin-bottom: 14px; min-width: 0; }
  .card h2 { margin: 0 0 14px; font-size: 16px; font-weight: 700; display: flex; gap: 8px; align-items: baseline; }
  .card h2 .faint { font-size: 12.5px; font-weight: 600; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .two .card { margin-bottom: 14px; }
  @media (max-width: 960px) { .two { grid-template-columns: 1fr; } }

  /* Single-series bars in the accent: thin, rounded at the data end, anchored on a quiet baseline. */
  .chart { position: relative; }
  .bars { position: relative; height: 190px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 2px; align-items: end; border-bottom: 1px solid color-mix(in srgb, var(--text) 14%, transparent); padding-bottom: 0; margin-bottom: 22px; }
  .col { position: relative; height: 100%; display: flex; align-items: flex-end; justify-content: center; cursor: default; }
  .col:hover { background: color-mix(in srgb, var(--text) 5%, transparent); border-radius: 4px 4px 0 0; }
  .bar { display: block; width: min(70%, 28px); border-radius: 4px 4px 0 0; background: var(--accent); transition: height 400ms var(--ease, ease); }
  .lab { position: absolute; top: 100%; margin-top: 6px; font-size: 11.5px; color: var(--text-2); font-variant-numeric: tabular-nums; }
  .tip {
    position: absolute; bottom: calc(100% + 6px); transform: translateX(-50%); padding: 5px 9px; border-radius: 8px; white-space: nowrap; pointer-events: none;
    background: var(--bg-3); color: var(--text); font-size: 12.5px; font-weight: 600; box-shadow: 0 6px 20px rgb(0 0 0 / 0.35);
  }
  .table { margin-top: 6px; font-size: 12.5px; color: var(--text-2); }
  .table summary { cursor: pointer; }
  .table table { margin-top: 8px; border-collapse: collapse; }
  .table td { padding: 3px 18px 3px 0; font-variant-numeric: tabular-nums; }

  .top { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .top li { display: flex; align-items: center; gap: 12px; }
  .rank { width: 16px; text-align: right; font-weight: 800; color: var(--text-2); font-variant-numeric: tabular-nums; }
  .tposter { flex-shrink: 0; width: 34px; aspect-ratio: 2 / 3; border-radius: 5px; background: var(--bg-3) center / cover; }
  .tbody { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .tbody a { color: inherit; text-decoration: none; font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tbody a:hover { text-decoration: underline; }
  .top b, .hbars b { font-size: 13px; font-variant-numeric: tabular-nums; min-width: 56px; text-align: right; }
  .meter { display: block; height: 6px; border-radius: 3px; background: color-mix(in srgb, var(--text) 9%, transparent); overflow: hidden; }
  .meter i { display: block; height: 100%; border-radius: 3px; background: var(--accent); }

  .hbars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .hbars li { display: grid; grid-template-columns: 110px 1fr auto; align-items: center; gap: 12px; font-size: 13.5px; }
  .hbars li > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .hours { height: 130px; display: grid; grid-template-columns: repeat(24, 1fr); gap: 2px; align-items: end; border-bottom: 1px solid color-mix(in srgb, var(--text) 14%, transparent); }
  .hcol { height: 100%; display: flex; align-items: flex-end; }
  .hcol i { display: block; width: 100%; border-radius: 3px 3px 0 0; background: var(--accent); }
  .hcol:hover i { filter: brightness(1.2); }
  .hlabels { display: flex; justify-content: space-between; margin-top: 6px; font-size: 11.5px; color: var(--text-2); }
  .foot { font-size: 12px; margin-top: 4px; }
</style>
