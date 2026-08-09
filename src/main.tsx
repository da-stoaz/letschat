import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import { initializeSpacetime } from './lib/spacetimedb'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { useServerConfigStore } from './stores/serverConfigStore'

const queryClient = new QueryClient()

function initializePersistedSpacetime(): void {
  if (useServerConfigStore.getState().config !== null) {
    // Failure is surfaced via the connection store's 'error' status (App shows a
    // retry screen); swallow the rejection here so it isn't an unhandled reject.
    void initializeSpacetime().catch(() => {})
  }
}

if (useServerConfigStore.persist.hasHydrated()) {
  initializePersistedSpacetime()
} else {
  useServerConfigStore.persist.onFinishHydration(initializePersistedSpacetime)
}
document.documentElement.classList.add('dark')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
          <Toaster richColors closeButton position="top-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>,
)
