import { expect, it } from 'vitest'
import { authReturnPath } from './returnPath'

it('retains invitations and rejects external or unrelated return destinations', () => {
  expect(authReturnPath('?redirect=%2Finvite%2Fabc123')).toBe('/invite/abc123')
  for (const path of ['', 'https://example.com', '//example.com', '/auth', '/invite/a?next=//example.com', '/invite/a\\evil']) {
    expect(authReturnPath(`?redirect=${encodeURIComponent(path)}`)).toBe('/app')
  }
})
