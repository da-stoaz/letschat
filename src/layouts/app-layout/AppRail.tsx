import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  type SortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { MessageCircleIcon, PlusIcon, SettingsIcon, Volume2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import stealthChatLogo from '../../../src-tauri/icons/stealthchat-nobg.png'
import { normalizeIdentity, serverInitials, userInitials } from './helpers'
import { useServerRailStore, type ServerGroup } from '../../stores/serverRailStore'
import type { RailItem } from '../../stores/serverRailStore'
import type { Server } from '../../types/domain'

interface QuickDmContact {
  identity: string
  label: string
  avatarUrl: string | null
}

export interface AppRailProps {
  servers: Server[]
  activeServerId: number | null
  activeDmIdentity: string | null
  quickDmContacts: QuickDmContact[]
  onOpenHome: () => void
  onOpenServer: (serverId: number) => void
  onOpenDmHome: () => void
  onOpenDmCompose: () => void
  onOpenDmContact: (identity: string) => void
  onOpenCreateServer: () => void
  onOpenSettings: () => void
  isSettingsActive: boolean
  hasUnreadInServer: (serverId: number) => boolean
  countUnreadInServer: (serverId: number) => number
  countUnreadInDm: () => number
  dmUnreadByIdentity: Record<string, number>
  hasVoiceActivityInServer: (serverId: number) => boolean
  dmCallActiveByIdentity: Record<string, boolean>
}

function formatUnreadCount(value: number): string {
  if (value > 99) return '99+'
  return String(Math.max(0, value))
}

// Items don't shift during group-intent drags — only the overlay moves
const noopStrategy: SortingStrategy = () => null

// ─── Flat list helpers ────────────────────────────────────────────────────────

function buildFlatIds(
  order: RailItem[],
  groups: Record<string, ServerGroup>,
  expandedGroupIds: Set<string>,
): string[] {
  const flat: string[] = []
  for (const item of order) {
    if (typeof item === 'number') {
      flat.push(`s:${item}`)
    } else {
      flat.push(`g:${item}`)
      const g = groups[item]
      if (g && expandedGroupIds.has(item)) {
        g.serverIds.forEach((sid) => flat.push(`sg:${item}:${sid}`))
      }
    }
  }
  return flat
}

function flatToHierarchical(
  flatItems: string[],
  existingGroups: Record<string, ServerGroup>,
  expandedGroupIds: Set<string>,
): { order: RailItem[]; groups: Record<string, ServerGroup> } {
  const order: RailItem[] = []
  const newGroupServerIds: Record<string, number[]> = {}
  let currentGroupId: string | null = null

  for (const item of flatItems) {
    if (item.startsWith('s:')) {
      currentGroupId = null
      order.push(Number(item.slice(2)))
    } else if (item.startsWith('g:')) {
      const groupId = item.slice(2)
      currentGroupId = groupId
      order.push(groupId)
      if (expandedGroupIds.has(groupId)) newGroupServerIds[groupId] = []
    } else if (item.startsWith('sg:')) {
      const parts = item.split(':')
      const groupId = parts[1]
      const serverId = Number(parts[2])
      if (currentGroupId === groupId && expandedGroupIds.has(groupId)) {
        newGroupServerIds[groupId].push(serverId)
      } else {
        // Moved outside its group → becomes top-level
        currentGroupId = null
        order.push(serverId)
      }
    }
  }

  const groups: Record<string, ServerGroup> = {}
  for (const [gid, g] of Object.entries(existingGroups)) {
    if (!order.includes(gid)) continue

    if (!(gid in newGroupServerIds)) {
      groups[gid] = g // collapsed or excluded — keep as-is
      continue
    }

    const sids = newGroupServerIds[gid]
    if (sids.length >= 2) {
      groups[gid] = { ...g, serverIds: sids }
    } else if (sids.length === 1) {
      const idx = order.indexOf(gid)
      if (idx !== -1) order.splice(idx, 1, sids[0])
    } else {
      const idx = order.indexOf(gid)
      if (idx !== -1) order.splice(idx, 1)
    }
  }

  return { order, groups }
}

// ─── Shared avatar ────────────────────────────────────────────────────────────

function ServerAvatar({ server, size = 'md' }: { server: Server; size?: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'size-8 rounded-md' : 'size-9 rounded-lg'
  return (
    <Avatar className={cls}>
      {server.iconUrl ? <AvatarImage src={server.iconUrl} alt={server.name} /> : null}
      <AvatarFallback className={`${size === 'sm' ? 'rounded-md' : 'rounded-lg'} bg-primary/10 text-xs`}>
        {serverInitials(server.name)}
      </AvatarFallback>
    </Avatar>
  )
}

// ─── Border class helpers ─────────────────────────────────────────────────────
// Group items share a continuous border. Each item contributes its portion.
// Items are stacked with zero gap so borders connect seamlessly.

const GROUP_HEADER_OPEN = 'border border-b-0 rounded-t-xl bg-muted/10 pt-1.5 pb-1'
const GROUP_HEADER_CLOSED = 'mb-1.5' // standalone collapsed group
const GROUP_CHILD_MIDDLE = 'border-x bg-muted/10 py-0.5'
const GROUP_CHILD_LAST = 'border border-t-0 rounded-b-xl bg-muted/10 py-0.5 mb-1.5'

// ─── Sortable top-level server ────────────────────────────────────────────────

interface TopServerProps {
  dndId: string
  server: Server
  isActive: boolean
  unreadCount: number
  hasUnread: boolean
  hasVoice: boolean
  isGroupTarget: boolean
  onClick: () => void
}

function SortableTopServer({ dndId, server, isActive, unreadCount, hasUnread, hasVoice, isGroupTarget, onClick }: TopServerProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: dndId })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1 }}
      className="flex items-center justify-center mb-1.5"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={isActive ? 'secondary' : 'ghost'}
              size="icon"
              className={[
                'relative h-9 w-9 rounded-lg transition-[ring,transform] duration-150',
                isActive ? 'ring-1 ring-primary/70' : '',
                isGroupTarget ? 'ring-2 ring-cyan-400 scale-110' : '',
              ].join(' ')}
              onClick={onClick}
              {...attributes}
              {...listeners}
            />
          }
        >
          <ServerAvatar server={server} />
          {hasUnread ? (
            <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[9px] font-semibold leading-4 text-cyan-950 shadow-md">
              {formatUnreadCount(unreadCount)}
            </span>
          ) : null}
          {hasVoice ? (
            <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-emerald-500 text-emerald-950 shadow-md">
              <Volume2Icon className="size-2.5" />
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipContent side="right">{server.name}</TooltipContent>
      </Tooltip>
    </div>
  )
}

