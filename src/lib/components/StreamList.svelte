<script lang="ts">
  import { getStreams } from '../stremio/client';
  import { filterAndSort, formatSize, playableUrl, quality, sizeBytes, streamLabel, tags, type StreamSort } from '../stremio/streams';
  import type { MetaDetail, SourcedStream } from '../stremio/types';
  import { play } from '../player';
  import { enabledAddons } from '../stores/addons.svelte';
  import { recordPlay } from '../stores/library.svelte';
  import { settings } from '../stores/settings.svelte';
  import { toast } from '../stores/toast.svelte';
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

  async function start(s: SourcedStream) {
    try {
      await play(s, { title: label ? `${meta.name} — ${label}` : meta.name, type: meta.type, videoId, addons: enabledAddons() });
      recordPlay(meta, videoId, label);
      toast(`Opening in ${settings.player === 'custom' ? 'your player' : settings.player}…`, 'success', 2000);
    } catch (e) {
      toast(String((e as Error).message ?? e), 'error', 6000);
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
    <div>
      <div class="ttl">Streams</div>
      {#if label}<div class="faint lbl">{label}</div>{/if}
    </div>
    <div class="tools">
      <select class="select sm" bind:value={settings.streamSort} aria-label="Sort streams">
        {#each sorts as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
      </select>
      {#if onclose}
        <button class="icon-btn" onclick={onclose} aria-label="Close streams"><Icon name="x" /></button>
      {/if}
    </div>
  </header>

  {#if addonNames.length > 1}
    <div class="addons">
      <button class="pill" class:on={!addonFilter} onclick={() => (addonFilter = '')}>All</button>
      {#each addonNames as n (n)}
        <button class="pill" class:on={addonFilter === n} onclick={() => (addonFilter = n)}>{n}</button>
      {/each}
    </div>
  {/if}

  <div class="list">
    {#each shown as s, i (i + (s.url ?? s.infoHash ?? s.externalUrl ?? '') + s.addonId)}
      {@const l = streamLabel(s)}
      {@const q = quality(s)}
      {@const size = formatSize(sizeBytes(s))}
      <div class="stream" role="button" tabindex="0" onclick={() => start(s)} onkeydown={(e) => e.key === 'Enter' && start(s)}>
        <div class="q" class:hi={q === '4K' || q === '1080p'}>{q === '?' ? '—' : q}</div>
        <div class="body">
          <div class="name">{l.title}</div>
          {#if l.detail}<div class="detail">{l.detail}</div>{/if}
          <div class="meta">
            <span class="chip">{s.addonName}</span>
            {#if size}<span class="chip">{size}</span>{/if}
            {#each tags(s) as t (t)}<span class="chip accent">{t}</span>{/each}
            {#if s.infoHash && !s.url}<span class="chip">P2P</span>{/if}
            {#if s.externalUrl && !s.url && !s.infoHash}<span class="chip">External</span>{/if}
          </div>
        </div>
        <button class="icon-btn copy" title="Copy link" onclick={(e) => { e.stopPropagation(); copy(s); }}><Icon name="copy" size={16} /></button>
        <div class="playicon"><Icon name="play" size={16} fill /></div>
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
      <div class="loading"><div class="spinner"></div> Waiting on {pending} addon{pending === 1 ? '' : 's'}…</div>
    {/if}
  </div>

  {#if hidden > 0 || showAll || errors.length}
    <footer>
      {#if hidden > 0 || showAll}
        <button class="btn ghost sm" onclick={() => (showAll = !showAll)}>
          <Icon name="filter" size={14} />{showAll ? 'Apply filters' : `Show ${hidden} filtered`}
        </button>
      {/if}
      {#if errors.length}<span class="faint err" title={errors.join('\n')}>{errors.length} addon error{errors.length === 1 ? '' : 's'}</span>{/if}
    </footer>
  {/if}
</div>

<style>
  .panel { display: flex; flex-direction: column; min-height: 0; height: 100%; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding-bottom: 12px; }
  .ttl { font-weight: 700; font-size: 16px; }
  .lbl { font-size: 12px; }
  .tools { display: flex; gap: 6px; align-items: center; }
  .select.sm { height: 30px; font-size: 12.5px; width: auto; }
  .addons { display: flex; gap: 6px; flex-wrap: wrap; padding-bottom: 12px; }
  .pill {
    border: 1px solid var(--line); background: none; height: 26px; padding: 0 10px; border-radius: 13px;
    font-size: 12px; cursor: pointer; color: var(--text-2);
  }
  .pill.on { background: var(--accent); border-color: transparent; color: var(--on-accent); }
  .list { overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 6px; padding-right: 4px; }
  .stream {
    display: flex; gap: 12px; align-items: center; padding: 10px 12px; border-radius: 10px; cursor: pointer;
    background: var(--bg-2); border: 1px solid var(--line); transition: border-color var(--dur), background var(--dur);
  }
  .stream:hover, .stream:focus-visible { border-color: var(--accent); background: var(--bg-3); }
  .q {
    width: 52px; flex-shrink: 0; text-align: center; font-weight: 800; font-size: 13px; color: var(--text-2);
    padding: 6px 0; border-radius: 7px; background: var(--bg-3);
  }
  .q.hi { color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent); }
  .body { flex: 1; min-width: 0; }
  .name { font-weight: 600; font-size: 13px; white-space: pre-line; }
  .detail { font-size: 12px; color: var(--text-2); white-space: pre-line; margin-top: 2px; max-height: 3.2em; overflow: hidden; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .copy { opacity: 0; }
  .stream:hover .copy { opacity: 1; }
  .playicon { color: var(--accent); opacity: 0; transition: opacity var(--dur); }
  .stream:hover .playicon { opacity: 1; }
  .loading { display: flex; gap: 10px; align-items: center; padding: 14px 4px; color: var(--text-2); font-size: 13px; }
  .empty { padding: 30px 10px; }
  footer { display: flex; justify-content: space-between; align-items: center; padding-top: 10px; }
  .err { font-size: 12px; cursor: help; }
</style>
