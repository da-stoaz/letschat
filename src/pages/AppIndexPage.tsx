import { Navigate } from 'react-router-dom'
import { useServersStore } from '../stores/serversStore'
import { FriendsView } from '../features/friends/FriendsView'

export function AppIndexPage() {
  const servers = useServersStore((s) => s.servers)
  const activeServerId = useServersStore((s) => s.activeServerId)

  if (servers.length === 0) {
    return <FriendsView />
  }

  const preferredServer = activeServerId !== null ? servers.find((server) => server.id === activeServerId) : null
  if (preferredServer) {
    return <Navigate to={`/app/${preferredServer.id}`} replace />
  }

  return <Navigate to={`/app/${servers[0].id}`} replace />
}
