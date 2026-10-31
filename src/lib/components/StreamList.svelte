<script lang="ts">
  import { getStreams } from '../stremio/client';
  import { describe, filterAndSort, playableUrl, quality, tags, type StreamSort } from '../stremio/streams';
  import { dragScroll } from '../actions/dragScroll';
  import type { MetaDetail, SourcedStream } from '../stremio/types';
  import { errorText, installMpv, isNeedMpvError, isNoPlayerError, playExternal, prepare } from '../player';
  import { openPlayer } from '../stores/playback.svelte';
  import { isTauri } from '../stremio/http';
  import { enabledAddons } from '../stores/addons.svelte';
  import { recordPlay } from '../stores/library.svelte';
  import { settings } from '../stores/settings.svelte';
  import { dismiss, toast } from '../stores/toast.svelte';
  import Icon from './Icon.svelte';
  import { untrack } from 'svelte';

  let {
    meta,
    videoId,
    label,
    onclose,
  }: { meta: MetaDetail; videoId: string; label: string; onclose?: () => void } = $props();

  let streams: SourcedStream[] = $state([]);
  let pending = $state(0);
  let errors: string[] = $state([]);
  let showAll = $state(false);
  let autoPlayed = false;

  const addonOrder = $derived(enabledAddons().map((a) => a.manifest.id));
  const visible = $derived(
    filterAndSort(
      streams,
      showAll
        ? { hideCam: false, excludeKeywords: [], qualities: [], onlyDirect: false }
        : {
            hideCam: settings.hideCam,
            excludeKeywords: settings.excludeKeywords.split(','),
            qualities: settings.qualities,
            onlyDirect: settings.onlyDirect,
          },
      settings.streamSort,
      addonOrder,
    ),
  );
  const hidden = $derived(streams.length - visible.length);
  const addonNames = $derived([...new Set(visible.map((s) => s.addonName))]);
  let addonFilter = $state('');
  const shown = $derived(addonFilter ? visible.filter((s) => s.addonName === addonFilter) : visible);

  $effect(() => {
    const id = videoId;
    streams = [];
    errors = [];
    addonFilter = '';
    autoPlayed = false;
    let live = true;
    getStreams(untrack(enabledAddons), meta.type, id, (s, p, e) => {
      if (!live) return;
      streams = s;
      pending = p;
      errors = e;
    }).then(() => {
      if (live && settings.autoPlayBest && !autoPlayed && visible.length) {
        autoPlayed = true;
        start(visible[0]);
      }
    });
    return () => {
      live = false;
    };
  });

  let installing = false;

  async function start(s: SourcedStream) {
    try {
      const prepared = await prepare(s, { title: meta.name, type: meta.type, videoId, addons: enabledAddons() });
      if (!prepared) return; // opened in the browser
      if (settings.playIn === 'ripple' && isTauri) {
        await openPlayer(prepared, { title: meta.name, subtitle: label, meta, videoId });
      } else {
        await playExternal(prepared, label ? `${meta.name} — ${label}` : meta.name);
        recordPlay(meta, videoId, label);
        toast('Opening player…', 'success', 2000);
      }
    } catch (e) {
      if (isNeedMpvError(e) || isNoPlayerError(e)) {
        toast(errorText(e), 'error', 12000, { label: 'Install mpv', run: () => installThenPlay(s) });
      } else {
        toast(errorText(e), 'error', 6000);
      }
    }
  }

  async function installThenPlay(s: SourcedStream) {
    if (installing) return;
    installing = true;
    const id = toast('Installing mpv… this can take a minute.', 'info', 120000);
    try {
      await installMpv();
      dismiss(id);
      toast('mpv installed', 'success', 2500);
      await start(s);
    } catch (e) {
      dismiss(id);
      toast(errorText(e), 'error', 9000);
    } finally {
      installing = false;
    }
  }

  async function copy(s: SourcedStream) {
    const url = playableUrl(s, settings.streamingServer) ?? s.externalUrl;
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast('Stream link copied', 'success', 1800);
  }

  const sorts: { id: StreamSort; label: string }[] = [
    { id: 'quality', label: 'Best quality' },
    { id: 'addon', label: 'Addon order' },
    { id: 'size-desc', label: 'Largest' },
    { id: 'size-asc', label: 'Smallest' },
  ];
