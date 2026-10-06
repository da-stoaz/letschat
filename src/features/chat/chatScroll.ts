/** Preserve the reader's position when an older page grows the feed above it. */
export function getHistoryScrollOffset(scrollTop: number, previousHeight: number, nextHeight: number): number {
  return Math.max(0, scrollTop + nextHeight - previousHeight)
}
