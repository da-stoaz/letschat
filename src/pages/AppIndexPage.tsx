import { Navigate } from 'react-router-dom'
import { useServersStore } from '../stores/serversStore'
import { FriendsView } from '../features/friends/FriendsView'

export function AppIndexPage() {
  const servers = useServersStore((s) => s.servers)

  if (servers.length === 0) {
    return <FriendsView />
  }

  return <Navigate to={`/app/${servers[0].id}`} replace />
}
