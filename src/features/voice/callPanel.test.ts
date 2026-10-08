import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CallPanel } from './components/CallPanel'
import type { ActiveCall } from './hooks/useActiveCall'
import { callDetails, callStatus } from './hooks/useActiveCall'
import { ConnectionState } from 'livekit-client'
import type { Channel } from '../../types/domain'

afterEach(() => vi.unstubAllGlobals())

function renderPanel(width: number, activeCallDockVisible: boolean) {
  vi.stubGlobal('window', { innerWidth: width })
  const call = { title: 'General', status: 'Connected', joined: true, connecting: false, tiles: [], participants: [], hasScreenCapture: true } as unknown as ActiveCall
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/app/call'] },
    createElement(Routes, null, createElement(Route, { path: '/app', element: createElement(Outlet, { context: { activeCallDockVisible } }) },
      createElement(Route, { path: 'call', element: createElement(CallPanel, { call }) }),
    )),
  ))
}

describe('call control placement', () => {
  it('describes connecting, reconnecting, ringing, and ended calls', () => {
    expect(callStatus(true, ConnectionState.Connecting, false, true)).toBe('Connecting…')
    for (const state of [ConnectionState.Reconnecting, ConnectionState.SignalReconnecting]) expect(callStatus(false, state, false, false)).toBe('Reconnecting…')
    expect(callStatus(false, ConnectionState.Disconnected, false, true)).toBe('Call ended')
    expect(callStatus(false, ConnectionState.Connected, true, true)).toBe('Calling…')
    expect(callStatus(false, ConnectionState.Connected, true, false)).toBe('Connected')
    expect(callDetails(undefined, 'friend', 'Sam')).toEqual({ title: 'Sam', returnPath: '/app/dm/friend', conversationPath: '/app/dm/friend' })
    expect(callDetails(undefined, 'friend', undefined).title).toBe('Direct call')
    expect(callDetails({ id: 10, serverId: 1, name: 'General' } as Channel, null, undefined)).toEqual({ title: 'General', returnPath: '/app/1/channels', conversationPath: '/app/1/10' })
    expect(callDetails(undefined, null, undefined)).toEqual({ title: 'Voice call', returnPath: '/app/messages', conversationPath: null })
  })
  it('uses the existing desktop dock without duplicating controls in the stage', () => {
    const html = renderPanel(1440, true)
    expect(html).toContain('Fullscreen')
    expect(html).not.toContain('aria-label="Call controls"')
    expect(html).not.toContain('aria-label="Call devices and options"')
  })
  it('exposes controls and device choices directly when desktop has no dock', () => {
    const html = renderPanel(1024, false)
    expect(html).toContain('aria-label="Call controls"')
    expect(html).toContain('aria-label="Call devices and options"')
    expect(html).not.toContain('>More<')
    expect(html).not.toContain('data-slot="sheet-content"')
  })
  it('keeps phone controls and More even when desktop dock context is present', () => {
    const html = renderPanel(390, true)
    expect(html).toContain('aria-label="Call controls"')
    expect(html).toContain('More</button>')
    expect(html).not.toContain('aria-label="Call devices and options"')
  })
})
