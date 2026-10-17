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
import { useServerConfigStore } from '../../src/stores/serverConfigStore'
import { initializeSpacetime } from '../../src/lib/spacetimedb/auth'
import { tauriCommands } from '../../src/lib/tauri'
import '../../src/index.css'

const params = new URLSearchParams(location.search)
const mode = params.get('state') ?? 'incompatible'
const entry = params.get('entry') ?? 'selection'
const config = { authServiceUrl: 'https://fixture.test', discoveryUrl: 'https://fixture.test', spacetimedbUri: 'wss://fixture.test', livekitUrl: 'wss://voice.fixture.test', spacetimedbDatabase: 'letschat' }
window.fetch = async (url) => {
  if (!String(url).endsWith('/.well-known/letschat.json')) throw new Error('Fixture blocks all backend traffic')
  if (mode === 'unreachable') return new Response('', { status: 503 })
  if (mode === 'legacy') return new Response('', { status: 404 })
  return new Response(JSON.stringify({ auth: config.authServiceUrl, spacetimedb: config.spacetimedbUri, livekit: config.livekitUrl,
    clientProtocol: mode === 'legacy-metadata' ? undefined : mode === 'compatible' ? 1 : 2,
    serverVersion: mode === 'legacy-metadata' ? '1.5.0' : '2.0.0',
    minClient: mode === 'legacy-metadata' ? '1.5.0' : '1.6.1', recommendedClient: '2.0.0', web: 'https://web.fixture.test' }))
}
// This fixture tests admission/UI, not transport. Absolutely no real socket opens.
window.WebSocket = class { constructor() { throw new Error('Fixture transport disabled after admission') } } as unknown as typeof WebSocket
tauriCommands.openUrl = async (url) => { document.title = `Opened ${url}` }

if (entry === 'saved') useServerConfigStore.setState({ knownHosts: [config] })
if (entry === 'startup') useServerConfigStore.getState().setConfig(config)

// Entry points must reload fully: fast refresh would create a second React root.
// eslint-disable-next-line react-refresh/only-export-components
function CompatibilityFixture() {
  const admitted = useCompatibilityStore(s => s.admittedKey)
  return <>
    <div className="fixed bottom-0 z-10 flex flex-wrap gap-3 bg-background p-2 text-xs">
      <span data-testid="admission">{admitted ? 'Admission passed; transport disabled' : 'Not admitted'}</span>
      <a href="?state=incompatible">Incompatible fixture</a>
      <a href="?state=compatible">Compatible fixture</a>
      <a href="?state=legacy-metadata">Legacy metadata fixture</a>
      <a href="?state=unreachable">Unreachable fixture</a>
    </div>
    <App />
    <CompatibilityNotice />
    <HostConfirmDialog />
  </>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><QueryClientProvider client={new QueryClient()}><TooltipProvider><MemoryRouter initialEntries={[entry === 'join' ? '/join' : '/']}>
    <CompatibilityFixture />
  </MemoryRouter></TooltipProvider></QueryClientProvider></StrictMode>,
)
if (!params.has('hosted')) {
  if (entry === 'selection') void selectServer(config).catch(() => {})
  if (entry === 'startup') void initializeSpacetime().catch(() => {})
}
