import { expect, it } from 'vitest'
import { getHistoryScrollOffset } from './chatScroll'

it('preserves the reading position across a prepended page, including merged sender groups', () => {
  const scrollTop = 20
  const previousHeight = 5000
  const oldMessageTop = 50
  // New messages add 2000px, but merging the first sender group removes 48px.
  const growth = 2000 - 48
  const nextOffset = getHistoryScrollOffset(scrollTop, previousHeight, previousHeight + growth)
  expect(oldMessageTop + growth - nextOffset).toBe(oldMessageTop - scrollTop)
  expect(getHistoryScrollOffset(0, 1000, 1000)).toBe(0)
})
