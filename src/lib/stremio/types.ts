// Types for the Stremio addon protocol.
// Spec: https://github.com/Stremio/stremio-addon-sdk/tree/master/docs

export type ResourceName = 'catalog' | 'meta' | 'stream' | 'subtitles' | 'addon_catalog' | string;

export interface ExtraDef {
  name: string;
  isRequired?: boolean;
  options?: string[];
  optionsLimit?: number;
}

export interface CatalogDef {
  type: string;
  id: string;
  name?: string;
  extra?: ExtraDef[];
  /** Legacy form of `extra`. */
  extraSupported?: string[];
  extraRequired?: string[];
}

export interface ResourceDef {
  name: ResourceName;
  types?: string[];
  idPrefixes?: string[];
}

export interface Manifest {
  id: string;
  version: string;
  name: string;
  description?: string;
  logo?: string;
  background?: string;
  types: string[];
  catalogs: CatalogDef[];
  resources: (ResourceName | ResourceDef)[];
  idPrefixes?: string[];
  behaviorHints?: {
    adult?: boolean;
    p2p?: boolean;
    configurable?: boolean;
    configurationRequired?: boolean;
  };
}

export interface InstalledAddon {
  /** Full manifest URL. Base URL is this minus `/manifest.json`. */
  transportUrl: string;
  manifest: Manifest;
  enabled: boolean;
  /** Protected addons (Cinemeta) can be disabled but not removed. */
  protected?: boolean;
}

export interface Video {
  id: string;
  title?: string;
  name?: string;
  released?: string;
  season?: number;
  episode?: number;
  number?: number;
  thumbnail?: string;
  overview?: string;
  description?: string;
}

export interface MetaPreview {
  id: string;
  type: string;
  name: string;
  poster?: string;
  posterShape?: 'square' | 'poster' | 'landscape';
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string;
  genres?: string[];
}

export interface MetaDetail extends MetaPreview {
  runtime?: string;
  year?: string | number;
  director?: string[];
  cast?: string[];
  videos?: Video[];
  links?: { name: string; category: string; url: string }[];
  trailers?: { source: string; type: string }[];
  trailerStreams?: { title?: string; ytId: string }[];
  behaviorHints?: { defaultVideoId?: string };
  released?: string;
  writer?: string[];
  country?: string;
  awards?: string;
  language?: string;
  certification?: string;
  /** Cinemeta extras: cast with photos, directors, writers */
  app_extras?: {
    cast?: { name: string; character?: string; photo?: string }[];
    directors?: { name: string; photo?: string }[];
    writers?: { name: string; photo?: string }[];
  };
}

export interface Subtitle {
  id: string;
  url: string;
  lang: string;
}

export interface Stream {
  url?: string;
  ytId?: string;
  infoHash?: string;
  fileIdx?: number;
  externalUrl?: string;
  name?: string;
  title?: string;
  description?: string;
  subtitles?: Subtitle[];
  sources?: string[];
  behaviorHints?: {
    notWebReady?: boolean;
    bingeGroup?: string;
    filename?: string;
    videoSize?: number;
    proxyHeaders?: { request?: Record<string, string>; response?: Record<string, string> };
  };
}

/** A stream annotated with the addon that returned it. */
export interface SourcedStream extends Stream {
  addonName: string;
  addonId: string;
}
