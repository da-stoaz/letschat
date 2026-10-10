import { StrictMode, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import { TextChannelView } from '../../src/features/channels/TextChannelView'
import { DMView } from '../../src/features/dm/DMView'
import { useConnectionStore } from '../../src/stores/connectionStore'
import { useChannelsStore } from '../../src/stores/channelsStore'
import { useMessagesStore } from '../../src/stores/messagesStore'
import { useDmStore } from '../../src/stores/dmStore'
import { useUsersStore } from '../../src/stores/usersStore'
import { reducers } from '../../src/lib/spacetimedb'
import '../../src/index.css'

const sentAt = new Date().toISOString()
const messages = Array.from({ length: 3 }, (_, i) => ({ id: i + 1, channelId: 10, senderIdentity: 'self', content: `Message ${i + 1}`, sentAt, editedAt: null, deleted: false }))
useConnectionStore.setState({ identity: 'self' })
useChannelsStore.setState({ channelsByServer: { 1: [10, 11].map(id => ({ id, serverId: 1, name: `channel-${id}`, kind: 'Text', section: null, position: id, moderatorOnly: false })) } })
useMessagesStore.setState({ messagesByChannel: { 10: messages, 11: [] }, historyExhausted: { 10: true, 11: true } })
useDmStore.setState({ conversations: { friend: messages.map(m => ({ ...m, recipientIdentity: 'friend', deletedBySender: false, deletedByRecipient: false })) }, historyExhausted: { friend: true } })
reducers.markChannelRead = async () => {}
reducers.markDmRead = async () => {}

// Exercise the real callers: their feed and composer are siblings, so their
// keys must stay distinct during switches AND ordinary parent rerenders.
const paths = ['/channel/10', '/channel/11', '/channel/10', '/channel/11', '/channel/10', '/dm', '/dm', '/dm', '/dm', '/dm']
export function Regression() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [results, setResults] = useState<string[]>([])
  useLayoutEffect(() => {
    if (step >= paths.length) return
    navigate(paths[step])
    useUsersStore.setState(s => ({ byIdentity: { ...s.byIdentity } }))
    const timer = setTimeout(() => {
      const feeds = document.querySelectorAll('#conversation .app-scrollbar.h-full')
      const rows = document.querySelectorAll('#conversation [data-message-id]')
      const expected = paths[step].endsWith('/11') ? 0 : 3
      const unique = new Set(Array.from(rows, row => row.getAttribute('data-message-id')))
      setResults(previous => [...previous, `${feeds.length === 1 && rows.length === expected && unique.size === expected ? 'PASS' : 'FAIL'} ${paths[step]}: ${feeds.length} feeds, ${rows.length}/${expected} messages`])
      setStep(s => s + 1)
    }, 150)
    return () => clearTimeout(timer)
  }, [navigate, step])
  return <div className="flex h-full flex-col">
    <pre role="status" className="shrink-0 p-2 text-xs">{results.join('\n')}{step === paths.length ? '\nDone' : '\nRunning…'}</pre>
    <div id="conversation" className="min-h-0 flex-1">
      <Routes>
        <Route path="/channel/10" element={<TextChannelView channelId={10} />} />
        <Route path="/channel/11" element={<TextChannelView channelId={11} />} />
        <Route path="/dm" element={<DMView partnerIdentity="friend" />} />
      </Routes>
    </div>
  </div>
}
document.documentElement.classList.add('dark')
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={new QueryClient()}><TooltipProvider><MemoryRouter initialEntries={[paths[0]]}><Regression /></MemoryRouter></TooltipProvider></QueryClientProvider></StrictMode>)
