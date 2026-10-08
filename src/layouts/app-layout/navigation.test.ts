import { describe, expect, it } from 'vitest'
import { appHomePath, paneWidths, parentListPath } from './navigation'

describe('responsive navigation', () => {
  it('opens lists on compact screens and retains the preferred desktop space', () => {
    expect(appHomePath(true, [1, 2], 2)).toBe('/app/spaces')
    expect(appHomePath(true, [], null)).toBe('/app/messages')
    expect(appHomePath(false, [1, 2], 2)).toBe('/app/2')
    expect(appHomePath(false, [1, 2], 3)).toBe('/app/1')
    expect(appHomePath(false, [], null)).toBe('/app/dm/friends')
  })

  it.each([
    ['/app/12/42', '/app/12/channels'],
    ['/app/12/channels', '/app/spaces'],
    ['/app/12/manage', '/app/12/channels'],
    ['/app/12/999', '/app/12/channels'],
    ['/app/dm/identity', '/app/messages'],
    ['/app/dm/friends', '/app/messages'],
    ['/app/settings', '/app/spaces'],
  ])('provides a parent for direct links: %s', (path, parent) => {
    expect(parentListPath(path)).toBe(parent)
  })

  it('preserves conversation space while retaining stored panel sizes', () => {
    const narrow = paneWidths(768, 374, 408, false)
    expect(768 - 48 - 32 - narrow.channelWidth).toBeGreaterThanOrEqual(420)
    expect(narrow.membersInline).toBe(false)
    expect(paneWidths(1024, 374, 408, false).membersInline).toBe(false)
    expect(paneWidths(1440, 374, 408, false)).toEqual({ channelWidth: 374, membersInline: true })
    expect(paneWidths(390, 220, 240, true).membersInline).toBe(false)
  })
})
