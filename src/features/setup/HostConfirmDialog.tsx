import { isServerAdmitted, useCompatibilityStore } from '../../lib/compatibility'
import { isHostedWebBuild } from '../../lib/tauri'
import { useNavigate } from 'react-router-dom'
import { ShieldAlertIcon } from 'lucide-react'
import { hostLabel, useServerConfigStore } from '../../stores/serverConfigStore'
import { selectServer, cancelServerSelection } from '../../lib/selectServer'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const FIELD_LABELS: Record<string, string> = {
  authServiceUrl: 'Auth',
  spacetimedbUri: 'SpacetimeDB',
  livekitUrl: 'LiveKit',
  spacetimedbDatabase: 'Database',
}

/**
 * Confirmation gate in front of a connection the client will not make silently:
 * a known host now advertising different service URLs than it did before, or an
 * unfamiliar host arriving via a link the user did not type.
 *
 * Rendered once, at the app root, so every connect path shares it rather than
 * each growing its own prompt.
 */
export function HostConfirmDialog() {
  const pendingHost = useServerConfigStore((s) => s.pendingHost)
  const resolvePendingHost = useServerConfigStore((s) => s.resolvePendingHost)
  const navigate = useNavigate()

  if (!pendingHost) return null

  const cancel = () => {
    cancelServerSelection()
    const state = useServerConfigStore.getState()
    if (!isServerAdmitted(state.config)) {
      if (isHostedWebBuild() && state.config) {
        useCompatibilityStore.setState({ notice: { config: state.config, status: 'unreachable', message: 'Connection cancelled. Retry when you are ready to confirm the server details.', document: {}, fingerprint: '' } })
      } else {
        state.clearConfig()
        navigate('/setup')
      }
    }
  }

  const host = hostLabel(pendingHost.config)
  const isChanged = pendingHost.reason === 'changed'

  return (
    <Dialog open onOpenChange={(open) => !open && cancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isChanged ? <ShieldAlertIcon className="size-4 text-destructive" /> : null}
            {isChanged ? 'This server changed its connection details' : 'Connect to a new server?'}
          </DialogTitle>
          <DialogDescription>
            {isChanged ? (
              <>
                <span className="font-medium text-foreground">{host}</span> is pointing somewhere different
                than the last time you connected. That is expected if the operator moved the server — and is
                what a hijacked domain looks like too. Only continue if you were expecting a change.
              </>
            ) : (
              <>
                You have not connected to <span className="font-medium text-foreground">{host}</span> before,
                and this link came from outside the app. Continue only if you trust whoever sent it.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {isChanged ? (
          <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3 font-mono text-xs">
            {pendingHost.changes.map((change) => (
              <div key={change.field} className="space-y-0.5">
                <p className="text-primary">{FIELD_LABELS[change.field] ?? change.field}</p>
                <p className="break-all text-muted-foreground line-through">{change.stored}</p>
                <p className="break-all text-foreground">{change.incoming}</p>
              </div>
            ))}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={cancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={isChanged ? 'destructive' : 'default'}
            onClick={() => {
              const config = resolvePendingHost(true)
              if (!config) return
              void selectServer(config, { trusted: true }).then(() => navigate('/')).catch(() => {})
            }}
          >
            {isChanged ? 'Connect anyway' : 'Connect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
