import { Navigate } from 'react-router-dom'
import { useServersStore } from '../stores/serversStore'
import { useIsMobile } from '../hooks/use-mobile'
import { appHomePath } from '../layouts/app-layout/navigation'

export function AppIndexPage() {
  const servers = useServersStore((s) => s.servers)
  const activeServerId = useServersStore((s) => s.activeServerId)

  const compact = useIsMobile()
  return <Navigate to={appHomePath(compact, servers.map(server => server.id), activeServerId)} replace />
}
