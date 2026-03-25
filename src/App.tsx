import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './layouts/AppLayout'
import { AuthPage } from './pages/AuthPage'
import { InvitePage } from './pages/InvitePage'
import { AppIndexPage } from './pages/AppIndexPage'
import { ServerChannelPage } from './pages/ServerChannelPage'
import { DMPage } from './pages/DMPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />

      <Route path="/app" element={<AppLayout />}>
        <Route index element={<AppIndexPage />} />
        <Route path="dm/:identity" element={<DMPage />} />
        <Route path=":serverId" element={<ServerChannelPage />} />
        <Route path=":serverId/:channelId" element={<ServerChannelPage />} />
      </Route>
    </Routes>
  )
}

export default App
