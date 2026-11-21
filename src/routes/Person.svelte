<script lang="ts">
  // An actor's (or director's) page: photo, bio, what they're known for, and their full filmography.
  import Icon from '../lib/components/Icon.svelte';
  import PosterCard from '../lib/components/PosterCard.svelte';
  import PosterRow from '../lib/components/PosterRow.svelte';
  import { getPerson, hasTmdb, type PersonPage } from '../lib/tmdb';
  import { openExternal } from '../lib/player';
  import { back, router } from '../lib/stores/router.svelte';

  const id = $derived(Number(router.route.params[0]) || 0);
  let person = $state<PersonPage | null>(null);
  let error = $state('');
  let tab: 'movies' | 'shows' = $state('movies');
  let bioOpen = $state(false);

  $effect(() => {
    const pid = id;
    person = null;
    error = '';
    bioOpen = false;
    if (!pid) return;
    let live = true;
    getPerson(pid)
      .then((p) => {
        if (!live) return;
        person = p;
        tab = p.movies.length >= p.shows.length ? 'movies' : 'shows';
      })
      .catch((e) => live && (error = (e as Error).message));
    return () => {
      live = false;
    };
  });

  const DATE = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  function fmt(d: string) {
    const t = new Date(d + 'T00:00:00');
    return isNaN(+t) ? d : DATE.format(t);
  }
  function age(from: string, to?: string) {
    const a = new Date(from + 'T00:00:00');
    const b = to ? new Date(to + 'T00:00:00') : new Date();
    let y = b.getFullYear() - a.getFullYear();
    if (b.getMonth() < a.getMonth() || (b.getMonth() === a.getMonth() && b.getDate() < a.getDate())) y--;
    return y;
  }
  const credits = $derived(person ? (tab === 'movies' ? person.movies : person.shows) : []);
</script>

<div class="page person">
  <button class="back icon-btn" onclick={back} aria-label="Back"><Icon name="chevronLeft" size={22} /></button>
  {#if !hasTmdb()}
    <div class="empty"><p>Add a free TMDB key in <a href="#/settings?tab=integrations">Settings → Integrations</a> to see people's pages.</p></div>
  {:else if error}
    <div class="empty"><p>Couldn't load this person. {error}</p></div>
  {:else if !person}
    <div class="top"><div class="photo skeleton"></div><div class="info"><div class="skeleton line w40"></div><div class="skeleton line w70"></div><div class="skeleton line w60"></div></div></div>
  {:else}
    <div class="top">
      <div class="photo">
        {#if person.photo}<img src={person.photo} alt="" />{:else}<span>{person.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('')}</span>{/if}
      </div>
      <div class="info">
        <h1>{person.name}</h1>
        <div class="facts muted">
          {#if person.department}<span>{person.department === 'Acting' ? 'Actor' : person.department}</span>{/if}
          {#if person.birthday}<span>{`Born ${fmt(person.birthday)}${person.birthplace ? ` in ${person.birthplace}` : ''}${person.deathday ? '' : ` (${age(person.birthday)})`}`}</span>{/if}
          {#if person.deathday}<span>{`Died ${fmt(person.deathday)}${person.birthday ? ` (${age(person.birthday, person.deathday)})` : ''}`}</span>{/if}
        </div>
        {#if person.biography}
          <p class="bio" class:open={bioOpen}>{person.biography}</p>
          {#if person.biography.length > 420}<button class="link" onclick={() => (bioOpen = !bioOpen)}>{bioOpen ? 'Show less' : 'Read more'}</button>{/if}
        {/if}
        <div class="actions">
          {#if person.imdb}<button class="btn sm" onclick={() => openExternal(`https://www.imdb.com/name/${person!.imdb}/`)}><Icon name="external" size={14} />IMDb</button>{/if}
          <button class="btn sm" onclick={() => openExternal(`https://www.themoviedb.org/person/${person!.id}`)}><Icon name="external" size={14} />TMDB</button>
        </div>
      </div>
    </div>

    <PosterRow title="Known for" items={person.knownFor} subtitles={person.knownFor.map((k) => k.role)} />

    {#if person.movies.length || person.shows.length}
      <section>
        <div class="sec-head">
          <h2>Filmography</h2>
          <div class="tabs">
            <button class="tab" class:active={tab === 'movies'} onclick={() => (tab = 'movies')} disabled={!person.movies.length}>Movies <b>{person.movies.length}</b></button>
            <button class="tab" class:active={tab === 'shows'} onclick={() => (tab = 'shows')} disabled={!person.shows.length}>Shows <b>{person.shows.length}</b></button>
          </div>
        </div>
        <div class="grid">
          {#each credits as m (m.id)}
            <PosterCard meta={m} subtitle={[m.releaseInfo, m.role].filter(Boolean).join(' · ')} fill />
          {/each}
        </div>
      </section>
    {/if}
    <p class="credit faint">Data from TMDB.</p>
  {/if}
</div>

<style>
  .person { position: relative; }
  .back { margin: 0 0 8px -8px; }
  .top { display: flex; gap: 32px; align-items: flex-start; margin: 6px 0 34px; }
  .photo { width: 220px; aspect-ratio: 2 / 3; flex-shrink: 0; border-radius: var(--radius); overflow: hidden; background: var(--bg-3); display: grid; place-items: center; box-shadow: 0 14px 40px rgb(0 0 0 / 0.35); }
  .photo img { width: 100%; height: 100%; object-fit: cover; }
  .photo span { font: 800 48px var(--font-display); color: var(--text-3); }
  .info { flex: 1; min-width: 0; padding-top: 6px; }
  h1 { font-family: var(--font-display); font-size: 38px; margin: 0 0 8px; letter-spacing: -0.02em; line-height: 1.1; }
  .facts { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 14px; margin-bottom: 16px; }
  .bio { margin: 0; max-width: 78ch; line-height: 1.6; color: var(--text-2); white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 6; line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }
  .bio.open { display: block; }
  .link { border: 0; background: none; color: var(--accent); font: 600 13px var(--font); cursor: pointer; padding: 6px 0 0; }
  .actions { display: flex; gap: 8px; margin-top: 18px; }
  .line { height: 18px; border-radius: 6px; margin-bottom: 12px; }
  .w40 { width: 40%; height: 34px; } .w70 { width: 70%; } .w60 { width: 60%; }
  .sec-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
  h2 { font-family: var(--font-display); font-size: 19px; margin: 0; }
  .tabs { display: flex; gap: 4px; background: var(--bg-2); border: 1px solid var(--line); padding: 3px; border-radius: 9px; }
  .tab { border: 0; background: none; padding: 5px 12px; border-radius: 7px; cursor: pointer; color: var(--text-2); font-weight: 600; font-size: 12.5px; }
  .tab b { font-weight: 600; opacity: 0.7; margin-left: 3px; }
  .tab.active { background: var(--accent); color: var(--on-accent); }
  .tab:disabled { opacity: 0.4; cursor: default; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--poster-w), 1fr)); gap: var(--gap); }
  .credit { font-size: 12px; margin-top: 26px; }
  @media (max-width: 760px) { .top { flex-direction: column; } .photo { width: 160px; } }
</style>
