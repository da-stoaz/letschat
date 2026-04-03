import type { ServerConfig } from '../../stores/serverConfigStore'

export function ConfigPreview({ config }: { config: ServerConfig }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2 text-xs">
      <p className="font-medium text-foreground">Discovered configuration</p>
      <div className="space-y-1 font-mono text-muted-foreground">
        <p><span className="text-primary">SpacetimeDB</span> {config.spacetimedbUri}</p>
        <p><span className="text-primary">Auth       </span> {config.authServiceUrl}</p>
        <p><span className="text-primary">LiveKit    </span> {config.livekitUrl}</p>
        <p><span className="text-primary">Database   </span> {config.spacetimedbDatabase}</p>
      </div>
    </div>
  )
}
