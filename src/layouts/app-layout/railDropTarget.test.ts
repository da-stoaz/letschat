import { expect, it } from 'vitest'
import { railDropTarget } from './railDropTarget'

it('follows the pointer from grouping back to sorting, including within existing groups', () => {
  const rect = { top: 100, height: 40 }
  expect(railDropTarget('s:1', 's:2', rect, 120)).toEqual({ intent: 'group', overId: 's:2' })
  expect(railDropTarget('s:1', 's:2', rect, 139)).toEqual({ intent: 'sort', overId: 's:2', insertBefore: false })
  expect(railDropTarget('s:1', 's:2', rect, 101)).toEqual({ intent: 'sort', overId: 's:2', insertBefore: true })
  expect(railDropTarget('sg:folder:1', 'sg:folder:2', rect, 120)).toEqual({ intent: 'sort', overId: 'sg:folder:2', insertBefore: false })
  expect(railDropTarget('sg:folder:1', 'g:other', rect, 120)).toEqual({ intent: 'group', overId: 'g:other' })
  expect(railDropTarget('g:folder', 's:2', rect, 120)).toEqual({ intent: 'sort', overId: 's:2', insertBefore: false })
  expect(railDropTarget('s:1', 's:1', rect, 120)).toBeNull()
})