// ─── Sortable group header ────────────────────────────────────────────────────

interface GroupHeaderProps {
  dndId: string
  group: ServerGroup
  servers: Server[]
  hasAnyUnread: boolean
  totalUnread: number
  hasAnyVoice: boolean
  hasActiveServer: boolean
  isGroupTarget: boolean
  isExpanded: boolean
  onToggleCollapse: () => void
}

function SortableGroupHeader({
  dndId,
  group,
  servers,
  hasAnyUnread,
  totalUnread,
  hasAnyVoice,
  hasActiveServer,
  isGroupTarget,
  isExpanded,
  onToggleCollapse,
}: GroupHeaderProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: dndId })
  const groupServers = group.serverIds.map((id) => servers.find((s) => s.id === id)).filter(Boolean) as Server[]

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1 }}
      className={`w-full flex items-center justify-center border-border/50 ${isExpanded ? GROUP_HEADER_OPEN : GROUP_HEADER_CLOSED}`}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={hasActiveServer ? 'secondary' : 'ghost'}
              size="icon"
              className={[
                'relative h-9 w-9 rounded-lg transition-[ring,transform] duration-150',
                hasActiveServer ? 'ring-1 ring-primary/70' : '',
                isGroupTarget ? 'ring-2 ring-cyan-400 scale-110' : '',
              ].join(' ')}
              onClick={onToggleCollapse}
              {...attributes}
              {...listeners}
            />
          }
        >
          <div className="grid grid-cols-2 gap-px p-0.5 w-full h-full">
            {groupServers.slice(0, 4).map((s) => (
              <div key={s.id} className="overflow-hidden rounded-sm">
                <Avatar className="size-full rounded-none">
                  {s.iconUrl ? <AvatarImage src={s.iconUrl} alt={s.name} /> : null}
                  <AvatarFallback className="rounded-none bg-primary/10 text-[6px]">{serverInitials(s.name)}</AvatarFallback>
                </Avatar>
              </div>
            ))}
            {Array.from({ length: Math.max(0, 4 - groupServers.length) }).map((_, i) => (
              <div key={i} className="rounded-sm bg-muted/30" />
            ))}
          </div>
          {hasAnyUnread ? (
            <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[9px] font-semibold leading-4 text-cyan-950 shadow-md">
              {formatUnreadCount(totalUnread)}
            </span>
          ) : null}
          {hasAnyVoice ? (
            <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-emerald-500 text-emerald-950 shadow-md">
              <Volume2Icon className="size-2.5" />
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipContent side="right">{group.label}</TooltipContent>
      </Tooltip>
    </div>
  )
}

