import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '../../src/App'
import { CompatibilityNotice } from '../../src/features/setup/CompatibilityNotice'
import { HostConfirmDialog } from '../../src/features/setup/HostConfirmDialog'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import { selectServer } from '../../src/lib/selectServer'
import { useCompatibilityStore } from '../../src/lib/compatibility'
import { tauriCommands } from '../../src/lib/tauri'
import '../../src/index.css'

const mode = new URLSearchParams(location.search).get('state') ?? 'incompatible'
const config = { authServiceUrl: 'https://fixture.test', discoveryUrl: 'https://fixture.test', spacetimedbUri: 'wss://fixture.test', livekitUrl: 'wss://voice.fixture.test', spacetimedbDatabase: 'letschat' }
let attempts = 0
window.fetch = async (url) => {
  if (!String(url).endsWith('/.well-known/letschat.json')) throw new Error('Fixture blocks all backend traffic')
  attempts++
  if (mode === 'unreachable') return new Response('', { status: 503 })
  if (mode === 'legacy') return new Response('', { status: 404 })
  return new Response(JSON.stringify({ auth: config.authServiceUrl, spacetimedb: config.spacetimedbUri, livekit: config.livekitUrl,
    clientProtocol: mode === 'compatible' ? 1 : 2, serverVersion: '2.0.0', minClient: '1.6.1', recommendedClient: '2.0.0', web: 'https://web.fixture.test' }))
}
// This fixture tests admission/UI, not transport. Absolutely no real socket opens.
window.WebSocket = class { constructor() { throw new Error('Fixture transport disabled after admission') } } as unknown as typeof WebSocket
tauriCommands.openUrl = async (url) => { document.title = `Opened ${url}` }

export function CompatibilityFixture() {
  const admitted = useCompatibilityStore(s => s.admittedKey)
  return <>
    <div className="fixed bottom-0 z-10 bg-background p-2 text-xs" data-testid="admission">{admitted ? 'Admission passed; transport disabled' : 'Not admitted'} · checks: {attempts}</div>
    <App />
    <CompatibilityNotice />
    <HostConfirmDialog />
  </>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><QueryClientProvider client={new QueryClient()}><TooltipProvider><MemoryRouter>
    <CompatibilityFixture />
  </MemoryRouter></TooltipProvider></QueryClientProvider></StrictMode>,
)
if (!new URLSearchParams(location.search).has('hosted')) void selectServer(config).catch(() => {})
