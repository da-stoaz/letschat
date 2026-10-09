import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRail } from '../../src/layouts/app-layout/AppRail'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import { useServerRailStore } from '../../src/stores/serverRailStore'
import type { Server } from '../../src/types/domain'
import '../../src/index.css'

const servers: Server[] = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((name, index) => ({
  id: index + 1, name, ownerIdentity: 'fixture', invitePolicy: 'Everyone',
  iconUrl: index % 2 === 0 ? `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><rect width="36" height="36" fill="teal"/><text x="10" y="25" fill="white">${name[0]}</text></svg>`)}` : null,
  createdAt: new Date(0).toISOString(), isDiscoverable: false, description: null, tags: [],
}))
useServerRailStore.persist.setOptions({ name: 'letschat.rail-drag-fixture' })
useServerRailStore.setState({ order: [1, 2, 3, 4], groups: {} })

const pause = () => new Promise(resolve => setTimeout(resolve, 30))
const sortable = (label: string) => document.querySelector<HTMLElement>(`[aria-roledescription="sortable"][aria-label="${label}"]`)!
const state = () => useServerRailStore.getState()
const cancel = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
const reset = async () => { cancel(); await pause(); state().setOrderAndGroups([1, 2, 3, 4], {}); await pause() }
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }

async function gesture(from: string, to: string, edge: 'before' | 'center' | 'after', finish = 'pointerup', pointerType = 'mouse') {
  const source = sortable(from)
  const target = sortable(to)
  const start = source.getBoundingClientRect()
  const x = start.left + start.width / 2
  const y = start.top + start.height / 2
  const pointer = (type: string, clientY: number) => new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType, isPrimary: true, button: 0, buttons: type === 'pointermove' || type === 'pointerdown' ? 1 : 0, clientX: x, clientY })
  const activator = source.querySelector('img') ?? source
  activator.dispatchEvent(pointer('pointerdown', y))
  document.dispatchEvent(pointer('pointermove', y + 10))
  await pause()
  // Whole folders collapse on pickup; aim at the resulting target position.
  const end = target.getBoundingClientRect()
  const endY = edge === 'center' ? end.top + end.height / 2 : edge === 'before' ? end.top + 2 : end.bottom - 2
  const steps = Math.max(6, Math.ceil(Math.abs(endY - y) / 3))
  for (let i = 1; i <= steps; i++) {
    document.dispatchEvent(pointer('pointermove', y + (endY - y) * i / steps))
    await pause()
  }
  const marker = document.querySelector<HTMLElement>('[data-rail-drop]')
  const preview = marker?.dataset.railDrop
  const bounds = marker?.firstElementChild?.getBoundingClientRect() ?? marker?.getBoundingClientRect()
  assert(bounds && bounds.width > 0 && bounds.height > 0, `${from} → ${to}: missing visible drop indicator`)
  if (preview === 'sort') assert(Math.abs(target.getBoundingClientRect().top - end.top) < 1, `${from} → ${to}: insertion marker shifted the target`)
  if (finish === 'hold') return preview
  document.dispatchEvent(pointer(finish, endY))
  await pause()
  assert(!document.querySelector('[data-rail-drop]'), 'Drop indicator survived release/cancel')
  return preview
}

export function RailDragFixture() {
  const { order, groups } = useServerRailStore()
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    setResult('Checking…')
    try { setResult(await work()) } catch (error) { cancel(); setResult(`FAIL: ${String(error)}`) }
    finally { setBusy(false) }
  }
  const checks = async () => {
    await reset()
    assert([...document.querySelectorAll('img')].filter(image => image.closest('[aria-roledescription="sortable"]')).every(image => !image.draggable), 'Space images must not start native image dragging')
    assert(await gesture('Alpha', 'Delta', 'after') === 'sort', 'Center-to-edge drag stayed in group mode')
    assert(JSON.stringify(state().order) === '[2,3,4,1]', 'Downward reorder failed')
    assert(await gesture('Alpha', 'Bravo', 'before') === 'sort', 'Upward insertion marker missing')
    assert(JSON.stringify(state().order) === '[1,2,3,4]', 'Upward reorder failed')
    assert(await gesture('Alpha', 'Bravo', 'center') === 'group', 'Grouping dot missing')
    const group = Object.values(state().groups)[0]
    assert(group?.serverIds.join() === '2,1' && state().order[0] === group.id, 'Group creation or position failed')
    assert(await gesture('Charlie', 'Group', 'center') === 'group', 'Existing group dot missing')
    assert(state().groups[group.id].serverIds.join() === '2,1,3', 'Adding a space failed')
    assert(await gesture('Charlie', 'Bravo', 'before') === 'sort', 'Within-group reorder tried to regroup')
    assert(state().groups[group.id].serverIds.join() === '3,2,1', 'Within-group reorder failed')
    await gesture('Charlie', 'Delta', 'after')
    assert(state().groups[group.id].serverIds.join() === '2,1' && JSON.stringify(state().order) === JSON.stringify([group.id, 4, 3]), 'Moving out of the group failed')
    await gesture('Group', 'Charlie', 'after')
    assert(JSON.stringify(state().order) === JSON.stringify([4, 3, group.id]) && state().groups[group.id].serverIds.join() === '2,1', 'Moving the entire group failed')
    state().toggleGroupCollapsed(group.id)
    await pause()
    assert(await gesture('Delta', 'Group', 'center') === 'group', 'Collapsed group dot missing')
    assert(state().groups[group.id].serverIds.join() === '2,1,4', 'Adding to a collapsed group failed')
    await reset()
    await gesture('Alpha', 'Delta', 'after', 'pointercancel')
    assert(JSON.stringify(state().order) === '[1,2,3,4]' && sortable('Alpha').getAttribute('aria-pressed') !== 'true', 'Cancelled drag changed order or remained active')
    await gesture('Alpha', 'Delta', 'after', 'pointerup', 'touch')
    assert(JSON.stringify(state().order) === '[2,3,4,1]' && sortable('Alpha').style.touchAction === 'none', 'Touch reorder failed')
    return 'PASS: 10 drag gestures, insertion bars, grouping dots, stable targets, image and touch handling'
  }
  const preview = async (edge: 'center' | 'after') => {
    await reset()
    await gesture('Alpha', 'Delta', edge, 'hold')
    return `Preview: ${edge === 'center' ? 'grouping dot' : 'insertion bar'}. Press Escape to cancel.`
  }
  return <main className="flex h-dvh gap-6 bg-background p-2 text-foreground">
    <div className="w-12 shrink-0"><AppRail servers={servers} activeServerId={1} activeDmIdentity={null} quickDmContacts={[]}
      onOpenServer={() => {}} onOpenDmHome={() => {}} onOpenDmCompose={() => {}} onOpenDmContact={() => {}}
      onOpenCreateServer={() => {}} onOpenDiscover={() => {}} onOpenSettings={() => {}} isDiscoverActive={false} isSettingsActive={false}
      hasUnreadInServer={() => false} countUnreadInServer={() => 0} countUnreadInDm={() => 0} dmUnreadByIdentity={{}}
      hasVoiceActivityInServer={() => false} dmCallActiveByIdentity={{}} /></div>
    <section className="space-y-3"><h1>Rail drag verification</h1><p>Drag between icon edges to reorder; onto a center to group.</p>
      <button onClick={() => useServerRailStore.setState({ order: [1, 2, 3, 4], groups: {} })}>Reset sample rail</button>
      <div className="flex gap-4">
        <button disabled={busy} onClick={() => void run(checks)}>Check rail drag gestures</button>
        <button disabled={busy} onClick={() => void run(() => preview('after'))}>Preview insertion bar</button>
        <button disabled={busy} onClick={() => void run(() => preview('center'))}>Preview grouping dot</button>
      </div><output role="status">{result}</output>
      <pre aria-label="Rail order">{JSON.stringify({ order, groups }, null, 2)}</pre>
    </section>
  </main>
}
document.documentElement.classList.add('dark')
createRoot(document.getElementById('root')!).render(<TooltipProvider><RailDragFixture /></TooltipProvider>)
