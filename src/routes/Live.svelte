<script lang="ts">
  // Live TV: channels from your M3U playlists, grouped, searchable, with what's on now.
  import Icon from '../lib/components/Icon.svelte';
  import Switch from '../lib/components/Switch.svelte';
  import type { Channel } from '../lib/iptv/m3u';
  import {
    addPlaylist,
    isFavorite,
    live,
    loadChannels,
    loadGuides,
    nowNext,
    refreshPlaylist,
    removePlaylist,
    toggleFavorite,
    tv,
    updatePlaylist,
    xtreamLinks,
    type Playlist,
  } from '../lib/iptv/live.svelte';
  import { playChannel, prepared } from '../lib/iptv/play.svelte';
  import { errorText, playExternal } from '../lib/player';
  import { playback } from '../lib/stores/playback.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import { openMenu } from '../lib/stores/ui.svelte';

  const FAV = '\u0001fav';
  const RECENT = '\u0001recent';

  void loadChannels();

  // ---------- playlists dialog ----------
  let manage = $state(false);
  let mode: 'url' | 'file' | 'xtream' = $state('url');
  let name = $state('');
  let url = $state('');
  let epgUrl = $state('');
  let userAgent = $state('');
  let server = $state('');
  let username = $state('');
  let password = $state('');
  let fileText: string | null = $state(null);
  let fileName = $state('');
  let adding = $state(false);
  let more = $state(false);
  let editing = $state<string | null>(null);
  let busy = $state<string | null>(null);

  const empty = $derived(!live.playlists.length);

  function resetForm() {
    name = url = epgUrl = userAgent = server = username = password = fileName = '';
    fileText = null;
    more = false;
  }

  async function pickFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    fileName = f.name;
    fileText = await f.text();
    if (!name) name = f.name.replace(/\.(m3u8?|txt)$/i, '');
  }

  async function add(e: Event) {
    e.preventDefault();
    adding = true;
    try {
      let p: Playlist;
      if (mode === 'file') {
        if (fileText == null) throw new Error('Choose a playlist file first.');
        p = await addPlaylist({ name, text: fileText, epgUrl, userAgent });
      } else if (mode === 'xtream') {
        if (!server.trim() || !username.trim() || !password.trim()) throw new Error('Enter the server, username and password.');
        const links = xtreamLinks(server, username, password);
        let host = server.trim();
        try {
          host = new URL(links.url).hostname;
        } catch {
          /* keep what was typed */
        }
        p = await addPlaylist({ name: name || host, url: links.url, epgUrl: epgUrl || links.epgUrl, userAgent });
      } else {
        p = await addPlaylist({ name: name || hostOf(url), url, epgUrl, userAgent });
      }
      toast(`Added ${p.name} · ${p.count.toLocaleString()} channels`, 'success');
      resetForm();
      manage = false;
    } catch (err) {
      toast((err as Error).message, 'error', 7000);
    } finally {
      adding = false;
    }
  }

  function hostOf(u: string): string {
    try {
      return new URL(u.trim()).hostname.replace(/^www\./, '');
    } catch {
      return 'Playlist';
    }
  }

  async function refresh(p: Playlist) {
    busy = p.id;
    try {
      await refreshPlaylist(p.id);
      void loadGuides(true);
      toast(`${p.name} updated`, 'success', 2000);
    } catch (e) {
      toast((e as Error).message, 'error', 6000);
    } finally {
      busy = null;
    }
  }

  async function remove(p: Playlist) {
    if (!confirm(`Remove ${p.name}? Its favorites are removed too.`)) return;
    await removePlaylist(p.id);
  }

  const AGO = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  function ago(t: number): string {
    const m = Math.round((t - Date.now()) / 60000);
    if (Math.abs(m) < 60) return AGO.format(m, 'minute');
    const h = Math.round(m / 60);
    if (Math.abs(h) < 48) return AGO.format(h, 'hour');
    return AGO.format(Math.round(h / 24), 'day');
  }

  // ---------- channels ----------
  let query = $state('');
  let groupFilter = $state('');

  const hidden = $derived(new Set(live.hiddenGroups));
  const visibleChannels = $derived(tv.channels.filter((c) => !hidden.has(c.group)));

  const groups = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const c of visibleChannels) counts.set(c.group, (counts.get(c.group) ?? 0) + 1);
    return [...counts].map(([g, n]) => ({ g, n }));
  });
  const shownGroups = $derived(
    groupFilter.trim() ? groups.filter((x) => x.g.toLowerCase().includes(groupFilter.trim().toLowerCase())) : groups,
  );

  const byId = $derived(new Map(tv.channels.map((c) => [c.id, c])));
  const current = $derived(live.group === FAV || live.group === RECENT || live.group === '' || groups.some((x) => x.g === live.group) ? live.group : '');

  const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const list: Channel[] = $derived.by(() => {
    const q = norm(query.trim());
    if (q) {
      const words = q.split(/\s+/);
      return visibleChannels.filter((c) => {
        const hay = norm(`${c.name} ${c.group}`);
        return words.every((w) => hay.includes(w));
      });
    }
    if (current === FAV) return live.favorites.map((id) => byId.get(id)).filter((c): c is Channel => !!c);
    if (current === RECENT) return live.recent.map((id) => byId.get(id)).filter((c): c is Channel => !!c);
    if (current) return visibleChannels.filter((c) => c.group === current);
    return visibleChannels;
  });

  // Render in pages so playlists with thousands of channels stay quick.
  const PAGE = 120;
  let limit = $state(PAGE);
  $effect(() => {
    void list;
    limit = PAGE;
  });
  let sentinel: HTMLDivElement | undefined = $state();
  $effect(() => {
    const el = sentinel;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) limit += PAGE;
    }, { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  });

  function pick(g: string) {
    live.group = g;
    query = '';
    document.querySelector('.live .channels')?.scrollTo({ top: 0 });
  }

  const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const fmt = (t: number) => TIME.format(t);

  function play(c: Channel) {
    void playChannel(c, list);
  }

  function channelMenu(e: MouseEvent, c: Channel) {
    openMenu(
      e,
      [
        { label: 'Play', icon: 'play', run: () => play(c) },
        { label: isFavorite(c.id) ? 'Remove from favorites' : 'Add to favorites', icon: 'star', run: () => toggleFavorite(c.id) },
        {
          label: 'Open in external player',
          icon: 'external',
          run: () => playExternal(prepared(c), c.name).catch((err) => toast(errorText(err), 'error', 6000)),
        },
        {
          label: 'Copy stream link',
          icon: 'copy',
          run: () => navigator.clipboard.writeText(c.url).then(() => toast('Stream link copied', 'success', 1800)),
        },
        ...(c.group ? [{ label: `Hide "${c.group}"`, icon: 'eye', run: () => hideGroup(c.group) }] : []),
      ],
      c.name,
    );
  }

  function hideGroup(g: string) {
    if (!live.hiddenGroups.includes(g)) live.hiddenGroups = [...live.hiddenGroups, g];
    if (live.group === g) live.group = '';
    toast(`Hid "${g}"`, 'info', 4000, { label: 'Undo', run: () => (live.hiddenGroups = live.hiddenGroups.filter((x) => x !== g)) });
  }

  function groupMenu(e: MouseEvent, g: string) {
    openMenu(e, [{ label: 'Hide this group', icon: 'eye', run: () => hideGroup(g) }], g || 'Ungrouped');
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && manage) {
      e.preventDefault();
      manage = false;
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="live" class:empty-state={empty}>
  <header class="head">
    <h1 class="page-title">Live TV</h1>
    {#if !empty}
      <label class="search">
        <Icon name="search" size={16} />
        <input class="input" type="search" placeholder="Search channels" bind:value={query} aria-label="Search channels" />
      </label>
      <button class="btn" onclick={() => (manage = true)}><Icon name="list" size={16} />Playlists</button>
    {/if}
  </header>

  {#if empty}
    <div class="intro">
      <div class="badge"><Icon name="tv" size={30} /></div>
      <h2>Watch live channels</h2>
      <p class="muted">Add an M3U playlist from your TV provider, a link, a file, or an Xtream Codes login. Add a guide (XMLTV) to see what's on.</p>
      {@render addForm()}
    </div>
  {:else}
    <div class="body">
      <aside class="groups">
        <button class="g" class:on={current === ''} onclick={() => pick('')}><Icon name="grid" size={15} /><span>All channels</span><b>{visibleChannels.length.toLocaleString()}</b></button>
        <button class="g" class:on={current === FAV} onclick={() => pick(FAV)}><Icon name="star" size={15} /><span>Favorites</span><b>{live.favorites.filter((f) => byId.has(f)).length}</b></button>
        <button class="g" class:on={current === RECENT} onclick={() => pick(RECENT)}><Icon name="sync" size={15} /><span>Recently watched</span></button>
        {#if groups.length > 1}
          <div class="gsep"></div>
          {#if groups.length > 12}
            <input class="input gfilter" placeholder="Filter groups" bind:value={groupFilter} aria-label="Filter groups" />
          {/if}
          <div class="glist">
            {#each shownGroups as { g, n } (g)}
              <button class="g" class:on={current === g} onclick={() => pick(g)} oncontextmenu={(e) => groupMenu(e, g)} title={g || 'Ungrouped'}>
                <span>{g || 'Ungrouped'}</span><b>{n.toLocaleString()}</b>
              </button>
            {/each}
          </div>
        {/if}
        {#if live.hiddenGroups.length}
          <button class="unhide" onclick={() => (live.hiddenGroups = [])}>{live.hiddenGroups.length} hidden {live.hiddenGroups.length === 1 ? 'group' : 'groups'} · Show</button>
        {/if}
      </aside>

      <section class="channels page">
        {#if tv.loading && !tv.channels.length}
          {#each Array(8) as _, i (i)}<div class="row ghost skeleton"></div>{/each}
        {:else if !list.length}
          <div class="none muted">
            {#if query}No channels match "{query}".
            {:else if current === FAV}Right-click a channel (or use its star) to add it to your favorites.
            {:else if current === RECENT}Channels you watch show up here.
            {:else if live.playlists.every((p) => !p.enabled)}All your playlists are turned off. <button class="link" onclick={() => (manage = true)}>Manage playlists</button>
            {:else}No channels to show.{/if}
          </div>
        {:else}
          {#if query}<div class="count faint">{list.length.toLocaleString()} {list.length === 1 ? 'channel' : 'channels'}</div>{/if}
          {#each list.slice(0, limit) as c (c.id)}
            {@const nn = nowNext(c.id, tv.now)}
            {@const playing = playback.live?.id === c.id}
            {@const fav = isFavorite(c.id)}
            <div
              class="row"
              class:playing
              role="button"
              tabindex="0"
              onclick={() => play(c)}
              onkeydown={(e) => e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), play(c))}
              oncontextmenu={(e) => channelMenu(e, c)}
            >
              <div class="logo">
                {#if c.logo}<img src={c.logo} alt="" loading="lazy" decoding="async" onerror={(ev) => ((ev.currentTarget as HTMLElement).style.display = 'none')} />{/if}
                <span>{c.name.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 2).toUpperCase()}</span>
              </div>
              <div class="main">
                <div class="name">{#if playing}<i class="dot" aria-label="Playing"></i>{/if}{c.name}</div>
                {#if nn.now}
                  <div class="prog" title={nn.now.d ?? nn.now.t}>
                    <span class="pt">{nn.now.t}</span>
                    <span class="faint">{fmt(nn.now.s)}–{fmt(nn.now.e)}</span>
                  </div>
                  <div class="pbar"><i style:width="{Math.min(100, ((tv.now - nn.now.s) / (nn.now.e - nn.now.s)) * 100)}%"></i></div>
                {:else if c.group && (current === '' || current === FAV || current === RECENT || query)}
                  <div class="prog faint">{c.group}</div>
                {/if}
              </div>
              {#if nn.next}
                <div class="next faint" title={nn.next.d ?? nn.next.t}><span>{fmt(nn.next.s)}</span>{nn.next.t}</div>
              {/if}
              <button
                class="star"
                class:on={fav}
                onclick={(e) => { e.stopPropagation(); toggleFavorite(c.id); }}
                aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
                title={fav ? 'Remove from favorites' : 'Add to favorites'}
              ><Icon name="star" size={16} fill={fav} /></button>
            </div>
          {/each}
          {#if limit < list.length}<div class="more" bind:this={sentinel}><div class="spinner"></div></div>{/if}
        {/if}
      </section>
    </div>
  {/if}
</div>

{#if manage}
  <div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && (manage = false)}>
    <div class="dialog card" role="dialog" aria-label="Playlists" aria-modal="true">
      <div class="dh">
        <h2>Playlists</h2>
        <button class="icon-btn" onclick={() => (manage = false)} aria-label="Close"><Icon name="x" size={18} /></button>
      </div>
      <div class="plist">
        {#each live.playlists as p (p.id)}
          <div class="pl" class:off={!p.enabled}>
            <div class="pinfo">
              <div class="pname">{p.name}</div>
              <div class="pmeta faint">
                {p.count.toLocaleString()} channels · {p.source === 'url' ? `updated ${ago(p.updatedAt)}` : 'from a file'}{#if p.epgUrl} · guide{/if}
              </div>
              {#if p.error}<div class="perr">{p.error}</div>{/if}
            </div>
            {#if p.source === 'url'}
              <button class="icon-btn" onclick={() => refresh(p)} disabled={busy === p.id} title="Update now" aria-label="Update {p.name}"><Icon name="refresh" size={16} /></button>
            {/if}
            <button class="icon-btn" onclick={() => (editing = editing === p.id ? null : p.id)} title="Edit" aria-label="Edit {p.name}"><Icon name="settings" size={16} /></button>
            <button class="icon-btn" onclick={() => remove(p)} title="Remove" aria-label="Remove {p.name}"><Icon name="trash" size={16} /></button>
            <Switch checked={p.enabled} label="Use {p.name}" onchange={(on: boolean) => updatePlaylist(p.id, { enabled: on })} />
          </div>
          {#if editing === p.id}
            <form class="edit" onsubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void updatePlaylist(p.id, {
                name: String(f.get('name') ?? '').trim() || p.name,
                epgUrl: String(f.get('epg') ?? '').trim(),
                userAgent: String(f.get('ua') ?? '').trim(),
                ...(p.source === 'url' ? { url: String(f.get('url') ?? '').trim() || p.url } : {}),
              }).catch((err) => toast((err as Error).message, 'error', 6000));
              editing = null;
            }}>
              <label>Name<input class="input" name="name" value={p.name} /></label>
              {#if p.source === 'url'}<label>Playlist link<input class="input" name="url" value={p.url} spellcheck="false" /></label>{/if}
              <label>Guide (XMLTV) link<input class="input" name="epg" value={p.epgUrl} placeholder="Optional" spellcheck="false" /></label>
              <label>User agent<input class="input" name="ua" value={p.userAgent} placeholder="Optional, only if your provider asks for one" spellcheck="false" /></label>
              <div class="erow"><button class="btn ghost sm" type="button" onclick={() => (editing = null)}>Cancel</button><button class="btn primary sm">Save</button></div>
            </form>
          {/if}
        {/each}
      </div>
      <h3>Add a playlist</h3>
      {@render addForm()}
    </div>
  </div>
{/if}

{#snippet addForm()}
  <form class="add" onsubmit={add}>
    <div class="seg" role="tablist">
      <button type="button" class:on={mode === 'url'} onclick={() => (mode = 'url')}>Link</button>
      <button type="button" class:on={mode === 'file'} onclick={() => (mode = 'file')}>File</button>
      <button type="button" class:on={mode === 'xtream'} onclick={() => (mode = 'xtream')}>Xtream Codes</button>
    </div>
    {#if mode === 'url'}
      <input class="input" placeholder="https://provider.example/playlist.m3u" bind:value={url} aria-label="Playlist link" spellcheck="false" />
    {:else if mode === 'file'}
      <label class="file btn">
        <Icon name="upload" size={16} />{fileName || 'Choose an .m3u or .m3u8 file'}
        <input type="file" accept=".m3u,.m3u8,.txt,audio/x-mpegurl,application/x-mpegurl,application/vnd.apple.mpegurl" onchange={pickFile} hidden />
      </label>
    {:else}
      <input class="input" placeholder="Server, e.g. http://provider.example:8080" bind:value={server} aria-label="Server" spellcheck="false" />
      <div class="two">
        <input class="input" placeholder="Username" bind:value={username} aria-label="Username" autocomplete="off" spellcheck="false" />
        <input class="input" type="password" placeholder="Password" bind:value={password} aria-label="Password" autocomplete="off" />
      </div>
    {/if}
    <input class="input" placeholder="Name (optional)" bind:value={name} aria-label="Name" />
    {#if more}
      <input class="input" placeholder={mode === 'xtream' ? 'Guide (XMLTV) link — filled in automatically' : 'Guide (XMLTV) link, optional'} bind:value={epgUrl} aria-label="Guide link" spellcheck="false" />
      <input class="input" placeholder="User agent, only if your provider asks for one" bind:value={userAgent} aria-label="User agent" spellcheck="false" />
    {/if}
    <div class="arow">
      <button type="button" class="link" onclick={() => (more = !more)}>{more ? 'Fewer options' : 'Guide link & more'}</button>
      <button class="btn primary" disabled={adding}>{#if adding}<span class="spinner sm"></span>Loading…{:else}<Icon name="plus" size={16} />Add playlist{/if}</button>
    </div>
  </form>
{/snippet}

<style>
  .live { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .head { display: flex; align-items: center; gap: 12px; padding: 28px var(--page-pad) 0; }
  .head .page-title { margin: 0; flex: 1; }
  .search { position: relative; display: flex; align-items: center; width: min(320px, 40vw); color: var(--text-3); }
  .search :global(svg) { position: absolute; left: 11px; pointer-events: none; }
  .search .input { width: 100%; padding-left: 34px; }

  .intro { max-width: 520px; margin: 7vh auto 0; padding: 0 20px; text-align: center; }
  .intro .badge { width: 64px; height: 64px; margin: 0 auto 14px; border-radius: 18px; display: grid; place-items: center; background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
  .intro h2 { margin: 0 0 6px; font-size: 22px; }
  .intro p { margin: 0 0 22px; line-height: 1.5; }
  .intro .add { text-align: left; }

  .body { flex: 1; min-height: 0; display: flex; gap: 8px; padding: 18px 0 0 var(--page-pad); }
  .groups { width: 230px; flex-shrink: 0; display: flex; flex-direction: column; gap: 2px; min-height: 0; padding-bottom: 24px; }
  .glist { overflow-y: auto; min-height: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; padding-right: 4px; }
  .gsep { height: 1px; background: var(--line); margin: 8px 4px; flex-shrink: 0; }
  .gfilter { margin: 0 0 6px; height: 32px; font-size: 13px; flex-shrink: 0; }
  .g {
    display: flex; align-items: center; gap: 9px; border: 0; background: none; color: var(--text-2); cursor: pointer; text-align: left;
    padding: 7px 10px; border-radius: min(var(--btn-radius), 9px); font: 600 13.5px var(--font); flex-shrink: 0;
  }
  .g span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .g b { font-size: 11.5px; font-weight: 600; color: var(--text-3); }
  .g:hover { background: var(--bg-3); color: var(--text); }
  .g.on { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); }
  .g.on b { color: inherit; }
  .unhide { margin-top: 8px; border: 0; background: none; color: var(--text-3); font: 600 12px var(--font); cursor: pointer; text-align: left; padding: 4px 10px; }
  .unhide:hover { color: var(--text); }

  .channels { flex: 1; min-width: 0; padding-top: 0; display: flex; flex-direction: column; gap: 6px; }
  .count { font-size: 12.5px; margin: 0 0 4px 2px; }
  .none { padding: 50px 10px; text-align: center; }
  .row {
    display: flex; align-items: center; gap: 14px; padding: 8px 12px 8px 8px; border-radius: 12px; cursor: pointer; flex-shrink: 0;
    background: var(--bg-2); border: 1px solid var(--line); transition: border-color var(--dur), background var(--dur);
    content-visibility: auto; contain-intrinsic-size: auto 66px;
  }
  .row:hover, .row:focus-visible { border-color: color-mix(in srgb, var(--accent) 55%, transparent); background: var(--bg-3); outline: none; }
  .row.playing { border-color: var(--accent); }
  .row.ghost { height: 66px; cursor: default; }
  .logo { position: relative; width: 74px; height: 48px; flex-shrink: 0; border-radius: 8px; background: var(--bg-3); display: grid; place-items: center; overflow: hidden; }
  .logo span { font: 800 15px var(--font-display); color: var(--text-3); letter-spacing: 0.02em; }
  .logo img { position: absolute; inset: 5px; width: calc(100% - 10px); height: calc(100% - 10px); object-fit: contain; background: var(--bg-3); }
  .main { flex: 1; min-width: 0; }
  .name { font-weight: 700; font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 7px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex-shrink: 0; box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); }
  .prog { font-size: 12.5px; color: var(--text-2); margin-top: 2px; display: flex; gap: 8px; white-space: nowrap; overflow: hidden; }
  .pt { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .prog .faint { flex-shrink: 0; }
  .pbar { height: 3px; border-radius: 2px; background: var(--bg-3); margin-top: 6px; max-width: 320px; overflow: hidden; }
  .pbar i { display: block; height: 100%; background: var(--accent); border-radius: inherit; }
  .next { width: 220px; flex-shrink: 0; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .next span { font-weight: 700; margin-right: 7px; color: var(--text-2); }
  .star { border: 0; background: none; color: var(--text-3); cursor: pointer; padding: 6px; border-radius: 8px; display: grid; opacity: 0; transition: opacity var(--dur); }
  .row:hover .star, .row:focus-within .star, .star.on { opacity: 1; }
  .star.on { color: var(--accent); }
  .star:hover { background: var(--bg-2); color: var(--text); }
  .more { display: grid; place-items: center; padding: 18px; }
  @media (max-width: 980px) { .next { display: none; } }
  @media (max-width: 720px) { .groups { width: 170px; } }

  .link { border: 0; background: none; color: var(--accent); cursor: pointer; font: 600 13px var(--font); padding: 0; }

  .add { display: flex; flex-direction: column; gap: 10px; }
  .add .seg { align-self: flex-start; }
  .two { display: flex; gap: 10px; }
  .two .input { flex: 1; min-width: 0; }
  .file { justify-content: flex-start; overflow: hidden; white-space: nowrap; }
  .arow { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 2px; }
  .spinner.sm { width: 14px; height: 14px; border-width: 2px; }

  .scrim { position: fixed; inset: 0; z-index: 60; background: rgb(0 0 0 / 0.55); display: grid; place-items: center; padding: 20px; }
  .dialog { width: min(560px, 100%); max-height: calc(100vh - 80px); overflow-y: auto; padding: 18px 20px 20px; box-shadow: 0 24px 60px rgb(0 0 0 / 0.5); }
  .dh { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .dh h2 { margin: 0; font-size: 19px; }
  .dialog h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-2); margin: 20px 0 10px; }
  .plist { display: flex; flex-direction: column; gap: 6px; }
  .pl { display: flex; align-items: center; gap: 6px; padding: 10px 10px 10px 12px; border-radius: 10px; background: var(--bg-3); }
  .pl.off .pinfo { opacity: 0.55; }
  .pinfo { flex: 1; min-width: 0; }
  .pname { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pmeta { font-size: 12px; margin-top: 2px; }
  .perr { font-size: 12px; color: var(--danger, #ff6b6b); margin-top: 3px; }
  .edit { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px 12px; margin: -2px 0 4px; border-radius: 0 0 10px 10px; background: var(--bg-3); }
  .edit label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--text-2); }
  .erow { display: flex; justify-content: flex-end; gap: 8px; }
</style>
