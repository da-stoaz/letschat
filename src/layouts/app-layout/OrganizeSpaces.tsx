import { useRef, useState } from 'react'
import { ListOrderedIcon } from 'lucide-react'
import { arrayMove } from '@dnd-kit/sortable'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useServerRailStore } from '../../stores/serverRailStore'
import type { Server } from '../../types/domain'

/** Explicit actions cover grouping as well as sorting, without a drag gesture. */
export function OrganizeSpaces({ servers }: { servers: Server[] }) {
  const rail = useServerRailStore()
  const [selectedId, setSelectedId] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const groupSelect = useRef<HTMLSelectElement>(null)
  const server = servers.find(row => String(row.id) === selectedId) ?? servers[0]
  const group = Object.values(rail.groups).find(row => row.serverIds.includes(server?.id))
  const item = group?.id ?? server?.id
  const index = rail.order.indexOf(item)
  const selectClass = 'w-full rounded-md border border-input bg-background p-2 text-sm'
  const announce = (action: string) => setAnnouncement(`${server?.name}: ${action}`)
  const move = (offset: number) => {
    rail.setOrderAndGroups(arrayMove(rail.order, index, index + offset), rail.groups)
    announce(`moved ${offset < 0 ? 'up' : 'down'}${group ? ' with its group' : ''}`)
  }
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Organize spaces" />}>
        <ListOrderedIcon className="size-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Organize spaces</DialogTitle>
        <DialogDescription>Choose a space, then move it or change its group.</DialogDescription>
        <label className="space-y-1">Space
          <select className={selectClass} value={server?.id ?? ''} onChange={event => setSelectedId(event.target.value)}>
            {servers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <div className="flex gap-2">
          <Button variant="outline" disabled={index <= 0} onClick={() => move(-1)}>Move up{group ? ' with group' : ''}</Button>
          <Button variant="outline" disabled={index < 0 || index >= rail.order.length - 1} onClick={() => move(1)}>Move down{group ? ' with group' : ''}</Button>
        </div>
        {server ? <label className="space-y-1">Group
          <select ref={groupSelect} className={selectClass} value={group?.id ?? ''} onChange={event => {
            if (group) rail.removeFromGroup(server.id, group.id)
            if (event.target.value) useServerRailStore.getState().addToGroup(server.id, event.target.value)
            announce(event.target.value ? 'moved into group' : 'moved out of group')
          }}>
            <option value="">No group</option>
            {Object.values(rail.groups).map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
          </select>
        </label> : null}
        {group && server ? <>
          <label className="space-y-1">Group name<Input value={group.label} onChange={event => rail.renameGroup(group.id, event.target.value)} /></label>
          <div className="flex flex-wrap gap-2">
            {[-1, 1].map(offset => <Button key={offset} variant="outline" disabled={offset < 0 ? group.serverIds[0] === server.id : group.serverIds.at(-1) === server.id} onClick={() => {
              const position = group.serverIds.indexOf(server.id)
              rail.setOrderAndGroups(rail.order, { ...rail.groups, [group.id]: { ...group, serverIds: arrayMove(group.serverIds, position, position + offset) } })
              announce(`moved ${offset < 0 ? 'up' : 'down'} inside ${group.label}`)
            }}>Move {offset < 0 ? 'up' : 'down'} inside group</Button>)}
          </div>
        </> : server ? <label className="space-y-1">Create a group with
          <select className={selectClass} value="" onChange={event => {
            if (event.target.value) {
              rail.createGroup(server.id, Number(event.target.value))
              announce('group created')
              requestAnimationFrame(() => groupSelect.current?.focus())
            }
          }}>
            <option value="">Choose another space…</option>
            {servers.filter(row => row.id !== server.id && rail.order.includes(row.id)).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label> : null}
        <p role="status" className="text-sm text-muted-foreground">{announcement}</p>
      </DialogContent>
    </Dialog>
  )
}
