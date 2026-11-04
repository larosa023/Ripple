/**
 * Addons give air dates as midnight UTC ("2024-03-01T00:00:00Z"), which is the evening
 * before in the Americas. Treat those as that calendar day; keep real times as they are.
 */
export function airDate(released: string): Date {
  const d = new Date(released);
  if (Number.isNaN(+d)) return d;
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) {
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  return d;
}
