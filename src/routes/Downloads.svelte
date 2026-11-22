<script lang="ts">
  import Icon from '../lib/components/Icon.svelte';
  import {
    downloadFolder,
    downloads,
    pauseDownload,
    playDownload,
    refreshDownloads,
    removeDownload,
    resumeDownload,
    revealDownload,
    type Download,
  } from '../lib/downloads.svelte';
  import { isWatched } from '../lib/stores/library.svelte';
  import { href, go } from '../lib/stores/router.svelte';
  import { settings } from '../lib/stores/settings.svelte';
  import { isTauri } from '../lib/stremio/http';

  $effect(() => {
    void refreshDownloads();
  });

  const active = $derived(downloads.items.filter((d) => d.status !== 'done'));
  const ready = $derived(downloads.items.filter((d) => d.status === 'done'));
  const used = $derived(ready.reduce((n, d) => n + d.size, 0));
  let folder = $state('');
  $effect(() => {
    void settings.downloadDir;
    void downloadFolder().then((f) => (folder = f));
  });

  function bytes(n: number) {
    if (!n) return '0 MB';
    if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`;
    return `${Math.max(1, Math.round(n / 1e6))} MB`;
  }
  function eta(d: Download) {
    if (!d.speed || !d.size || d.done >= d.size) return '';
    const s = (d.size - d.done) / d.speed;
    if (s < 60) return 'less than a minute left';
    if (s < 3600) return `${Math.round(s / 60)} min left`;
    return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min left`;
  }
  const pct = (d: Download) => (d.size ? Math.min(100, (d.done / d.size) * 100) : 0);
  function line(d: Download) {
    if (d.status === 'queued') return d.done ? `Waiting · ${bytes(d.done)} of ${bytes(d.size)}` : 'Waiting to start…';
    if (d.status === 'paused') return `Paused · ${bytes(d.done)}${d.size ? ` of ${bytes(d.size)}` : ''}`;
    if (d.status === 'error') return d.error || 'Something went wrong.';
    if (!d.size) return d.source.kind === 'torrent' ? 'Finding people sharing this…' : 'Starting…';
    return [`${Math.floor(pct(d))}%`, `${bytes(d.done)} of ${bytes(d.size)}`, d.speed ? `${(d.speed / 1e6).toFixed(1)} MB/s` : '', eta(d)]
      .filter(Boolean)
      .join(' · ');
  }

  let confirm = $state('');
  function remove(d: Download) {
    if (confirm !== d.id) {
      confirm = d.id;
      setTimeout(() => confirm === d.id && (confirm = ''), 3500);
      return;
    }
    confirm = '';
    void removeDownload(d, true);
  }
  const detailHref = (d: Download) => href('detail', d.metaType, d.metaId);
</script>

