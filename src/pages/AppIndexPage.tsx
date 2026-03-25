import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useServersStore } from '../stores/serversStore'
import { FriendsView } from '../features/friends/FriendsView'

export function AppIndexPage() {
  const navigate = useNavigate()
  const servers = useServersStore((s) => s.servers)

  useEffect(() => {
    if (servers.length > 0) {
      navigate(`/app/${servers[0].id}`, { replace: true })
    }
  }, [navigate, servers])

  if (servers.length === 0) {
    return <FriendsView />
  }

  return null
}
