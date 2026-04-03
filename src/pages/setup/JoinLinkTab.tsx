import { useState } from 'react'
import { parseJoinLink, type ServerConfig } from '../../stores/serverConfigStore'
import { ConfigPreview } from './ConfigPreview'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LoaderCircleIcon } from 'lucide-react'

interface Props {
  onConnect: (config: ServerConfig) => Promise<void>
}

export function JoinLinkTab({ onConnect }: Props) {
  const [raw, setRaw] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsed = raw.trim() ? parseJoinLink(raw.trim()) : null
  const isValid = parsed !== null

  const handleConnect = async () => {
    if (!parsed) return
    setConnecting(true)
    setError(null)
    try {
      await onConnect(parsed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed.')
      setConnecting(false)
    }
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Paste a join link</h3>
          <p className="text-xs text-muted-foreground">
            Ask your server admin for a join link or scan their QR code in{' '}
            <span className="text-foreground">Settings → Connection</span>.
            Paste the <code className="text-primary">letschat://join?…</code> link below.
          </p>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Join link</Label>
            {raw.trim() && (
              <Badge variant={isValid ? 'secondary' : 'destructive'} className="text-[10px] py-0">
                {isValid ? 'Valid' : 'Invalid'}
              </Badge>
            )}
          </div>
          <Input
            value={raw}
            onChange={(e) => { setRaw(e.target.value); setError(null) }}
            placeholder="letschat://join?s=…&a=…&l=…&d=…"
            className="h-8 text-sm font-mono"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="none"
          />
        </div>
      </div>

      {parsed && <ConfigPreview config={parsed} />}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end">
        <Button type="button" disabled={!isValid || connecting} onClick={handleConnect}>
          {connecting && <LoaderCircleIcon className="size-3.5 animate-spin" />}
          {connecting ? 'Connecting…' : 'Connect'}
        </Button>
      </div>
    </div>
  )
}