// ─── Sortable grouped server (inside an expanded group) ───────────────────────

interface GroupedServerProps {
  dndId: string
  server: Server
  isActive: boolean
  unreadCount: number
  hasUnread: boolean
  hasVoice: boolean
  isGroupTarget: boolean
  isLast: boolean
  onClick: () => void
}

function SortableGroupedServer({ dndId, server, isActive, unreadCount, hasUnread, hasVoice, isGroupTarget, isLast, onClick }: GroupedServerProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: dndId })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1 }}
      className={`w-full flex items-center justify-center border-border/50 ${isLast ? GROUP_CHILD_LAST : GROUP_CHILD_MIDDLE}`}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={isActive ? 'secondary' : 'ghost'}
              size="icon"
              className={[
                'relative h-8 w-8 rounded-md transition-[ring,transform] duration-150',
                isActive ? 'ring-1 ring-primary/70' : '',
                isGroupTarget ? 'ring-2 ring-cyan-400 scale-110' : '',
              ].join(' ')}
              onClick={onClick}
              {...attributes}
              {...listeners}
            />
          }
        >
          <ServerAvatar server={server} size="sm" />
          {hasUnread ? (
            <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[9px] font-semibold leading-4 text-cyan-950 shadow-md">
              {formatUnreadCount(unreadCount)}
            </span>
          ) : null}
          {hasVoice ? (
            <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-emerald-500 text-emerald-950 shadow-md">
              <Volume2Icon className="size-2.5" />
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipContent side="right">{server.name}</TooltipContent>
      </Tooltip>
    </div>
  )
}

// ─── AppRail ──────────────────────────────────────────────────────────────────

