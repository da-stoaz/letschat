import type { VoiceMediaTile } from './components/VoiceMediaStage'

export function selectCallTiles(tiles: VoiceMediaTile[], compact: boolean, focusedKey: string | null) {
  const sorted = [...tiles].sort((a, b) => b.priority - a.priority)
  const focused = sorted.find((tile) => tile.key === focusedKey)
  const visual = sorted.filter((tile) => tile.hasVisual)
  const spotlight = focused ? [focused] : (visual.length ? visual.slice(0, compact ? 1 : 2) : sorted.slice(0, 1))
  const selected = new Set(spotlight.map((tile) => tile.key))
  return { spotlight, secondary: sorted.filter((tile) => !selected.has(tile.key)), focused: Boolean(focused) }
}
