import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { buildJoinLink, hostLabel, useServerConfigStore } from '../../stores/serverConfigStore'
import { useConnectionStore, type ConnectionStatus } from '../../stores/connectionStore'
import { isHostedWebBuild } from '../../lib/tauri'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CopyIcon, CheckIcon, ChevronRightIcon, QrCodeIcon, ServerIcon, PlugZapIcon } from 'lucide-react'

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Connection problem',
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        })
      }}
      className="shrink-0"
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      {copied ? 'Copied!' : label}
    </Button>
  )
}

/** One label/value row inside the technical-details disclosure. */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-primary">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  )
}

export function ConnectionTab() {
  const config = useServerConfigStore((s) => s.config)
  const clearConfig = useServerConfigStore((s) => s.clearConfig)
  const status = useConnectionStore((s) => s.status)
  const identity = useConnectionStore((s) => s.identity)
  const navigate = useNavigate()
  const [showQr, setShowQr] = useState(false)

  if (!config) return null

  const joinLink = buildJoinLink(config)

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <ServerIcon className="size-4 shrink-0 text-muted-foreground" />
            <p className="truncate text-sm font-medium">{hostLabel(config)}</p>
          </div>
          <Badge variant={status === 'connected' ? 'secondary' : 'outline'} className="shrink-0">
            {STATUS_LABELS[status]}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">The LetsChat server this app is signed in to.</p>
      </div>

      <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">Invite a friend</p>
          <p className="text-xs text-muted-foreground">
            Send them this link, or let them scan the code, to connect to the same server.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <CopyButton text={joinLink} label="Copy invite link" />
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowQr((v) => !v)}>
            <QrCodeIcon className="size-3.5" />
            {showQr ? 'Hide QR code' : 'Show QR code'}
          </Button>
        </div>

        {showQr ? (
          <div className="flex justify-center pt-1">
            <div className="rounded-lg bg-white p-3">
              <QRCodeSVG value={joinLink} size={160} />
            </div>
          </div>
        ) : null}
      </div>

      {/* Hosted web is locked to its own instance — changing server would clear
          the config and strand the locked-instance bootstrap, so it is hidden. */}
      {!isHostedWebBuild() && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 p-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">Connect to a different server</p>
            <p className="text-xs text-muted-foreground">Signs you out of this one. Your account here is untouched.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              clearConfig()
              navigate('/setup')
            }}
          >
            <PlugZapIcon className="size-3.5" />
            Change server
          </Button>
        </div>
      )}

      {/* Native disclosure — nobody needs these until something is broken, and
          then they are the first thing an operator asks for. */}
      <details className="group rounded-lg border border-border/70 bg-muted/20 [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 p-3 text-xs text-muted-foreground hover:text-foreground">
          <ChevronRightIcon className="size-3.5 transition-transform group-open:rotate-90" />
          Technical details
        </summary>
        <div className="space-y-1.5 px-3 pb-3 font-mono text-xs text-muted-foreground">
          <DetailRow label="SpacetimeDB" value={config.spacetimedbUri} />
          <DetailRow label="Auth" value={config.authServiceUrl} />
          <DetailRow label="LiveKit" value={config.livekitUrl} />
          <DetailRow label="Database" value={config.spacetimedbDatabase} />
          {identity ? (
            <div className="space-y-0.5 pt-1">
              <span className="text-primary">Identity</span>
              <p className="break-all">{identity}</p>
            </div>
          ) : null}
        </div>
      </details>
    </div>
  )
}
