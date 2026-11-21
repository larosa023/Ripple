// Language codes as players and addons report them ("eng", "en", "pt-BR", "fre", "English")
// turned into readable names, and compared regardless of which form was used.

// ISO 639-2 "bibliographic" codes the browser doesn't know, mapped to their 2-letter form.
const BIB: Record<string, string> = {
  alb: 'sq', arm: 'hy', baq: 'eu', bur: 'my', chi: 'zh', cze: 'cs', dut: 'nl', fre: 'fr', geo: 'ka', ger: 'de',
  gre: 'el', ice: 'is', mac: 'mk', mao: 'mi', may: 'ms', per: 'fa', rum: 'ro', slo: 'sk', tib: 'bo', wel: 'cy',
  // Common non-standard forms seen in releases and subtitle addons.
  pob: 'pt-BR', pb: 'pt-BR', ptbr: 'pt-BR', spn: 'es', scc: 'sr', scr: 'hr', jp: 'ja', gr: 'el', cn: 'zh', kr: 'ko', se: 'sv', dk: 'da',
};

let names: Intl.DisplayNames | null = null;
try {
  names = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
} catch {
  /* very old engine: fall back to the code itself */
}

const cache = new Map<string, string>();

/** "eng" → "English", "pt-BR" → "Brazilian Portuguese", "und" / "" → "". Unknown codes come back upper-cased. */
export function langName(code?: string | null): string {
  const raw = (code ?? '').trim();
  if (!raw) return '';
  const hit = cache.get(raw);
  if (hit !== undefined) return hit;
  let out = '';
  const low = raw.toLowerCase().replace('_', '-');
  if (low === 'und' || low === 'unk' || low === 'mis' || low === 'zxx' || low === 'mul') out = '';
  else if (/^[a-z]{2,3}(-[a-z0-9]{2,4})?$/i.test(low)) {
    const norm = BIB[low] ?? low;
    try {
      out = names?.of(norm) ?? '';
    } catch {
      out = '';
    }
    if (!out) out = raw.length <= 3 ? raw.toUpperCase() : raw;
  } else out = raw.charAt(0).toUpperCase() + raw.slice(1); // already a name, like "English"
  cache.set(raw, out);
  return out;
}

/** The base language ("Portuguese" for both "por" and "pt-BR"), for grouping and matching. */
export function baseLang(code?: string | null): string {
  const raw = (code ?? '').trim().toLowerCase().replace('_', '-');
  if (!raw) return '';
  const mapped = BIB[raw] ?? raw;
  return langName(mapped.split('-')[0]).toLowerCase();
}

/** True when two codes or names mean the same language ("eng" = "en" = "English"). */
export function sameLang(a?: string | null, b?: string | null): boolean {
  const x = baseLang(a);
  return !!x && x === baseLang(b);
}
