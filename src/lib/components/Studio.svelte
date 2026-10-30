<script lang="ts">
  import Icon from './Icon.svelte';
  import Switch from './Switch.svelte';
  import { NAV_META } from './Nav.svelte';
  import { boardCatalogs, syncRows } from '../home';
  import { addons } from '../stores/addons.svelte';
  import { settings, type RowDisplay } from '../stores/settings.svelte';
  import { toast } from '../stores/toast.svelte';
  import { ui, type StudioTab } from '../stores/ui.svelte';
  import { ACCENTS, FONTS, PRESETS, presetById, type Palette } from '../theme/presets';
  import {
    applyPreset,
    loadFontPreviews,
    applyTheme,
    deleteTheme,
    look,
    parseThemeFile,
    resetLook,
    saveCurrentTheme,
    themeFile,
    themes,
    type SavedTheme,
  } from '../theme/look.svelte';

  const TABS: { id: StudioTab; label: string; icon: string }[] = [
    { id: 'look', label: 'Look', icon: 'palette' },
    { id: 'layout', label: 'Layout', icon: 'layout' },
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'code', label: 'CSS', icon: 'code' },
    { id: 'themes', label: 'Themes', icon: 'download' },
  ];

  const COLOR_FIELDS: { key: keyof Palette; label: string }[] = [
    { key: 'accent', label: 'Accent' },
    { key: 'bg', label: 'Background' },
    { key: 'surface', label: 'Surface' },
    { key: 'surface2', label: 'Raised' },
    { key: 'line', label: 'Borders' },
    { key: 'text', label: 'Text' },
    { key: 'text2', label: 'Muted text' },
  ];

  // ---------- helpers ----------
  function readFile(file: File, maxMb: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (file.size > maxMb * 1024 * 1024) return reject(new Error(`File is over ${maxMb} MB.`));
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  async function pickFont(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      look.customFont = { name: file.name.replace(/\.[^.]+$/, ''), dataUrl: await readFile(file, 3) };
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function pickBg(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      look.bgImage = await readFile(file, 4);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  function moveNav(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= look.navItems.length) return;
    const next = [...look.navItems];
    [next[i], next[j]] = [next[j], next[i]];
    look.navItems = next;
  }

  // ---------- home rows ----------
  const available = $derived(boardCatalogs(addons.list, settings.hideAdultAddons));
  // Edits address rows by their index in the full saved list (which also keeps rows of disabled addons).
  const rows = $derived(
    syncRows(settings.homeRows, available)
      .map((r, idx) => ({ ...r, idx, cat: available.find((b) => b.key === r.key)! }))
      .filter((r) => r.cat),
  );
  function editRows(fn: (rows: typeof settings.homeRows) => void) {
    const next = syncRows($state.snapshot(settings.homeRows), available);
    fn(next);
    settings.homeRows = next;
  }
  let dragRow: number | null = $state(null);

  // ---------- themes ----------
  let themeName = $state('');
  let importInput: HTMLInputElement | undefined = $state();

  function download(name: string, text: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function exportTheme(t: SavedTheme) {
    download(`${t.name.replace(/[^\w-]+/g, '-').toLowerCase()}.ripplestyle`, themeFile(t));
  }
  async function importTheme(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const t = parseThemeFile(await file.text());
      themes.list.unshift(t);
      applyTheme(t);
      toast(`Imported and applied “${t.name}”`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    (e.currentTarget as HTMLInputElement).value = '';
  }

  $effect(() => {
    if (ui.studioOpen && ui.studioTab === 'look') loadFontPreviews();
  });

  const modified = $derived.by(() => {
    const p = presetById(look.preset);
    return !!p && (Object.keys(p.colors) as (keyof Palette)[]).some((k) => p.colors[k].toLowerCase() !== look.colors[k].toLowerCase());
  });
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && ui.studioOpen && (ui.studioOpen = false)} />

<aside class="studio" class:open={ui.studioOpen} aria-label="Customize" inert={!ui.studioOpen}>
  <header>
    <div>
      <div class="ttl">Customize</div>
      <div class="faint small">Changes apply live</div>
    </div>
    <button class="icon-btn" onclick={() => (ui.studioOpen = false)} aria-label="Close"><Icon name="x" /></button>
  </header>

  <div class="tabs">
    {#each TABS as t (t.id)}
      <button class:on={ui.studioTab === t.id} onclick={() => (ui.studioTab = t.id)}>
        <Icon name={t.icon} size={16} />{t.label}
      </button>
    {/each}
  </div>

  <div class="body">
    {#if ui.studioTab === 'look'}
      {#each [{ label: 'Dark', items: PRESETS.filter((p) => !p.light) }, { label: 'Light', items: PRESETS.filter((p) => p.light) }] as group (group.label)}
        <h3>{group.label} themes</h3>
        <div class="presets">
          {#each group.items as p (p.id)}
            {@const c = p.colors}
            <button class="preset" class:on={look.preset === p.id} onclick={() => applyPreset(p.id)} aria-pressed={look.preset === p.id}>
              <span class="mock" style:background={c.bg} style:border-color={c.line}>
                <span class="m-rail" style:background={c.surface}></span>
                <span class="m-hero" style:background={c.surface2}>
                  <span class="m-line" style:background={c.text}></span>
                  <span class="m-line short" style:background={c.text2}></span>
                  <span class="m-btn" style:background={c.accent}></span>
                </span>
                <span class="m-cards">
                  <i style:background={c.surface2}></i><i style:background={c.surface2}></i><i style:background={c.surface2}></i><i style:background={c.surface2}></i>
                </span>
              </span>
              <span class="pname">
                <span class="dot" style:background={c.accent}></span>{p.name}
                {#if look.preset === p.id}<span class="check"><Icon name="check" size={12} stroke={3} /></span>{/if}
              </span>
            </button>
          {/each}
        </div>
      {/each}

      <h3>Accent</h3>
      <div class="accents">
        {#each ACCENTS as a (a)}
          <button class="acc" class:on={look.colors.accent.toLowerCase() === a} style:--c={a} aria-label={`Accent ${a}`} onclick={() => (look.colors.accent = a)}></button>
        {/each}
        <label class="acc custom" title="Custom accent" class:on={!ACCENTS.includes(look.colors.accent.toLowerCase())}>
          <input type="color" bind:value={look.colors.accent} />
        </label>
      </div>

      <details class="fine" open={modified}>
        <summary>
          Fine-tune colors
          {#if modified}<button class="link" onclick={(e) => { e.preventDefault(); applyPreset(look.preset); }}>Reset to {presetById(look.preset)?.name}</button>{/if}
        </summary>
        <div class="colors">
          {#each COLOR_FIELDS as f (f.key)}
            <label class="color">
              <span class="cw"><input type="color" bind:value={look.colors[f.key]} /></span>
              <span class="cl">{f.label}<input class="hex" bind:value={look.colors[f.key]} spellcheck="false" maxlength="9" aria-label={`${f.label} hex`} /></span>
            </label>
          {/each}
        </div>
      </details>

      <h3>Font</h3>
      <div class="fonts">
        {#each FONTS as f (f.id)}
          <button class="font" class:on={look.font === f.id && !look.customFont} onclick={() => { look.font = f.id; look.customFont = null; }}>
            <span class="aa" style:font-family={f.display ?? f.body}>Aa</span>
            <span class="fname" style:font-family={f.body}>{f.name}</span>
          </button>
        {/each}
      </div>
      <div class="row">
        {#if look.customFont}
          <span class="chip accent">Custom: {look.customFont.name}</span>
          <button class="btn sm" onclick={() => (look.customFont = null)}>Remove</button>
        {:else}
          <label class="btn sm ghost"><Icon name="upload" size={14} />Use my own font file
            <input type="file" accept=".ttf,.otf,.woff,.woff2" hidden onchange={pickFont} />
          </label>
        {/if}
      </div>

      <h3>Size &amp; shape</h3>
      <label class="slider"><span>UI scale</span><input type="range" min="0.8" max="1.3" step="0.05" bind:value={look.uiScale} /><b>{Math.round(look.uiScale * 100)}%</b></label>
      <label class="slider"><span>Roundness</span><input type="range" min="0" max="26" step="1" bind:value={look.radius} /><b>{look.radius}px</b></label>
      <div class="opt"><span>Buttons</span>
        <div class="seg">
          {#each [['rounded', 'Rounded'], ['pill', 'Pill'], ['square', 'Square']] as [v, l] (v)}
            <button class:on={look.buttonStyle === v} onclick={() => (look.buttonStyle = v as typeof look.buttonStyle)}>{l}</button>
          {/each}
        </div>
      </div>

      <h3>Background</h3>
      <div class="opt"><span>Effect</span>
        <div class="seg">
          {#each [['none', 'None'], ['aurora', 'Aurora'], ['bokeh', 'Bokeh']] as [v, l] (v)}
            <button class:on={look.bgAnimation === v} onclick={() => (look.bgAnimation = v as typeof look.bgAnimation)}>{l}</button>
          {/each}
        </div>
      </div>
      <div class="row">
        <input class="input" placeholder="Image URL (https://…)" value={look.bgImage.startsWith('data:') ? '' : look.bgImage}
          onchange={(e) => (look.bgImage = e.currentTarget.value.trim())} />
        <label class="btn sm" title="Choose an image file"><Icon name="image" size={14} />File
          <input type="file" accept="image/*" hidden onchange={pickBg} />
        </label>
        {#if look.bgImage}<button class="icon-btn" title="Remove image" onclick={() => (look.bgImage = '')}><Icon name="x" size={16} /></button>{/if}
      </div>
      {#if look.bgImage}
        <label class="slider"><span>Dim</span><input type="range" min="0" max="0.95" step="0.05" bind:value={look.bgDim} /><b>{Math.round(look.bgDim * 100)}%</b></label>
        <label class="slider"><span>Blur</span><input type="range" min="0" max="40" step="1" bind:value={look.bgBlur} /><b>{look.bgBlur}px</b></label>
      {/if}
      <div class="toggle"><span>Reduce motion</span><Switch bind:checked={look.reduceMotion} label="Reduce motion" /></div>

    {:else if ui.studioTab === 'layout'}
      <h3>Navigation</h3>
      <div class="navs">
        {#each [['sidebar', 'Sidebar'], ['rail', 'Rail'], ['icons', 'Icons'], ['top', 'Top bar'], ['dock', 'Dock']] as [v, l] (v)}
          <button class="navopt" class:on={look.nav === v} onclick={() => (look.nav = v as typeof look.nav)}>
            <span class="mini {v}"><i></i><b></b></span>{l}
          </button>
        {/each}
      </div>
      {#if look.nav === 'dock'}
        <label class="slider"><span>Dock opacity</span><input type="range" min="0.5" max="1" step="0.02" bind:value={look.dockOpacity} /><b>{Math.round(look.dockOpacity * 100)}%</b></label>
      {/if}
      <div class="list">
        {#each look.navItems as n, i (n.id)}
          <div class="li" class:off={!n.visible}>
            <label class="toggle grow"><input type="checkbox" bind:checked={n.visible} /><Icon name={NAV_META[n.id].icon} size={16} />{NAV_META[n.id].label}</label>
            <button class="icon-btn" disabled={i === 0} onclick={() => moveNav(i, -1)} aria-label="Move up"><Icon name="up" size={15} /></button>
            <button class="icon-btn" disabled={i === look.navItems.length - 1} onclick={() => moveNav(i, 1)} aria-label="Move down"><Icon name="down" size={15} /></button>
          </div>
        {/each}
      </div>

      <h3>Cards</h3>
      <div class="opt"><span>Style</span>
        <div class="seg">
          {#each [['plain', 'Plain'], ['outlined', 'Outlined'], ['elevated', 'Raised'], ['glass', 'Glass'], ['overlay', 'Overlay']] as [v, l] (v)}
            <button class:on={look.cardStyle === v} onclick={() => (look.cardStyle = v as typeof look.cardStyle)}>{l}</button>
          {/each}
        </div>
      </div>
      <div class="opt"><span>Hover</span>
        <div class="seg">
          {#each [['lift', 'Lift'], ['zoom', 'Zoom'], ['glow', 'Glow'], ['none', 'None']] as [v, l] (v)}
            <button class:on={look.hover === v} onclick={() => (look.hover = v as typeof look.hover)}>{l}</button>
          {/each}
        </div>
      </div>
      <div class="opt"><span>Size</span>
        <div class="seg">
          {#each [['small', 'S'], ['medium', 'M'], ['large', 'L'], ['xl', 'XL']] as [v, l] (v)}
            <button class:on={look.posterSize === v} onclick={() => (look.posterSize = v as typeof look.posterSize)}>{l}</button>
          {/each}
        </div>
      </div>
      <div class="opt"><span>Spacing</span>
        <div class="seg">
          {#each [['compact', 'Compact'], ['cozy', 'Cozy'], ['comfy', 'Roomy']] as [v, l] (v)}
            <button class:on={look.density === v} onclick={() => (look.density = v as typeof look.density)}>{l}</button>
          {/each}
        </div>
      </div>
      <div class="toggle"><span>Titles under cards</span><Switch bind:checked={look.showTitles} label="Titles under cards" /></div>
      <div class="toggle"><span>IMDb rating badges</span><Switch bind:checked={look.showRatings} label="IMDb rating badges" /></div>

      <h3>Title pages</h3>
      <div class="opt"><span>Layout</span>
        <div class="seg">
          {#each [['cinematic', 'Cinematic'], ['classic', 'Classic']] as [v, l] (v)}
            <button class:on={look.detailLayout === v} onclick={() => (look.detailLayout = v as typeof look.detailLayout)}>{l}</button>
          {/each}
        </div>
      </div>
      <div class="opt"><span>Episodes</span>
        <div class="seg">
          {#each [['list', 'List'], ['grid', 'Grid']] as [v, l] (v)}
            <button class:on={look.episodeLayout === v} onclick={() => (look.episodeLayout = v as typeof look.episodeLayout)}>{l}</button>
          {/each}
        </div>
      </div>
      <label class="slider"><span>Backdrop</span><input type="range" min="0" max="1" step="0.05" bind:value={look.backdropStrength} /><b>{Math.round(look.backdropStrength * 100)}%</b></label>
      <div class="toggle"><span>Show cast</span><Switch bind:checked={look.showCast} label="Show cast" /></div>

    {:else if ui.studioTab === 'home'}
      <h3>Hero banner</h3>
      <div class="opt"><span>Style</span>
        <div class="seg">
          {#each [['full', 'Full'], ['compact', 'Compact'], ['off', 'Off']] as [v, l] (v)}
            <button class:on={look.hero === v} onclick={() => (look.hero = v as typeof look.hero)}>{l}</button>
          {/each}
        </div>
      </div>
      {#if look.hero !== 'off'}
        <div class="opt"><span>Source</span>
          <select class="select" bind:value={look.heroSource}>
            <option value="">First home row</option>
            {#each available as b (b.key)}<option value={b.key}>{b.title} · {b.addon.manifest.name}</option>{/each}
          </select>
        </div>
        <label class="slider"><span>Rotate</span><input type="range" min="0" max="20" step="1" bind:value={look.heroInterval} /><b>{look.heroInterval ? look.heroInterval + 's' : 'Off'}</b></label>
      {/if}

      <h3>Continue watching</h3>
      <div class="toggle"><span>Show row</span><Switch bind:checked={settings.showContinueWatching} label="Show row" /></div>
      <div class="opt"><span>Cards</span>
        <div class="seg">
          {#each [['wide', 'Wide'], ['poster', 'Posters']] as [v, l] (v)}
            <button class:on={look.cwStyle === v} onclick={() => (look.cwStyle = v as typeof look.cwStyle)}>{l}</button>
          {/each}
        </div>
      </div>

      <h3>Rows <span class="faint small">drag to reorder</span></h3>
      <label class="slider"><span>Items per row</span><input type="range" min="5" max="60" step="1" bind:value={settings.rowItemLimit} /><b>{settings.rowItemLimit}</b></label>
      <div class="rows">
        {#each rows as r (r.key)}
          {@const i = r.idx}
          <div
            class="rowcard"
            class:off={!r.enabled}
            class:dragging={dragRow === i}
            draggable="true"
            role="listitem"
            ondragstart={() => (dragRow = i)}
            ondragend={() => (dragRow = null)}
            ondragover={(e) => e.preventDefault()}
            ondrop={() => {
              if (dragRow !== null && dragRow !== i) editRows((rs) => { const [x] = rs.splice(dragRow!, 1); rs.splice(i, 0, x); });
              dragRow = null;
            }}
          >
            <div class="rowtop">
              <span class="grip"><Icon name="drag" size={16} /></span>
              <input type="checkbox" checked={r.enabled} onchange={() => editRows((rs) => (rs[i].enabled = !rs[i].enabled))} aria-label="Show row" />
              <input class="bare" value={r.title ?? ''} placeholder={r.cat.title}
                onchange={(e) => { const v = e.currentTarget.value; editRows((rs) => (rs[i].title = v)); }} />
              <select class="mini-select" value={r.display ?? 'poster'} onchange={(e) => { const v = e.currentTarget.value as RowDisplay; editRows((rs) => (rs[i].display = v)); }}>
                <option value="poster">Posters</option>
                <option value="wide">Wide</option>
                <option value="top10">Top 10</option>
              </select>
            </div>
            <div class="faint tiny">{r.cat.addon.manifest.name}</div>
          </div>
        {/each}
      </div>

    {:else if ui.studioTab === 'code'}
      <h3>Custom CSS</h3>
      <p class="faint small">Applied on top of everything. Live as you type.</p>
      <textarea class="textarea code" rows="14" spellcheck="false" bind:value={look.customCss}
        placeholder={`/* e.g. */\n.page-title { letter-spacing: 0.04em; }\n:root { --row-gap: 48px; }`}></textarea>
      <details class="cheat">
        <summary>Cheat sheet</summary>
        <p class="small faint">Variables (on <code>:root</code>)</p>
        <pre>--bg --bg-2 --bg-3 --line
--text --text-2 --text-3
--accent --on-accent --glass
--radius --btn-radius
--poster-w --gap --page-pad --row-gap
--font --font-display --dur</pre>
        <p class="small faint">Attributes on <code>&lt;html&gt;</code></p>
        <pre>[data-nav="sidebar|rail|icons|top|dock"]
[data-card="plain|outlined|elevated|glass|overlay"]
[data-hover="lift|zoom|glow|none"]
[data-light="1"]  (light themes)</pre>
        <p class="small faint">Handy classes</p>
        <pre>.nav .item  .pc .art  .row  .hero
.page  .page-title  .btn.primary  .chip</pre>
      </details>

    {:else if ui.studioTab === 'themes'}
      <h3>Save current look</h3>
      <div class="row">
        <input class="input" placeholder="Theme name" bind:value={themeName} onkeydown={(e) => e.key === 'Enter' && themeName.trim() && (saveCurrentTheme(themeName), (themeName = ''), toast('Theme saved', 'success'))} />
        <button class="btn primary sm" disabled={!themeName.trim()} onclick={() => { saveCurrentTheme(themeName); themeName = ''; toast('Theme saved', 'success'); }}>Save</button>
      </div>

      <h3>My themes</h3>
      {#each themes.list as t (t.id)}
        <div class="theme">
          <span class="dot" style:background={t.look.colors.bg} style:border-color={t.look.colors.accent}></span>
          <div class="grow">
            <div class="tname">{t.name}</div>
            {#if t.imported}<span class="chip">Imported</span>{/if}
          </div>
          <button class="btn sm" onclick={() => { applyTheme(t); toast(`Applied “${t.name}”`, 'success', 1500); }}>Apply</button>
          <button class="icon-btn" title="Export .ripplestyle" onclick={() => exportTheme(t)}><Icon name="download" size={16} /></button>
          <button class="icon-btn" title="Delete" onclick={() => confirm(`Delete “${t.name}”?`) && deleteTheme(t.id)}><Icon name="trash" size={16} /></button>
        </div>
      {:else}
        <p class="faint small">No saved themes yet.</p>
      {/each}

      <div class="row gap">
        <button class="btn sm" onclick={() => importInput?.click()}><Icon name="upload" size={14} />Import .ripplestyle</button>
        <button class="btn sm" onclick={() => exportTheme({ id: '', name: themeName.trim() || 'My Ripple theme', look: $state.snapshot(look) })}>
          <Icon name="download" size={14} />Export current
        </button>
        <input type="file" accept=".ripplestyle,.json,application/json" hidden bind:this={importInput} onchange={importTheme} />
      </div>
      <div class="row gap">
        <button class="btn sm danger" onclick={() => confirm('Reset every appearance setting to default?') && resetLook()}>Reset to default look</button>
      </div>
    {/if}
  </div>
</aside>

<style>
  .studio {
    position: fixed; top: 0; right: 0; bottom: 0; width: 400px; z-index: 50;
    display: flex; flex-direction: column;
    background: var(--bg-2); border-left: 1px solid var(--line);
    box-shadow: -24px 0 60px rgb(0 0 0 / 0.4);
    transform: translateX(105%); transition: transform 280ms var(--ease); will-change: transform;
  }
  .studio.open { transform: none; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 18px 16px 12px 22px; }
  .ttl { font-family: var(--font-display); font-size: 19px; font-weight: 800; letter-spacing: -0.01em; }
  .small { font-size: 12.5px; }
  .tiny { font-size: 11px; padding-left: 52px; }

  .tabs { display: flex; gap: 2px; margin: 0 14px 4px; padding: 3px; border-radius: 12px; background: var(--bg-3); }
  .tabs button {
    flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 7px 0 6px; border: 0;
    background: none; border-radius: 9px; cursor: pointer; color: var(--text-2); font-size: 11.5px; font-weight: 600;
    transition: background var(--dur), color var(--dur);
  }
  .tabs button:hover { color: var(--text); }
  .tabs button.on { color: var(--text); background: var(--bg-2); box-shadow: 0 1px 3px rgb(0 0 0 / 0.25); }
  .tabs button.on :global(svg) { color: var(--accent); }

  .body { flex: 1; overflow-y: auto; padding: 4px 22px 40px; overscroll-behavior: contain; }
  h3 {
    font-family: var(--font); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.09em; color: var(--text-3);
    margin: 24px 0 10px; display: flex; gap: 8px; align-items: baseline; font-weight: 700;
  }
  .link { background: none; border: 0; padding: 0; cursor: pointer; color: var(--accent); font-size: 12px; text-transform: none; letter-spacing: 0; font-weight: 600; }
  .row { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
  .row.gap { margin-top: 14px; flex-wrap: wrap; }
  .grow { flex: 1; min-width: 0; }

  /* Theme cards: a tiny mock-up of the app in each palette */
  .presets { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .preset {
    display: flex; flex-direction: column; gap: 8px; padding: 6px 6px 8px; border: 1px solid var(--line); cursor: pointer;
    border-radius: 12px; background: var(--bg); text-align: left; color: var(--text);
    transition: border-color var(--dur), transform var(--dur) var(--ease), box-shadow var(--dur);
  }
  .preset:hover { border-color: var(--text-3); transform: translateY(-1px); }
  .preset.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .mock {
    position: relative; display: grid; grid-template-columns: 14px 1fr; grid-template-rows: 30px 1fr; gap: 4px;
    height: 74px; padding: 5px; border-radius: 8px; border: 1px solid; overflow: hidden;
  }
  .m-rail { grid-row: 1 / 3; border-radius: 4px; }
  .m-hero { position: relative; border-radius: 4px; padding: 5px 6px; display: flex; flex-direction: column; gap: 3px; }
  .m-line { display: block; height: 3px; width: 46%; border-radius: 2px; opacity: 0.9; }
  .m-line.short { width: 30%; opacity: 0.7; }
  .m-btn { position: absolute; left: 6px; bottom: 4px; width: 22px; height: 6px; border-radius: 3px; }
  .m-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; }
  .m-cards i { border-radius: 3px; }
  .pname { display: flex; align-items: center; gap: 7px; padding: 0 4px; font-size: 12.5px; font-weight: 700; }
  .pname .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .check {
    margin-left: auto; width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center;
    background: var(--accent); color: var(--on-accent);
  }

  /* Accent dots */
  .accents { display: flex; flex-wrap: wrap; gap: 9px; }
  .acc {
    width: 28px; height: 28px; border-radius: 50%; border: 0; padding: 0; cursor: pointer; background: var(--c);
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.2); transition: transform var(--dur) var(--ease);
  }
  .acc:hover { transform: scale(1.12); }
  .acc.on { box-shadow: 0 0 0 2px var(--bg-2), 0 0 0 4px var(--c, var(--accent)); }
  .acc.custom {
    position: relative; overflow: hidden; display: block;
    background: conic-gradient(#ff4d4d, #ffcc33, #4fd087, #33c3ff, #8b6cff, #ff4dc4, #ff4d4d);
  }
  .acc.custom.on { --c: var(--accent); }
  .acc.custom input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }

  /* Fine-tune colors */
  .fine { margin-top: 18px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); }
  .fine summary {
    display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 11px 14px; cursor: pointer;
    font-size: 13px; font-weight: 600; color: var(--text-2); list-style: none;
  }
  .fine summary::-webkit-details-marker { display: none; }
  .fine summary::after { content: ''; width: 7px; height: 7px; border-right: 2px solid var(--text-3); border-bottom: 2px solid var(--text-3); transform: rotate(45deg); margin-left: 4px; transition: transform var(--dur); }
  .fine[open] summary::after { transform: rotate(-135deg); }
  .fine summary .link { margin-left: auto; }
  .colors { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 0 10px 12px; }
  .color { display: flex; align-items: center; gap: 9px; padding: 6px; border-radius: 9px; cursor: pointer; }
  .color:hover { background: var(--bg-3); }
  .cw { position: relative; width: 28px; height: 28px; border-radius: 8px; overflow: hidden; flex-shrink: 0; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 18%, transparent); }
  .cw input { position: absolute; inset: -8px; width: 44px; height: 44px; border: 0; padding: 0; cursor: pointer; }
  .cl { display: flex; flex-direction: column; font-size: 12px; color: var(--text-2); min-width: 0; }
  .hex { width: 100%; border: 0; background: none; padding: 0; font: 600 12px ui-monospace, Consolas, monospace; color: var(--text); outline: none; text-transform: lowercase; }

  /* Fonts */
  .fonts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .font {
    display: flex; align-items: center; gap: 10px; padding: 9px 10px; border: 1px solid var(--line); border-radius: 10px;
    background: var(--bg); cursor: pointer; text-align: left; color: var(--text-2);
    transition: border-color var(--dur), color var(--dur);
  }
  .font:hover { border-color: var(--text-3); color: var(--text); }
  .font.on { border-color: var(--accent); color: var(--text); box-shadow: 0 0 0 1px var(--accent); }
  .aa { font-size: 21px; line-height: 1; color: var(--text); width: 30px; flex-shrink: 0; }
  .fname { font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Option rows */
  .opt { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
  .opt > span { font-size: 13px; color: var(--text-2); flex-shrink: 0; }
  .opt .select { width: 220px; height: 32px; }
  .slider { display: grid; grid-template-columns: 96px 1fr 46px; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 13px; }
  .slider span { color: var(--text-2); }
  .slider b { font-weight: 600; font-size: 12px; text-align: right; color: var(--text-2); font-variant-numeric: tabular-nums; }
  .toggle { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; font-size: 13px; color: var(--text-2); }
  label.toggle { justify-content: flex-start; cursor: pointer; color: var(--text); }

  /* Navigation picker */
  .navs { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 12px; }
  .navopt {
    display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 0; font-size: 11.5px; font-weight: 600;
    border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--text-2); cursor: pointer;
    transition: border-color var(--dur), color var(--dur);
  }
  .navopt:hover { border-color: var(--text-3); }
  .navopt.on { border-color: var(--accent); color: var(--text); box-shadow: 0 0 0 1px var(--accent); }
  .mini { position: relative; width: 44px; height: 30px; border-radius: 4px; background: var(--bg-3); overflow: hidden; }
  .mini i { position: absolute; background: var(--accent); opacity: 0.85; }
  .mini b { position: absolute; background: var(--text-3); opacity: 0.4; border-radius: 2px; }
  .mini.sidebar i { left: 0; top: 0; bottom: 0; width: 16px; }
  .mini.rail i { left: 0; top: 0; bottom: 0; width: 9px; }
  .mini.icons i { left: 0; top: 0; bottom: 0; width: 5px; }
  .mini.top i { left: 0; right: 0; top: 0; height: 7px; }
  .mini.dock i { left: 12px; right: 12px; bottom: 3px; height: 5px; border-radius: 3px; }
  .mini b { left: 20px; right: 4px; top: 12px; height: 4px; }
  .mini.top b, .mini.dock b { left: 6px; }

  .list { display: flex; flex-direction: column; gap: 2px; }
  .li { display: flex; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 8px; }
  .li:hover { background: var(--bg-3); }
  .li.off { opacity: 0.5; }

  /* Home rows */
  .rows { display: flex; flex-direction: column; gap: 6px; }
  .rowcard { padding: 7px 9px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); cursor: grab; }
  .rowcard.off { opacity: 0.5; }
  .rowcard.dragging { opacity: 0.3; }
  .rowtop { display: flex; align-items: center; gap: 8px; }
  .grip { color: var(--text-3); display: grid; }
  .bare { flex: 1; min-width: 0; border: 0; background: none; outline: none; font-weight: 600; font-size: 13px; padding: 4px 0; }
  .bare::placeholder { color: var(--text); opacity: 0.9; }
  .bare:focus::placeholder { opacity: 0.4; }
  .mini-select { height: 26px; border: 1px solid var(--line); background: var(--bg-2); border-radius: 6px; font-size: 12px; padding: 0 4px; }

  /* CSS tab */
  .code { font-family: ui-monospace, 'JetBrains Mono', Consolas, monospace; font-size: 12.5px; min-height: 240px; background: var(--bg); }
  .cheat { margin-top: 12px; font-size: 13px; }
  .cheat summary { cursor: pointer; color: var(--text-2); font-weight: 600; }
  pre { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 11.5px; white-space: pre-wrap; margin: 4px 0 10px; }
  code { background: var(--bg-3); padding: 1px 4px; border-radius: 4px; }

  /* Saved themes */
  .theme { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); }
  .theme .dot { width: 24px; height: 24px; border-radius: 50%; border: 3px solid; flex-shrink: 0; }
  .tname { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
