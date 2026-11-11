/** Update only the rows captured by a refresh; a newer page/live update wins. */
export function refreshCachedRows<T extends { id: number }>(cached: T[], requested: T[], refreshed: T[]): T[] {
  const before = new Map(requested.map(row => [row.id, row]))
  const after = new Map(refreshed.map(row => [row.id, row]))
  return cached.flatMap(row => before.get(row.id) !== row ? [row] : after.has(row.id) ? [after.get(row.id)!] : [])
}

/** Keep retained copies current while their IDs also appear in the live window. */
export function updateCachedRows<T extends { id: number }>(cached: T[], live: T[]): T[] {
  const byId = new Map(live.map(row => [row.id, row]))
  return cached.map(row => byId.get(row.id) ?? row)
}
