import { useState } from 'react'
import type { ServerConfig } from '../../stores/serverConfigStore'
import { discoverConfig } from '../../lib/discovery'
import { ConfigPreview } from './ConfigPreview'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { GlobeIcon, LoaderCircleIcon } from 'lucide-react'

interface Props {
  onConnect: (config: ServerConfig) => Promise<void>
}

export function DiscoverTab({ onConnect }: Props) {
  const [url, setUrl] = useState('')
  const [discovered, setDiscovered] = useState<ServerConfig | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDiscover = async () => {
    setError(null)
    setDiscovered(null)
    setDiscovering(true)
    try {
      const cfg = await discoverConfig(url.trim())
      setDiscovered(cfg)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Discovery failed.')
    } finally {
      setDiscovering(false)
    }
  }

  const handleConnect = async () => {
    if (!discovered) return
    setConnecting(true)
    setError(null)
    try {
      await onConnect(discovered)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed.')
      setConnecting(false)
    }
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Auto-discover from server URL</h3>
          <p className="text-xs text-muted-foreground">
            Enter your server's base URL. LetsChat will fetch the connection details automatically.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Server URL</Label>
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => { setUrl(e.target.value); setDiscovered(null); setError(null) }}
              placeholder="https://chat.myfriends.com"
              className="h-8 text-sm font-mono"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="none"
              onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) void handleDiscover() }}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="shrink-0"
              disabled={!url.trim() || discovering}
              onClick={handleDiscover}
            >
              {discovering
                ? <LoaderCircleIcon className="size-3.5 animate-spin" />
                : <GlobeIcon className="size-3.5" />}
              {discovering ? 'Discovering…' : 'Discover'}
            </Button>
          </div>
        </div>
      </div>

      {discovered && <ConfigPreview config={discovered} />}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end">
        <Button type="button" disabled={!discovered || connecting} onClick={handleConnect}>
          {connecting && <LoaderCircleIcon className="size-3.5 animate-spin" />}
          {connecting ? 'Connecting…' : 'Connect'}
        </Button>
      </div>
    </div>
  )
}
