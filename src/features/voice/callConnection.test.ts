import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ConnectionState, type Room } from 'livekit-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StateCreator } from 'zustand'
import { ActiveCallCard } from '../../layouts/app-layout/ActiveCallCard'
import { ServerChannelBar } from '../../layouts/app-layout/channel-bar/ServerChannelBar'
import type { ServerChannelBarProps } from '../../layouts/app-layout/channel-bar/types'
import { useConnectionStore } from '../../stores/connectionStore'
import { useVoiceSessionStore } from '../../stores/voiceSessionStore'
import { useDmVoiceSessionStore } from '../../stores/dmVoiceSessionStore'
import { useVoiceStore } from '../../stores/voiceStore'
import { useActiveCall } from './hooks/useActiveCall'
import { CallPanel } from './components/CallPanel'

vi.mock('zustand', async (importOriginal) => {
  const original = await importOriginal<typeof import('zustand')>()
  // SSR normally reads a store's startup state. Exercise live session snapshots.
  return { ...original, create: <T>(initializer?: StateCreator<T>) => {
    const create = (init: StateCreator<T>) => original.create<T>((set, get, api) => {
      api.getInitialState = get
      return init(set, get, api)
    })
    return initializer ? create(initializer) : create
  } }
})

const channel = { id: 2, serverId: 1, name: 'General', kind: 'Voice', section: null, position: 0, moderatorOnly: false } as const
const barProps: ServerChannelBarProps = {
  activeServer: null, activeChannelId: 2, role: null, channels: [channel], activeChannelsCount: 1,
  unreadByChannel: {}, participantsByChannel: {}, joinedVoiceChannelId: 2,
  activeSpeakerIdentityKeys: new Set(), memberProfileByIdentity: new Map(),
  onOpenInvite() {}, onOpenCreateChannel() {}, onOpenServerPanel() {}, onLeaveServer() {},
  isChannelMuted: () => false, onToggleChannelMute() {}, onSelectChannel() {},
}

function Panel() {
  const call = useActiveCall()
  return createElement(CallPanel, { call })
}

function roomWithState(state: ConnectionState): Room {
  return {
    state, remoteParticipants: new Map(), activeSpeakers: [],
    localParticipant: {
      identity: 'self', isMicrophoneEnabled: true,
      getTrackPublication: () => undefined, videoTrackPublications: new Map(),
    },
  } as unknown as Room
}

beforeEach(() => {
  vi.stubGlobal('window', { innerWidth: 1440 })
  useConnectionStore.setState({ identity: 'self' })
  useVoiceSessionStore.getState().reset()
  useDmVoiceSessionStore.getState().reset()
  useVoiceStore.setState({ participantsByChannel: { 2: [{
    channelId: 2, userIdentity: 'self', joinedAt: new Date(0).toISOString(),
    muted: false, deafened: false, sharingCamera: false, sharingScreen: false,
  }] } })
})

afterEach(() => {
  useConnectionStore.setState({ identity: null })
  useVoiceSessionStore.getState().reset()
  useDmVoiceSessionStore.getState().reset()
  useVoiceStore.setState({ participantsByChannel: {} })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('consistent call connection status', () => {
  it.each([
    [null, true, 'Connecting…'],
    [ConnectionState.Connecting, false, 'Connecting…'],
    [ConnectionState.Connected, true, 'Connecting…'],
    [ConnectionState.Connected, false, 'Connected'],
    [ConnectionState.Reconnecting, false, 'Reconnecting…'],
    [ConnectionState.SignalReconnecting, false, 'Reconnecting…'],
    [ConnectionState.Disconnected, false, 'Call ended'],
  ] as const)('shows %s (joining=%s) consistently as %s', (state, joining, status) => {
    useVoiceSessionStore.setState({ joinedChannelId: 2, joining, room: state === null ? null : roomWithState(state) })
    const sidebar = renderToStaticMarkup(createElement(ServerChannelBar, barProps))
    const panel = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Panel)))
    const card = renderToStaticMarkup(createElement(ActiveCallCard, { variant: 'sidebar' }))
    for (const html of [sidebar, panel, card]) {
      expect(html).toContain(status)
      expect(html).not.toContain('>Joined<')
      if (status !== 'Connected') {
        expect(html).not.toContain('>Connected<')
        expect(html).not.toContain('Call connection: Connected')
      }
    }
  })

  it('does not mark a different channel with the active call status', () => {
    useVoiceSessionStore.setState({ joinedChannelId: 3, joining: true })
    const html = renderToStaticMarkup(createElement(ServerChannelBar, { ...barProps, joinedVoiceChannelId: 3 }))
    expect(html).not.toContain('Connecting…')
    expect(html).not.toContain('>Connected<')
  })

  it('keeps direct-call ringing separate from connection progress', () => {
    useDmVoiceSessionStore.setState({ joinedPartnerIdentity: 'friend', joining: true })
    const render = () => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Panel)))
    expect(render()).toContain('Connecting…')
    useDmVoiceSessionStore.setState({ room: roomWithState(ConnectionState.Connected), joining: false })
    expect(render()).toContain('Calling…')
    useDmVoiceSessionStore.setState({ answered: true })
    expect(render()).toContain('Connected')
  })
})
