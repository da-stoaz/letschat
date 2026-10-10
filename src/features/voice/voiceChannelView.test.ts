import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { useVoiceSessionStore } from '../../stores/voiceSessionStore'
import { VoiceChannelView } from './VoiceChannelView'

vi.mock('../../stores/voiceSessionStore', async importOriginal => {
  const original = await importOriginal<typeof import('../../stores/voiceSessionStore')>()
  return { useVoiceSessionStore: Object.assign(
    (selector?: (state: ReturnType<typeof original.useVoiceSessionStore.getState>) => unknown) => {
      const state = original.useVoiceSessionStore.getState()
      return selector ? selector(state) : state
    }, original.useVoiceSessionStore,
  ) }
})

afterEach(() => {
  useVoiceSessionStore.getState().reset()
  vi.unstubAllGlobals()
})

it('keeps a failed join visible after the call session has been cleared', () => {
  vi.stubGlobal('window', { innerWidth: 1440 })
  const message = 'You are not a participant in this voice room.'
  useVoiceSessionStore.setState({ room: null, joinedChannelId: null, joining: false, error: message })
  const html = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(VoiceChannelView, { channelId: 2 }),
  ))
  expect(html).toContain('role="alert"')
  expect(html).toContain(message)
  expect(html).toContain('Join call')
})