export function AppRail({
  servers,
  activeServerId,
  activeDmIdentity,
  quickDmContacts,
  onOpenHome,
  onOpenServer,
  onOpenDmHome,
  onOpenDmCompose,
  onOpenDmContact,
  onOpenCreateServer,
  onOpenSettings,
  isSettingsActive,
  hasUnreadInServer,
  countUnreadInServer,
  countUnreadInDm,
  dmUnreadByIdentity,
  hasVoiceActivityInServer,
  dmCallActiveByIdentity,
}: AppRailProps) {
  const { order, groups, syncServers, toggleGroupCollapsed } = useServerRailStore()

  useEffect(() => {
    syncServers(servers.map((s) => s.id))
  }, [servers, syncServers])

  const dmUnreadTotal = countUnreadInDm()
  const dmHomeActive = !isSettingsActive && !activeServerId && !activeDmIdentity

  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [tempCollapsedGroupId, setTempCollapsedGroupId] = useState<string | null>(null)
  const [dropSortTarget, setDropSortTarget] = useState<{ overId: string; insertBefore: boolean } | null>(null)

  const pointerYRef = useRef<number>(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const flatIdsRef = useRef<string[]>([])
  // Tracks which over-item we've locked into group mode for — cleared when over-item changes
  const groupLockRef = useRef<string | null>(null)
  // Shadow of dragIntent/dragOverId for use inside callbacks without stale closures
  const dragIntentRef = useRef<'sort' | 'group'>('sort')

  useEffect(() => {
    const handler = (e: PointerEvent) => { pointerYRef.current = e.clientY }
    window.addEventListener('pointermove', handler, { passive: true })
    return () => window.removeEventListener('pointermove', handler)
  }, [])

  const expandedGroupIds = useMemo(() => {
    const set = new Set<string>()
    for (const [gid, g] of Object.entries(groups)) {
      if (!g.collapsed && gid !== tempCollapsedGroupId) set.add(gid)
    }
    return set
  }, [groups, tempCollapsedGroupId])

  const flatIds = useMemo(
    () => buildFlatIds(order, groups, expandedGroupIds),
    [order, groups, expandedGroupIds],
  )

  useEffect(() => { flatIdsRef.current = flatIds }, [flatIds])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleDragStart = useCallback((e: DragStartEvent) => {
    const id = String(e.active.id)
    setActiveDragId(id)
    setDragOverId(null)
    setDropSortTarget(null)
    dragIntentRef.current = 'sort'
    groupLockRef.current = null
    if (id.startsWith('g:')) setTempCollapsedGroupId(id.slice(2))
  }, [])

  const handleDragMove = useCallback((e: DragMoveEvent) => {
    const clear = () => {
      dragIntentRef.current = 'sort'
      groupLockRef.current = null
      setDragOverId(null)
      setDropSortTarget(null)
    }

    if (!e.over) { clear(); return }

    const overId = String(e.over.id)
    const activeId = String(e.active.id)
    if (overId === activeId) { clear(); return }

    const canGroup =
      (activeId.startsWith('s:') || activeId.startsWith('sg:')) &&
      (overId.startsWith('s:') || overId.startsWith('g:') || overId.startsWith('sg:'))

    // Reset group lock when the over item changes
    if (groupLockRef.current !== null && groupLockRef.current !== overId) {
      groupLockRef.current = null
    }

    let newIntent: 'sort' | 'group' = 'sort'
    if (canGroup) {
      if (groupLockRef.current === overId) {
        // Already locked to this item — stay in group mode
        newIntent = 'group'
      } else {
        const overRect = e.over.rect
        const itemCenter = overRect.top + overRect.height / 2
        const distFromCenter = Math.abs(pointerYRef.current - itemCenter) / (overRect.height / 2)
        if (distFromCenter < 0.5) {
          groupLockRef.current = overId
          newIntent = 'group'
        }
      }
    }

    if (newIntent !== dragIntentRef.current) {
      dragIntentRef.current = newIntent
    }

    if (newIntent === 'group') {
      setDragOverId(overId)
      setDropSortTarget(null)
      return
    }

    // Sort mode — insert a spacer before/after the over item
    setDragOverId(null)
    const ids = flatIdsRef.current
    const overIndex = ids.indexOf(overId)
    const activeIndex = ids.indexOf(activeId)
    if (overIndex !== -1 && activeIndex !== -1 && overIndex !== activeIndex) {
      const insertBefore = pointerYRef.current < e.over.rect.top + e.over.rect.height / 2
      setDropSortTarget({ overId, insertBefore })
      return
    }
    setDropSortTarget(null)
  }, [])

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e
    const activeId = String(active.id)
    const overId = over ? String(over.id) : null

    const intent = dragIntentRef.current
    dragIntentRef.current = 'sort'
    groupLockRef.current = null
    setDragOverId(null)
    setDropSortTarget(null)
    setActiveDragId(null)
    setTempCollapsedGroupId(null)

    if (!overId || activeId === overId) return

    const state = useServerRailStore.getState()

    if (intent === 'group') {
      let sourceServerId: number | null = null
      let sourceGroupId: string | null = null
      if (activeId.startsWith('s:')) {
        sourceServerId = Number(activeId.slice(2))
      } else if (activeId.startsWith('sg:')) {
        const parts = activeId.split(':')
        sourceGroupId = parts[1]
        sourceServerId = Number(parts[2])
      }
      if (sourceServerId === null) return

      if (sourceGroupId) {
        state.removeFromGroup(sourceServerId, sourceGroupId)
        const fresh = useServerRailStore.getState()
        if (overId.startsWith('g:')) fresh.addToGroup(sourceServerId, overId.slice(2))
        else if (overId.startsWith('sg:')) fresh.addToGroup(sourceServerId, overId.split(':')[1])
        else if (overId.startsWith('s:')) fresh.createGroup(sourceServerId, Number(overId.slice(2)))
        return
      }

      if (overId.startsWith('g:')) state.addToGroup(sourceServerId, overId.slice(2))
      else if (overId.startsWith('sg:')) state.addToGroup(sourceServerId, overId.split(':')[1])
      else if (overId.startsWith('s:')) state.createGroup(sourceServerId, Number(overId.slice(2)))
      return
    }

    // Sort intent — use pointer Y to determine insert before/after the over item
    const currentFlatIds = buildFlatIds(state.order, state.groups, expandedGroupIds)
    const oldIndex = currentFlatIds.indexOf(activeId)
    const overIndex = currentFlatIds.indexOf(overId)
    if (oldIndex === -1 || overIndex === -1 || oldIndex === overIndex) return

    const overCenterY = over!.rect.top + over!.rect.height / 2
    const insertBefore = pointerYRef.current < overCenterY
    const newIndex = insertBefore
      ? (oldIndex < overIndex ? overIndex - 1 : overIndex)
      : (oldIndex > overIndex ? overIndex + 1 : overIndex)

    if (newIndex === oldIndex) return
    const newFlat = arrayMove(currentFlatIds, oldIndex, newIndex)
    const { order: newOrder, groups: newGroups } = flatToHierarchical(newFlat, state.groups, expandedGroupIds)
    state.setOrderAndGroups(newOrder, newGroups)
  }, [expandedGroupIds])

  const activeDragServer = useMemo(() => {
    if (!activeDragId) return null
    if (activeDragId.startsWith('s:')) return servers.find((s) => s.id === Number(activeDragId.slice(2))) ?? null
    if (activeDragId.startsWith('sg:')) return servers.find((s) => s.id === Number(activeDragId.split(':')[2])) ?? null
    return null
  }, [activeDragId, servers])

  const activeDragGroup = useMemo(() => {
    if (!activeDragId?.startsWith('g:')) return null
    return groups[activeDragId.slice(2)] ?? null
  }, [activeDragId, groups])

  const dropSpacer = (
    <div key="drop-spacer" className="w-full flex items-center" style={{ height: 10 }}>
      <div className="h-0.5 w-full rounded-full bg-primary/70" />
    </div>
  )

  // Build flat render list — group header + children share border styling
  const renderList = () => {
    const elements: React.ReactNode[] = []
    for (let i = 0; i < flatIds.length; i++) {
      const flatId = flatIds[i]
      const isDropTarget = dropSortTarget?.overId === flatId
      if (isDropTarget && dropSortTarget!.insertBefore) elements.push(dropSpacer)

      if (flatId.startsWith('s:')) {
        const serverId = Number(flatId.slice(2))
        const server = servers.find((s) => s.id === serverId)
        if (!server) continue
        elements.push(
          <SortableTopServer
            key={flatId}
            dndId={flatId}
            server={server}
            isActive={activeServerId === serverId}
            unreadCount={countUnreadInServer(serverId)}
            hasUnread={hasUnreadInServer(serverId)}
            hasVoice={hasVoiceActivityInServer(serverId)}
            isGroupTarget={dragOverId === flatId}
            onClick={() => onOpenServer(serverId)}
          />
        )
      } else if (flatId.startsWith('g:')) {
        const groupId = flatId.slice(2)
        const group = groups[groupId]
        if (!group) continue
        const isExpanded = flatIds[i + 1]?.startsWith(`sg:${groupId}:`) ?? false
        const groupServers = group.serverIds.map((id) => servers.find((s) => s.id === id)).filter(Boolean) as Server[]
        elements.push(
          <SortableGroupHeader
            key={flatId}
            dndId={flatId}
            group={group}
            servers={servers}
            hasAnyUnread={groupServers.some((s) => hasUnreadInServer(s.id))}
            totalUnread={groupServers.reduce((acc, s) => acc + countUnreadInServer(s.id), 0)}
            hasAnyVoice={groupServers.some((s) => hasVoiceActivityInServer(s.id))}
            hasActiveServer={groupServers.some((s) => s.id === activeServerId)}
            isGroupTarget={dragOverId === flatId}
            isExpanded={isExpanded}
            onToggleCollapse={() => toggleGroupCollapsed(groupId)}
          />
        )
      } else if (flatId.startsWith('sg:')) {
        const parts = flatId.split(':')
        const groupId = parts[1]
        const serverId = Number(parts[2])
        const server = servers.find((s) => s.id === serverId)
        if (!server) continue
        const isLast = !(flatIds[i + 1]?.startsWith(`sg:${groupId}:`))
        elements.push(
          <SortableGroupedServer
            key={flatId}
            dndId={flatId}
            server={server}
            isActive={activeServerId === serverId}
            unreadCount={countUnreadInServer(serverId)}
            hasUnread={hasUnreadInServer(serverId)}
            hasVoice={hasVoiceActivityInServer(serverId)}
            isGroupTarget={dragOverId === flatId}
            isLast={isLast}
            onClick={() => onOpenServer(serverId)}
          />
        )
      }

      if (isDropTarget && !dropSortTarget!.insertBefore) elements.push(dropSpacer)
    }
    return elements
  }

  return (
    <Card className="flex h-full min-h-0 flex-col border-border/60 bg-card/80 backdrop-blur py-0">
      <CardContent className="flex min-h-0 flex-1 flex-col items-center gap-1 px-0 py-1">
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="secondary" size="icon" className="relative mt-0.5 h-9 w-9 rounded-lg" />}
            onClick={onOpenHome}
          >
            <img src={stealthChatLogo} alt="StealthChat" className="h-6 w-6 object-contain" />
          </TooltipTrigger>
          <TooltipContent>Home</TooltipContent>
        </Tooltip>

        <Separator className="my-0.5" />

        <div className="relative min-h-0 flex-1 w-full">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-3 bg-linear-to-b from-card/90 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-3 bg-linear-to-t from-card/90 to-transparent" />
          <div ref={scrollContainerRef} className="h-full overflow-y-auto scrollbar-none">
            {/* gap-0 here — items control their own bottom margin */}
            <div className="flex flex-col items-center gap-0 px-1.5 pt-2 pb-1.5">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={flatIds} strategy={noopStrategy}>
                  {renderList()}
                </SortableContext>

                <DragOverlay dropAnimation={null}>
                  {activeDragServer ? (
                    <div className="opacity-80 shadow-lg rounded-lg">
                      <ServerAvatar server={activeDragServer} />
                    </div>
                  ) : activeDragGroup ? (
                    <div className="h-9 w-9 rounded-lg opacity-80 shadow-lg bg-muted border border-border grid grid-cols-2 gap-px p-0.5">
                      {activeDragGroup.serverIds.slice(0, 4).map((sid) => {
                        const s = servers.find((sv) => sv.id === sid)
                        return s ? (
                          <div key={sid} className="overflow-hidden rounded-sm">
                            <Avatar className="size-full rounded-none">
                              {s.iconUrl ? <AvatarImage src={s.iconUrl} alt={s.name} /> : null}
                              <AvatarFallback className="rounded-none bg-primary/10 text-[6px]">{serverInitials(s.name)}</AvatarFallback>
                            </Avatar>
                          </div>
                        ) : <div key={sid} className="rounded-sm bg-muted/30" />
                      })}
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>

              <div className="flex items-center justify-center mb-0.5">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg border border-dashed border-border/70" onClick={onOpenCreateServer} />
                    }
                  >
                    <PlusIcon className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent side="right">Create Server</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>

        <Separator className="my-0.5" />

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={dmHomeActive ? 'secondary' : 'ghost'}
                size="icon"
                className={`relative h-8 w-8 rounded-md ${dmHomeActive ? 'ring-1 ring-primary/70' : ''}`}
                onClick={onOpenDmHome}
              />
            }
          >
            <MessageCircleIcon className="size-4" />
            {dmUnreadTotal > 0 ? (
              <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[9px] font-semibold leading-4 text-cyan-950 shadow-md">
                {formatUnreadCount(dmUnreadTotal)}
              </span>
            ) : null}
          </TooltipTrigger>
          <TooltipContent side="right">DM Home</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon" className="relative h-8 w-8 rounded-md" onClick={onOpenDmCompose} />
            }
          >
            <MessageCircleIcon className="size-4" />
            <span className="absolute -right-0.5 -top-0.5 grid size-3 place-items-center rounded-full bg-primary text-[10px] leading-none text-primary-foreground">+</span>
          </TooltipTrigger>
          <TooltipContent side="right">Compose DM</TooltipContent>
        </Tooltip>

        {quickDmContacts.length > 0 ? (
          <div className="flex flex-col items-center gap-1 py-1">
            {quickDmContacts.map((contact) => {
              const unread = dmUnreadByIdentity[normalizeIdentity(contact.identity)] ?? 0
              return (
                <Tooltip key={contact.identity}>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`relative h-8 w-8 rounded-md ${activeDmIdentity === contact.identity ? 'ring-1 ring-primary/70' : ''}`}
                        onClick={() => onOpenDmContact(contact.identity)}
                      />
                    }
                  >
                    <Avatar size="sm" className="rounded-full">
                      {contact.avatarUrl ? <AvatarImage src={contact.avatarUrl} alt={contact.label} /> : null}
                      <AvatarFallback className="rounded-full bg-primary/10 text-[10px]">{userInitials(contact.label)}</AvatarFallback>
                    </Avatar>
                    {unread > 0 ? (
                      <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[9px] font-semibold leading-4 text-cyan-950 shadow-md">
                        {formatUnreadCount(unread)}
                      </span>
                    ) : null}
                    {dmCallActiveByIdentity[contact.identity] ? (
                      <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-emerald-500 text-emerald-950 shadow-md">
                        <Volume2Icon className="size-2.5" />
                      </span>
                    ) : null}
                  </TooltipTrigger>
                  <TooltipContent side="right">{contact.label}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        ) : null}

        <div className="mt-auto" />

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={isSettingsActive ? 'secondary' : 'ghost'}
                size="icon"
                className={`mb-0.5 h-9 w-9 rounded-lg ${isSettingsActive ? 'ring-1 ring-primary/70' : ''}`}
                onClick={onOpenSettings}
              />
            }
          >
            <SettingsIcon className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
      </CardContent>
    </Card>
  )
}