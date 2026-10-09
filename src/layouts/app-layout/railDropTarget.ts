export type RailDropTarget =
  | { intent: 'group'; overId: string }
  | { intent: 'sort'; overId: string; insertBefore: boolean }

/** The current pointer position determines both the preview and the committed drop. */
export function railDropTarget(activeId: string, overId: string, rect: { top: number; height: number }, pointerY: number): RailDropTarget | null {
  if (activeId === overId) return null
  const sourceGroup = activeId.startsWith('sg:') ? activeId.split(':')[1] : null
  const targetGroup = overId.startsWith('g:') ? overId.slice(2) : overId.startsWith('sg:') ? overId.split(':')[1] : null
  const canGroup = !activeId.startsWith('g:') && (!sourceGroup || sourceGroup !== targetGroup)
  const center = rect.top + rect.height / 2
  if (canGroup && Math.abs(pointerY - center) < rect.height / 4) return { intent: 'group', overId }
  return { intent: 'sort', overId, insertBefore: pointerY < center }
}
