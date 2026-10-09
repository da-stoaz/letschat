import { expect, it } from 'vitest'
import { useServerRailStore } from './serverRailStore'

it('keeps an ungrouped space in the rail, whether the group survives or dissolves', () => {
  const store = useServerRailStore.getState()
  store.setOrderAndGroups(['g', 4], { g: { id: 'g', label: 'Friends', serverIds: [1, 2, 3], collapsed: false } })
  store.removeFromGroup(1, 'g')
  expect(useServerRailStore.getState().order).toEqual(['g', 1, 4])
  store.removeFromGroup(2, 'g')
  expect(useServerRailStore.getState().order).toEqual([3, 2, 1, 4])
  expect(useServerRailStore.getState().groups).toEqual({})
  store.createGroup(1, 2)
  const group = Object.values(useServerRailStore.getState().groups)[0]
  expect(group.serverIds).toEqual([2, 1])
  expect(useServerRailStore.getState().order.filter(item => typeof item === 'number')).toEqual([3, 4])
})

it('creates a folder at the target position when dragging from either side', () => {
  for (const source of [1, 4]) {
    const store = useServerRailStore.getState()
    store.setOrderAndGroups([1, 2, 3, 4], {})
    store.createGroup(source, 2)
    const group = Object.values(useServerRailStore.getState().groups)[0]
    expect(useServerRailStore.getState().order).toEqual(source === 1 ? [group.id, 3, 4] : [1, group.id, 3])
  }
})
