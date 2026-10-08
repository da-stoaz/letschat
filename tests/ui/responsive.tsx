import { AttachmentImageLightbox } from '../../src/features/chat/components/attachments/AttachmentImageLightbox'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppLayout } from '../../src/layouts/AppLayout'
import { NavigationPage } from '../../src/pages/NavigationPage'
import { ServerChannelPage } from '../../src/pages/ServerChannelPage'
import { DMPage } from '../../src/pages/DMPage'
import { SettingsPage } from '../../src/pages/SettingsPage'
import { AppIndexPage } from '../../src/pages/AppIndexPage'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import { Toaster } from '../../src/components/ui/sonner'
import { useViewport } from '../../src/hooks/useViewport'
import { useServersStore } from '../../src/stores/serversStore'
import { useChannelsStore } from '../../src/stores/channelsStore'
import { useConnectionStore } from '../../src/stores/connectionStore'
import { useUsersStore } from '../../src/stores/usersStore'
import { useSelfStore } from '../../src/stores/selfStore'
import { useMessagesStore } from '../../src/stores/messagesStore'
import { useMembersStore } from '../../src/stores/membersStore'
import { useFriendsStore } from '../../src/stores/friendsStore'
import { useDmStore } from '../../src/stores/dmStore'
import { useUiStore } from '../../src/stores/uiStore'
import { reducers } from '../../src/lib/spacetimedb'
import '../../src/index.css'

const now = new Date().toISOString()
const me = { identity: 'self', username: 'alex', displayName: 'Alex', avatarUrl: null, createdAt: now, isAdmin: false }
const friend = { ...me, identity: 'friend', username: 'sam', displayName: 'Sam with a longer display name' }
useConnectionStore.setState({ identity: me.identity, status: 'connected', synced: true })
useSelfStore.setState({ user: me })
useUsersStore.setState({ users: [me, friend], byIdentity: { self: me, friend } })
useServersStore.setState({ servers: [{ id: 1, name: 'A space with a long name for testing', ownerIdentity: me.identity, invitePolicy: 'Everyone', iconUrl: null, createdAt: now, isDiscoverable: false, description: null, tags: [] }] })
useChannelsStore.setState({ channelsByServer: { 1: [
  { id: 10, serverId: 1, name: 'general-with-a-long-channel-name', kind: 'Text', section: null, position: 0, moderatorOnly: false },
  { id: 11, serverId: 1, name: 'announcements', kind: 'Announcement', section: null, position: 1, moderatorOnly: true },
] } })
useMembersStore.getState().setServerMembers(1, [me, friend].map(user => ({ serverId: 1, userIdentity: user.identity, role: user === me ? 'Owner' : 'Member', joinedAt: now, timeoutUntil: null, user })))
useFriendsStore.setState({ friends: [{ userA: 'self', userB: 'friend', requestedBy: 'self', status: 'Accepted', updatedAt: now }] })
useMessagesStore.getState().setChannelMessages(10, Array.from({ length: 100 }, (_, index) => ({ id: index + 1, channelId: 10, senderIdentity: index % 2 ? 'self' : 'friend', content: index === 97 ? 'Long URL: https://example.com/' + 'abcdefghij'.repeat(20) : index === 98 ? '```\n' + 'long code '.repeat(30) + '\n```' : `Message ${index + 1}: Testing the responsive conversation.`, sentAt: new Date(Date.now() - (100 - index) * 60000).toISOString(), editedAt: null, deleted: false })))
useDmStore.setState({ conversations: { friend: [{ id: 200, senderIdentity: 'friend', recipientIdentity: 'self', content: 'Hello Alex', sentAt: now, editedAt: null, deletedBySender: false, deletedByRecipient: false }] } })
useUiStore.setState({ unreadByChannel: { 10: 4 }, rightPanelOpen: false })
reducers.markChannelRead = async () => {}
reducers.markDmRead = async () => {}
reducers.setTypingState = async () => {}
reducers.sendMessage = async (channelId, content) => {
  await new Promise(resolve => setTimeout(resolve, 1500))
  useMessagesStore.getState().appendMessage({ id: Date.now(), channelId, senderIdentity: 'self', content, sentAt: new Date().toISOString(), editedAt: null, deleted: false })
}
let failEdit = true
reducers.editMessage = async (id, content) => {
  await new Promise(resolve => setTimeout(resolve, 400))
  if (failEdit) { failEdit = false; throw new Error('Test save failure. Retry with Save.') }
  const messages = useMessagesStore.getState().messagesByChannel[10]
  useMessagesStore.getState().setChannelMessages(10, messages.map(message => message.id === id ? { ...message, content, editedAt: now } : message))
}

export function Fixture() {
  useViewport()
  const [preview, setPreview] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  useEffect(() => {
    const receive = (event: MessageEvent) => { if (event.origin !== window.location.origin) return; if (event.data.path) navigate(event.data.path); if (event.data.preview) setPreview(true) }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [navigate])
  useEffect(() => {
    const report = () => {
      const composer = document.querySelector('textarea')?.getBoundingClientRect()
      window.parent.postMessage({ report: `${window.innerWidth}px ${location.pathname}: page overflow ${document.documentElement.scrollWidth > window.innerWidth ? 'FAIL' : 'none'}; composer ${composer ? `${Math.round(composer.width)}px, ${composer.bottom <= window.innerHeight ? 'visible' : 'CLIPPED'}` : 'not on this screen'}` }, window.location.origin)
    }
    const observer = new ResizeObserver(report)
    observer.observe(document.documentElement)
    const timer = setTimeout(report, 250)
    return () => { observer.disconnect(); clearTimeout(timer) }
  }, [location])
  return <div className="app-viewport flex min-h-0 flex-col"><Routes>
    <Route path="/app" element={<AppLayout />}>
      <Route index element={<AppIndexPage />} />
      <Route path="spaces" element={<NavigationPage />} />
      <Route path="messages" element={<NavigationPage />} />
      <Route path=":serverId/channels" element={<NavigationPage />} />
      <Route path=":serverId/:channelId" element={<ServerChannelPage />} />
      <Route path="dm/:identity" element={<DMPage />} />
      <Route path="settings" element={<SettingsPage />} />
    </Route>
  </Routes><AttachmentImageLightbox images={[{ fileName: 'A long image filename for the mobile preview.svg', url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#075985"/><text x="320" y="250" fill="white" text-anchor="middle" font-size="32">Image preview fixture</text></svg>') }]} initialIndex={preview ? 0 : null} onClose={() => setPreview(false)} /></div>
}

document.documentElement.classList.add('dark')
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><TooltipProvider><MemoryRouter initialEntries={['/app/spaces']}><Fixture /><Toaster /></MemoryRouter></TooltipProvider></QueryClientProvider>)
