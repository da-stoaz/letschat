import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './layouts/AppLayout'
import { AuthPage } from './pages/AuthPage'
import { InvitePage } from './pages/InvitePage'
import { AppIndexPage } from './pages/AppIndexPage'
import { ServerChannelPage } from './pages/ServerChannelPage'
import { DMPage } from './pages/DMPage'
import { useSelfStore } from './stores/selfStore'
import { useConnectionStore } from './stores/connectionStore'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoaderCircleIcon } from 'lucide-react'

function App() {
  const user = useSelfStore((s) => s.user)
  const connectionStatus = useConnectionStore((s) => s.status)

  if (connectionStatus === 'connecting' && !user) {
    return (
      <main className="grid min-h-screen place-items-center bg-[radial-gradient(1200px_800px_at_10%_-20%,theme(colors.blue.500/20),transparent),radial-gradient(900px_700px_at_100%_0%,theme(colors.cyan.500/15),transparent)] p-4">
        <Card className="w-full max-w-md border-border/70 bg-card/90 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LoaderCircleIcon className="size-5 animate-spin text-primary" />
              Connecting
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Establishing realtime connection...</CardContent>
        </Card>
      </main>
    )
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
