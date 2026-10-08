import { describe, expect, it } from 'vitest'
import { selectCallTiles } from './mediaLayout'
import { callReturnPath } from './callNavigation'
import type { VoiceMediaTile } from './components/VoiceMediaStage'

const tile = (key: string, priority: number, hasVisual = true) => ({ key, priority, hasVisual } as VoiceMediaTile)
const tiles = [tile('camera', 120), tile('screen', 220), tile('audio', 30, false)]

describe('responsive call presentation', () => {
  it('keeps one main tile on phones and two on desktop, without losing participants', () => {
    const phone = selectCallTiles(tiles, true, null)
    expect(phone.spotlight.map((t) => t.key)).toEqual(['screen'])
    expect(phone.secondary.map((t) => t.key)).toEqual(['camera', 'audio'])
    expect(selectCallTiles(tiles, false, null).spotlight.map((t) => t.key)).toEqual(['screen', 'camera'])
  })
  it('retains focused tiles across resizing and falls back when they leave', () => {
    for (const compact of [true, false]) {
      expect(selectCallTiles(tiles, compact, 'audio').spotlight.map((t) => t.key)).toEqual(['audio'])
      expect(selectCallTiles(tiles, compact, 'gone').focused).toBe(false)
    }
    expect(selectCallTiles([], true, null).spotlight).toEqual([])
    expect(selectCallTiles([tile('audio', 30, false)], true, null).spotlight[0].key).toBe('audio')
  })
  it('minimizes to the originating screen and provides a safe direct-link fallback', () => {
    expect(callReturnPath('/app/1/channels', '/app/messages')).toBe('/app/1/channels')
    expect(callReturnPath('/app/dm/friend', '/app/messages')).toBe('/app/dm/friend')
    for (const requested of [undefined, '/app/call', '/app/call/', '/app/call?x', 'https://example.com']) {
      expect(callReturnPath(requested, '/app/messages')).toBe('/app/messages')
    }
  })
})
