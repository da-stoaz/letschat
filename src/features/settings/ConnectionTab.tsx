import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { buildJoinLink, useServerConfigStore } from '../../stores/serverConfigStore'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CopyIcon, CheckIcon, LinkIcon, QrCodeIcon, ServerIcon, PlugZapIcon } from 'lucide-react'

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

export function ConnectionTab() {
  const config = useServerConfigStore((s) => s.config)
  const clearConfig = useServerConfigStore((s) => s.clearConfig)
  const navigate = useNavigate()
  const [showQr, setShowQr] = useState(false)

  if (!config) return null

  const joinLink = buildJoinLink(config)

  const handleChangeServer = () => {
    clearConfig()
    navigate('/setup')
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <ServerIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <p className="text-sm font-medium">Current server</p>
        </div>
        <div className="space-y-1.5 text-xs font-mono text-muted-foreground">
          <div className="flex items-center justify-between gap-2">
            <span className="text-primary shrink-0">SpacetimeDB</span>
            <span className="truncate text-right">{config.spacetimedbUri}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-primary shrink-0">Auth</span>
            <span className="truncate text-right">{config.authServiceUrl}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-primary shrink-0">LiveKit</span>
            <span className="truncate text-right">{config.livekitUrl}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-primary shrink-0">Database</span>
            <span className="truncate text-right">{config.spacetimedbDatabase}</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border/70 p-3 space-y-2">
        <div className="space-y-1">
          <p className="text-sm font-medium">Share join link</p>
          <p className="text-xs text-muted-foreground">
            Share this link or QR code with friends so they can connect to your server instantly.
          </p>
        </div>

        <div className="flex items-center gap-2 min-w-0">
          <LinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <code className="text-xs text-primary font-mono truncate flex-1">{joinLink}</code>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setShowQr((v) => !v)}
              title="Toggle QR code"
            >
              <QrCodeIcon className="size-3.5" />
            </Button>
            <CopyButton text={joinLink} label="Link" />
          </div>
        </div>

        {showQr && (
          <div className="flex flex-col items-center gap-2 pt-1 pb-1">
            <div className="rounded-lg bg-white p-3">
              <QRCodeSVG value={joinLink} size={160} />
            </div>
            <p className="text-[10px] text-muted-foreground break-all max-w-xs text-center">{joinLink}</p>
          </div>
        )}

        <div className="pt-1">
          <Badge variant="secondary" className="text-[10px]">
            letschat:// deep link — paste in Setup → Join Link
          </Badge>
        </div>
      </div>

      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
        <p className="text-sm font-medium">Change server</p>
        <p className="text-xs text-muted-foreground">
          Clears the current server connection and returns to setup. You will be signed out.
        </p>
        <Button type="button" variant="destructive" size="sm" onClick={handleChangeServer}>
          <PlugZapIcon className="size-3.5" />
          Change server
        </Button>
      </div>
    </div>
  )
}
