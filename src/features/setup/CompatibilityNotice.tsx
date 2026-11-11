import { useNavigate } from 'react-router-dom'
import { acknowledgeCompatibility, isServerAdmitted, useCompatibilityStore } from '../../lib/compatibility'
import { CLIENT_VERSION, SUPPORTED_CLIENT_PROTOCOLS } from '../../lib/clientCompatibility'
import { cancelServerSelection, selectServer } from '../../lib/selectServer'
import { safeWebUrl } from '../../lib/discovery'
import { hostLabel, useServerConfigStore } from '../../stores/serverConfigStore'
import { isHostedWebBuild, tauriCommands } from '../../lib/tauri'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function CompatibilityNotice() {
  const notice = useCompatibilityStore(s => s.notice)
  const pendingHost = useServerConfigStore(s => s.pendingHost)
  const navigate = useNavigate()
  if (!notice || pendingHost || notice.status === 'trust') return null
  const hosted = isHostedWebBuild()
  const checking = notice.status === 'checking'
  const title = checking ? 'Checking server compatibility'
    : notice.status === 'incompatible' ? 'This app cannot connect to this server'
    : notice.status === 'unknown' ? 'Compatibility could not be verified' : 'Couldn’t reach this server'
  const web = safeWebUrl(notice.document.web)
  const downloads = safeWebUrl(notice.config.discoveryUrl ?? notice.config.authServiceUrl)
  const retry = () => { void selectServer(notice.config).then(() => navigate('/')).catch(() => {}) }
  const cancel = () => {
    cancelServerSelection()
    const state = useServerConfigStore.getState()
    if (!isServerAdmitted(state.config)) {
      state.clearConfig()
      navigate('/setup')
    }
  }
  return (
    <Dialog open onOpenChange={open => { if (!open && !hosted) cancel() }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" showCloseButton={!hosted}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{hostLabel(notice.config)}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground" role="status">{notice.message}</p>
        {!checking && <>
          {hosted && notice.status === 'incompatible' && <p className="text-sm text-muted-foreground">Reload to get the deployed web client. If this continues, ask the operator to deploy compatible web and backend releases.</p>}
          <details className="rounded-lg border p-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Technical details</summary>
            <div className="mt-2 space-y-1">
              <div>App: {CLIENT_VERSION} · supported protocols: {SUPPORTED_CLIENT_PROTOCOLS.join(', ')}</div>
              <div>Server: {typeof notice.document.serverVersion === 'string' ? notice.document.serverVersion : 'Unknown'}</div>
              <div>Server protocol: {typeof notice.document.clientProtocol === 'number' ? notice.document.clientProtocol : 'Unknown'}</div>
              <div>Minimum client: {typeof notice.document.minClient === 'string' ? notice.document.minClient : 'Unknown'}</div>
              <div>Recommended client: {typeof notice.document.recommendedClient === 'string' ? notice.document.recommendedClient : 'Unknown'}</div>
            </div>
          </details>
          {!hosted && notice.status === 'incompatible' && downloads && <div className="space-y-2">
            <Button variant="outline" onClick={() => void tauriCommands.openUrl(downloads)}>Open this server’s download page</Button>
            <p className="text-xs text-muted-foreground">This download is recommended for this server. Installing another desktop version can affect connections to your other saved servers.</p>
          </div>}
          {!hosted && web && <Button variant="outline" onClick={() => void tauriCommands.openUrl(web)}>Open this server’s web client</Button>}
        </>}
        <div className="flex flex-wrap justify-end gap-2">
          {!hosted && <Button variant="outline" onClick={cancel}>{notice.status === 'incompatible' ? 'Choose another server' : 'Cancel'}</Button>}
          {!checking && <Button variant="outline" onClick={retry}>Retry</Button>}
          {!checking && hosted && <Button variant="outline" onClick={() => window.location.reload()}>Reload</Button>}
          {notice.status === 'unknown' && <Button onClick={() => { acknowledgeCompatibility(); retry() }}>Connect anyway</Button>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
