import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCallAudioPlayback } from './callAudioPlayback'

const node = () => ({ connect: (next: unknown) => next, disconnect: () => {}, gain: { value: 1 } })
class FakeAudioContext extends EventTarget {
  static created: FakeAudioContext[] = []
  state = 'running'
  close = vi.fn(async () => { this.state = 'closed' })
  resume = vi.fn(async () => {})
  constructor() { super(); FakeAudioContext.created.push(this) }
  createMediaStreamSource = node
  createGain = node
  createMediaStreamDestination = () => ({ ...node(), stream: { getTracks: () => [] } })
}
const element = () => ({ play: async () => {}, pause: () => {}, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as HTMLAudioElement
const sink = () => createCallAudioPlayback({} as MediaStreamTrack, element(), 1, () => {})

describe('shared call playback context', () => {
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('MediaStream', class {})
  vi.stubGlobal('Audio', class { play = async () => {}; pause() {} })
  afterEach(() => { FakeAudioContext.created = [] })

  it('keeps the context when a sink is replaced in the same commit', async () => {
    const first = sink()
    first.dispose()
    const second = sink()
    await Promise.resolve()
    expect(FakeAudioContext.created).toHaveLength(1)
    expect(FakeAudioContext.created[0].close).not.toHaveBeenCalled()
    second.dispose()
    await Promise.resolve()
  })

  it('closes the context once the last sink is really gone', async () => {
    sink().dispose()
    await Promise.resolve()
    expect(FakeAudioContext.created[0].close).toHaveBeenCalledOnce()
    sink().dispose()
    await Promise.resolve()
    expect(FakeAudioContext.created).toHaveLength(2)
  })
})