<div class="page">
  <div class="head">
    <h1 class="page-title">Downloads</h1>
    {#if ready.length}<span class="faint">{ready.length} ready · {bytes(used)}</span>{/if}
    <span class="grow"></span>
    {#if isTauri}
      <button class="btn ghost sm" onclick={() => revealDownload(null)} title={folder}><Icon name="folder" size={15} />Open folder</button>
    {/if}
  </div>
  <p class="faint where">Saved to <b>{folder || '…'}</b>. Change it in <a href={href('settings')} onclick={(e) => { e.preventDefault(); go('settings'); }}>Settings → Downloads</a>.</p>

  {#if !downloads.items.length}
    <div class="empty">
      <div class="eicon"><Icon name="download" size={30} /></div>
      <h2>Nothing downloaded yet</h2>
      <p class="faint">Save episodes and movies to watch without buffering or the internet. Use the download button on any source, or ⋯ → Download in the player.</p>
    </div>
  {/if}

  {#if active.length}
    <section>
      <h2>In progress <span class="faint">{active.length}</span></h2>
      <div class="list">
        {#each active as d (d.id)}
          <div class="row" class:err={d.status === 'error'}>
            <a class="art" href={detailHref(d)} style:background-image={d.poster ? `url("${d.poster}")` : undefined} aria-label={d.title}></a>
            <div class="body">
              <div class="t"><b>{d.title}</b>{#if d.subtitle}<span>{d.subtitle}</span>{/if}</div>
              <div class="bar" class:paused={d.status !== 'downloading'}><i style:width="{pct(d)}%"></i></div>
              <div class="st" class:bad={d.status === 'error'}>{line(d)}</div>
            </div>
            <div class="acts">
              {#if d.status === 'downloading' || d.status === 'queued'}
                <button class="icon-btn" onclick={() => pauseDownload(d)} title="Pause" aria-label="Pause"><Icon name="pause" size={17} fill /></button>
              {:else}
                <button class="icon-btn" onclick={() => resumeDownload(d)} title={d.status === 'error' ? 'Try again' : 'Resume'} aria-label="Resume"><Icon name={d.status === 'error' ? 'refresh' : 'download'} size={17} /></button>
              {/if}
              <button class="icon-btn" class:warn={confirm === d.id} onclick={() => remove(d)} title={confirm === d.id ? 'Click again to cancel and delete' : 'Cancel'} aria-label="Cancel download">
                <Icon name={confirm === d.id ? 'trash' : 'x'} size={17} />
              </button>
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if ready.length}
    <section>
      <h2>Ready to watch <span class="faint">{ready.length}</span></h2>
      <div class="grid">
        {#each ready as d (d.id)}
          <div class="card">
            <button class="poster" onclick={() => playDownload(d)} style:background-image={d.poster ? `url("${d.poster}")` : undefined} aria-label="Play {d.subtitle || d.title}">
              <span class="pplay"><Icon name="play" size={22} fill /></span>
              {#if isWatched(d.videoId)}<span class="seen"><Icon name="check" size={12} stroke={3} />Watched</span>{/if}
            </button>
            <div class="cbody">
              <a class="ct" href={detailHref(d)}>{d.title}</a>
              {#if d.subtitle}<div class="cs">{d.subtitle}</div>{/if}
              <div class="cm faint">{bytes(d.size)}</div>
              <div class="cacts">
                <button class="btn sm primary" onclick={() => playDownload(d)}><Icon name="play" size={13} fill />Play</button>
                <button class="icon-btn" onclick={() => revealDownload(d)} title="Show in folder" aria-label="Show in folder"><Icon name="folder" size={16} /></button>
                <button class="icon-btn" class:warn={confirm === d.id} onclick={() => remove(d)} title={confirm === d.id ? 'Click again to delete the file' : 'Delete'} aria-label="Delete download">
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .head { display: flex; align-items: baseline; gap: 14px; }
  .grow { flex: 1; }
  .where { margin: 2px 0 26px; font-size: 13px; }
  .where b { font-weight: 600; color: var(--text-dim, inherit); word-break: break-all; }
  .where a { color: var(--accent); }
  section { margin-bottom: 34px; }
  h2 { font-size: 19px; font-weight: 700; margin: 0 0 12px; display: flex; gap: 8px; align-items: baseline; }
  h2 .faint { font-size: 14px; font-weight: 600; }

  .empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 60px 20px; }
  .empty p { max-width: 46ch; margin: 0; }
  .empty h2 { margin: 8px 0 0; }
  .eicon { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }

  .list { display: flex; flex-direction: column; gap: 8px; max-width: 900px; }
  .row { display: flex; align-items: center; gap: 14px; padding: 10px 12px; border-radius: var(--radius, 12px); background: var(--bg-2); border: 1px solid var(--border, transparent); }
  .row.err { border-color: color-mix(in srgb, #ff5a5a 45%, transparent); }
  .art { flex-shrink: 0; width: 44px; aspect-ratio: 2 / 3; border-radius: 6px; background: var(--bg-3) center / cover; }
  .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 7px; }
  .t { display: flex; gap: 10px; align-items: baseline; min-width: 0; }
  .t b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .t span { color: var(--text-faint, gray); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar { height: 5px; border-radius: 3px; background: color-mix(in srgb, var(--text) 12%, transparent); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--accent); border-radius: 3px; transition: width 600ms linear; }
  .bar.paused i { background: color-mix(in srgb, var(--text) 45%, transparent); }
  .st { font-size: 12.5px; color: var(--text-faint, gray); font-variant-numeric: tabular-nums; }
  .st.bad { color: #ff7a7a; }
  .acts { display: flex; gap: 2px; }
  .warn { color: #ff6b6b !important; background: color-mix(in srgb, #ff5a5a 16%, transparent) !important; }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 12px; }
  .card { display: flex; gap: 14px; padding: 10px; border-radius: var(--radius, 12px); background: var(--bg-2); border: 1px solid var(--border, transparent); }
  .poster {
    position: relative; flex-shrink: 0; width: 92px; aspect-ratio: 2 / 3; border: 0; padding: 0; border-radius: 8px; cursor: pointer;
    background: var(--bg-3) center / cover; overflow: hidden;
  }
  .pplay { position: absolute; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / 0.45); color: #fff; opacity: 0; transition: opacity var(--dur); }
  .poster:hover .pplay, .poster:focus-visible .pplay { opacity: 1; }
  .seen { position: absolute; left: 5px; bottom: 5px; display: inline-flex; gap: 3px; align-items: center; padding: 2px 6px; border-radius: 5px; background: rgb(0 0 0 / 0.75); color: #fff; font: 700 10px var(--font); }
  .cbody { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; padding-top: 2px; }
  .ct { font-weight: 700; color: inherit; text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ct:hover { text-decoration: underline; }
  .cs { font-size: 13.5px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .cm { font-size: 12.5px; }
  .cacts { margin-top: auto; display: flex; align-items: center; gap: 4px; }
  .cacts .btn { margin-right: 4px; }
</style>
