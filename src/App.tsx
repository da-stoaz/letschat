import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './layouts/AppLayout'
import { AuthPage } from './pages/AuthPage'
import { InvitePage } from './pages/InvitePage'
import { AppIndexPage } from './pages/AppIndexPage'
import { ServerChannelPage } from './pages/ServerChannelPage'
import { DMPage } from './pages/DMPage'
import { useSelfStore } from './stores/selfStore'
import { useConnectionStore } from './stores/connectionStore'

function App() {
  const user = useSelfStore((s) => s.user)
  const connectionStatus = useConnectionStore((s) => s.status)

  if (connectionStatus === 'connecting' && !user) {
    return <main className="pane-empty">Connecting...</main>
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to={user ? '/app' : '/auth'} replace />} />
      <Route path="/auth" element={user ? <Navigate to="/app" replace /> : <AuthPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />

      <Route path="/app" element={user ? <AppLayout /> : <Navigate to="/auth" replace />}>
        <Route index element={<AppIndexPage />} />
        <Route path="dm/:identity" element={<DMPage />} />
        <Route path=":serverId" element={<ServerChannelPage />} />
        <Route path=":serverId/:channelId" element={<ServerChannelPage />} />
      </Route>
    </Routes>
  )
}

export default App
