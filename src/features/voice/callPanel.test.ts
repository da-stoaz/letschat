import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CallPanel } from './components/CallPanel'
import type { ActiveCall } from './hooks/useActiveCall'

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
