<script lang="ts" module>
  // 24x24 stroke icons (Lucide-style), inlined so there is no icon library to ship.
  const PATHS: Record<string, string> = {
    home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
    library: 'M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.8 1-3.9 15-3.8-1z',
    puzzle:
      'M10 3h4v3a2 2 0 1 0 4 0V3h0a2 2 0 0 1 2 2v4h-3a2 2 0 1 0 0 4h3v4a2 2 0 0 1-2 2h-4v-3a2 2 0 1 0-4 0v3H6a2 2 0 0 1-2-2v-4h3a2 2 0 1 0 0-4H4V5a2 2 0 0 1 2-2z',
    settings:
      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    play: 'M7 4.5v15l12-7.5z',
    plus: 'M12 5v14M5 12h14',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    x: 'M6 6l12 12M18 6 6 18',
    back: 'M15 18l-6-6 6-6',
    chevronRight: 'M9 6l6 6-6 6',
    chevronLeft: 'M15 6l-6 6 6 6',
    up: 'M6 15l6-6 6 6',
    down: 'M6 9l6 6 6-6',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    refresh: 'M20 11a8 8 0 0 0-14.9-4M4 4v4h4M4 13a8 8 0 0 0 14.9 4M20 20v-4h-4',
    external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
    bookmark: 'M6 3h12v18l-6-4-6 4z',
    star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    filter: 'M4 5h16l-6 7.5V19l-4 2v-8.5z',
    pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
    volume: 'M4 9h3.5L12 5v14l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
    volumeLow: 'M4 9h3.5L12 5v14l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6',
    mute: 'M4 9h3.5L12 5v14l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5',
    cc: 'M3 6h18v12H3zM10 10.3a2.5 2.5 0 1 0 0 3.4M17 10.3a2.5 2.5 0 1 0 0 3.4',
    audio: 'M3 14v-2a9 9 0 0 1 18 0v2M3 14h3v6H4a1 1 0 0 1-1-1zM21 14h-3v6h2a1 1 0 0 0 1-1z',
    expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    shrink: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
    back10: 'M3 12a9 9 0 1 0 3-6.7M3 4v4.5h4.5M10 10v5M13 10h2.5v5H13z',
    fwd10: 'M21 12a9 9 0 1 1-3-6.7M21 4v4.5h-4.5M10 10v5M13 10h2.5v5H13z',
    gauge: 'M12 14l4-6M4.9 18a9 9 0 1 1 14.2 0',
    brush: 'M9.1 11.9l8-8.1a2.9 2.9 0 1 1 4.1 4.1l-8.1 8M7.1 14.9c-1.7 0-3 1.4-3 3 0 1.3-2.5 1.5-2 2 1.1 1.1 2.5 2 4 2 2.2 0 4-1.8 4-4a3 3 0 0 0-3-3z',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
    image: 'M4 4h16v16H4zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM20 15l-5-5L5 20',
    type: 'M4 7V4h16v3M9 20h6M12 4v16',
    code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
    layout: 'M4 4h16v16H4zM4 9h16M9 9v11',
    download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
    upload: 'M12 20V8M7 13l5-5 5 5M4 4h16',
    drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
    palette: 'M12 21a9 9 0 1 1 9-9c0 2.5-2 3.5-3.5 3.5H15a2 2 0 0 0-1.5 3.3A1.4 1.4 0 0 1 12 21zM7.5 11h.01M10 7h.01M15 7h.01M17.5 11h.01',
  };
</script>

<script lang="ts">
  let { name, size = 20, stroke = 1.8, fill = false }: { name: string; size?: number; stroke?: number; fill?: boolean } =
    $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={fill ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"><path d={PATHS[name] ?? ''} /></svg
>
