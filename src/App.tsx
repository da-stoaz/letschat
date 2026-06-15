import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppLayout } from './layouts/AppLayout'
import { AuthPage } from './pages/AuthPage'
import { InvitePage } from './pages/InvitePage'
import { SetupPage } from './pages/SetupPage'
import { AppIndexPage } from './pages/AppIndexPage'
import { ServerChannelPage } from './pages/ServerChannelPage'
import { ServerManagePage } from './pages/ServerManagePage'
import { DMPage } from './pages/DMPage'
import { SettingsPage } from './pages/SettingsPage'
import { DiscoverPage } from './pages/DiscoverPage'
import { useSelfStore } from './stores/selfStore'
import { useConnectionStore } from './stores/connectionStore'
import { useUiStore } from './stores/uiStore'
import { useServerConfigStore } from './stores/serverConfigStore'
import { useDeepLink } from './hooks/useDeepLink'
import { useWebAutoConfig } from './hooks/useWebAutoConfig'
import { WebJoinPage } from './pages/WebJoinPage'
import { WebConnectErrorPage } from './pages/WebConnectErrorPage'
import { DesktopAppBanner } from './features/web/DesktopAppBanner'
import { usePresenceLifecycle } from './hooks/usePresenceLifecycle'
import { useVoiceStateReconciler } from './hooks/useVoiceStateReconciler'
import { ensureNotificationPermission } from './lib/notifications'
import { SplashScreen } from './components/SplashScreen'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoaderCircleIcon } from 'lucide-react'

function App() {
  useDeepLink()
  const webAutoConfig = useWebAutoConfig()
  usePresenceLifecycle()
  useVoiceStateReconciler()
  const user = useSelfStore((s) => s.user)
  const connectionStatus = useConnectionStore((s) => s.status)
  const notificationsEnabled = useUiStore((s) => s.notificationSettings.enabled)
  const isConfigured = useServerConfigStore((s) => s.config !== null)
  const hasHydrated = useServerConfigStore((s) => s.hasHydrated)
  const location = useLocation()
  const onAuthRoute = location.pathname.startsWith('/auth')
  const onSetupRoute = location.pathname.startsWith('/setup')
  const onJoinRoute = location.pathname.startsWith('/join')

  useEffect(() => {
    if (!notificationsEnabled) return
    void ensureNotificationPermission({ prompt: false })
  }, [notificationsEnabled])

  if (!hasHydrated) {
    return <SplashScreen />
  }

  // Hosted-web build: single-tenant, locked to its own instance. It must NEVER
  // show the desktop "pick a server" Setup screen. While discovery is in flight
  // show the splash; if it fails show a locked retry screen — not the picker.
  const isHostedWeb = webAutoConfig !== 'inactive'
  if (isHostedWeb && !isConfigured) {
    return webAutoConfig === 'failed' ? <WebConnectErrorPage /> : <SplashScreen />
  }

  // Desktop / local dev only: unconfigured clients pick a server via Setup.
  if (!isHostedWeb && !isConfigured && !onSetupRoute && !onJoinRoute) {
    return <Navigate to="/setup" replace />
  }

  if (connectionStatus === 'connecting' && !user && !onAuthRoute && !onSetupRoute) {
    return (
      <main className="grid min-h-screen place-items-center bg-[radial-gradient(1200px_800px_at_10%_-20%,--theme(--color-blue-500/20),transparent),radial-gradient(900px_700px_at_100%_0%,--theme(--color-cyan-500/15),transparent)] p-4">
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
    <div className="flex h-screen flex-col">
      <DesktopAppBanner />
      <div className="min-h-0 flex-1">
        <Routes>
      <Route path="/setup" element={isConfigured ? <Navigate to="/" replace /> : <SetupPage />} />
      <Route path="/join" element={<WebJoinPage />} />
      <Route path="/" element={<Navigate to={user ? '/app' : '/auth'} replace />} />
      <Route path="/auth" element={user ? <Navigate to="/app" replace /> : <AuthPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />

      <Route path="/app" element={user ? <AppLayout /> : <Navigate to="/auth" replace />}>
        <Route index element={<AppIndexPage />} />
        <Route path="dm/:identity" element={<DMPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="discover" element={<DiscoverPage />} />
        <Route path=":serverId/manage" element={<ServerManagePage />} />
        <Route path=":serverId" element={<ServerChannelPage />} />
        <Route path=":serverId/:channelId" element={<ServerChannelPage />} />
      </Route>
        </Routes>
      </div>
    </div>
  )
}

export default App