</script>

<div class="panel">
  <header>
    <div class="head-text">
      <div class="ttl">Streams</div>
      <div class="sub">
        {#if label}{label} · {/if}{visible.length} source{visible.length === 1 ? '' : 's'}{#if pending > 0}<span class="dots" aria-label="loading"></span>{/if}
      </div>
    </div>
    <select class="select sm" bind:value={settings.streamSort} aria-label="Sort streams">
      {#each sorts as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
    </select>
    {#if onclose}
      <button class="icon-btn" onclick={onclose} aria-label="Close streams"><Icon name="x" /></button>
    {/if}
  </header>

  {#if addonNames.length > 1}
    <div class="addons" use:dragScroll>
      <button class="pill" class:on={!addonFilter} onclick={() => (addonFilter = '')}>All <b>{visible.length}</b></button>
      {#each addonNames as n (n)}
        <button class="pill" class:on={addonFilter === n} onclick={() => (addonFilter = n)} title={n}>
          {n}<b>{visible.filter((x) => x.addonName === n).length}</b>
        </button>
      {/each}
    </div>
  {/if}

  <div class="list">
    {#each shown as s, i (i + (s.url ?? s.infoHash ?? s.externalUrl ?? '') + s.addonId)}
      {@const d = describe(s)}
      {@const q = quality(s)}
      {@const t = tags(s).filter((x) => x !== 'Cached')}
      {@const web = !!s.externalUrl && !s.url && !s.infoHash}
      <div
        class="stream"
        role="button"
        tabindex="0"
        title={d.full}
        onclick={() => start(s)}
        onkeydown={(e) => e.key === 'Enter' && start(s)}
      >
        <div class="q" class:uhd={q === '4K'} class:fhd={q === '1080p'} class:low={q === 'CAM' || (q === '?' && !web)}>{web ? 'Link' : q === '?' ? '—' : q}</div>
        <div class="body">
          <div class="line1">
            <span class="src">{d.source}</span>
            {#if d.service}<span class="svc" class:cached={d.cached} title={d.cached ? 'Cached on your debrid service — starts instantly' : 'Debrid'}>{#if d.cached}⚡{/if}{d.service}</span>{/if}
          </div>
          {#if d.file && d.file !== d.source}<div class="file">{d.file}</div>{/if}
          <div class="meta">
            {#if d.size}<span>{d.size}</span>{/if}
            {#if d.seeders !== null}<span>{d.seeders} seeds</span>{/if}
            {#each t as tag (tag)}<span class="tag">{tag}</span>{/each}
            {#if s.infoHash && !s.url}<span class="tag muted">P2P</span>{/if}
            {#if web}<span>Opens in your browser</span>{/if}
          </div>
        </div>
        <div class="actions">
          <button class="icon-btn" title="Copy link" onclick={(e) => { e.stopPropagation(); copy(s); }}><Icon name="copy" size={15} /></button>
          <span class="play"><Icon name="play" size={14} fill /></span>
        </div>
      </div>
    {:else}
      {#if pending === 0}
        <div class="empty">
          {#if streams.length}
            All {streams.length} streams are hidden by your filters.
          {:else if errors.length}
            No streams. Some addons failed.
          {:else}
            No streams found. Install a stream addon from the Addons page.
          {/if}
        </div>
      {/if}
    {/each}
    {#if pending > 0}
      {#each Array(shown.length ? 1 : 4) as _, i (i)}<div class="stream ghost skeleton"></div>{/each}
    {/if}

    {#if hidden > 0 || showAll || errors.length}
      <div class="foot">
        {#if hidden > 0 || showAll}
          <button class="btn ghost sm" onclick={() => (showAll = !showAll)}>
            <Icon name="filter" size={14} />{showAll ? 'Hide filtered' : `Show ${hidden} hidden by filters`}
          </button>
        {/if}
        {#if errors.length}<span class="err" title={errors.join('\n')}>{errors.length} addon{errors.length === 1 ? '' : 's'} didn't respond</span>{/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .panel { display: flex; flex-direction: column; min-height: 0; height: 100%; }
  header { display: flex; align-items: center; gap: 8px; padding: 2px 2px 12px; }
  .head-text { flex: 1; min-width: 0; }
  .ttl { font-family: var(--font-display); font-weight: 800; font-size: 17px; letter-spacing: -0.01em; }
  .sub { font-size: 12px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dots::after { content: '…'; display: inline-block; width: 1em; animation: dots 1.2s steps(4) infinite; overflow: hidden; vertical-align: bottom; }
  @keyframes dots { from { width: 0; } to { width: 1.2em; } }
  .select.sm { height: 30px; font-size: 12.5px; width: auto; padding-left: 10px; }

  .addons { display: flex; gap: 6px; overflow-x: auto; padding: 0 2px 12px; scrollbar-width: none; flex-shrink: 0; }
  .addons::-webkit-scrollbar { display: none; }
  .pill {
    display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; max-width: 200px;
    border: 1px solid var(--line); background: none; height: 28px; padding: 0 11px; border-radius: 14px;
    font-size: 12px; font-weight: 600; cursor: pointer; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    transition: background var(--dur), color var(--dur), border-color var(--dur);
  }
  .pill:hover { color: var(--text); border-color: var(--text-3); }
  .pill b { font-weight: 700; font-size: 11px; opacity: 0.6; }
  .pill.on { background: var(--accent); border-color: transparent; color: var(--on-accent); }
  .pill.on b { opacity: 0.8; }

  .list { overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 4px; margin: 0 -6px; padding: 0 6px 4px; }
  .stream {
    position: relative; display: flex; gap: 12px; align-items: center; padding: 11px 10px 11px 12px; border-radius: 12px; cursor: pointer;
    background: color-mix(in srgb, var(--text) 3.5%, transparent); border: 1px solid transparent;
    transition: background var(--dur), border-color var(--dur);
  }
  .stream:hover, .stream:focus-visible { background: color-mix(in srgb, var(--text) 7%, transparent); border-color: color-mix(in srgb, var(--accent) 55%, transparent); outline: none; }
  .stream.ghost { height: 68px; cursor: default; border: 0; }

  .q {
    width: 52px; height: 26px; flex-shrink: 0; align-self: flex-start; margin-top: 1px; display: grid; place-items: center;
    border-radius: 7px; font-size: 11.5px; font-weight: 800; letter-spacing: 0.03em;
    color: var(--text-2); background: var(--bg-3); border: 1px solid var(--line);
  }
  .q.uhd { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
  .q.fhd { color: var(--text); }
  .q.low { opacity: 0.6; }

  .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .line1 { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .src { font-weight: 700; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .svc {
    flex-shrink: 0; font-size: 10px; font-weight: 800; letter-spacing: 0.04em; padding: 1px 5px; border-radius: 5px;
    color: var(--text-2); border: 1px solid var(--line);
  }
  .svc.cached { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); background: color-mix(in srgb, var(--ok) 10%, transparent); }
  .file { font-size: 12px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; margin-top: 3px; font-size: 11.5px; color: var(--text-3); font-weight: 600; }
  .meta > span:not(.tag):not(.from) + span:not(.tag):not(.from)::before { content: '·'; margin: 0 6px 0 -4px; }
  .tag { padding: 1px 6px; border-radius: 5px; font-size: 10.5px; font-weight: 800; letter-spacing: 0.03em; background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
  .tag.muted { background: var(--bg-3); color: var(--text-2); }

  /* Hover actions float over the row's right edge so text can use the full width. */
  .actions {
    position: absolute; right: 8px; top: 50%; transform: translateY(-50%); display: flex; align-items: center; gap: 2px;
    padding-left: 28px; border-radius: 0 12px 12px 0; pointer-events: none;
    background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--bg-2) 92%, transparent) 30%);
    opacity: 0; transition: opacity var(--dur);
  }
  .stream:hover .actions, .stream:focus-visible .actions { opacity: 1; pointer-events: auto; }
  .actions .icon-btn { width: 30px; height: 30px; }
  .play {
    width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: var(--on-accent);
    opacity: 0; transform: scale(0.85); transition: opacity var(--dur), transform var(--dur);
  }
  .stream:hover .play, .stream:focus-visible .play { opacity: 1; transform: none; }

  .empty { padding: 30px 10px; text-align: center; color: var(--text-2); }
  .foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 2px 2px; flex-wrap: wrap; }
  .err { font-size: 12px; color: var(--text-3); cursor: help; }
</style>
