import { useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { ArrowLeftIcon, Maximize2Icon, Minimize2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useIsMobile } from '../../../hooks/use-mobile'
import type { ActiveCall } from '../hooks/useActiveCall'
import { VoiceMediaStage } from './VoiceMediaStage'
import { VoiceControlBar } from './VoiceControlBar'
import { CallOptions } from './CallOptions'

export function CallPanel({ call, onBack }: { call: ActiveCall; onBack?: () => void }) {
  const compact = useIsMobile()
  const layout = useOutletContext<{ activeCallDockVisible?: boolean } | null>()
  const docked = !compact && Boolean(layout?.activeCallDockVisible)
  const fullscreenButton = useRef<HTMLButtonElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const panel = (expanded: boolean) => (
    <section className="flex h-full min-h-0 min-w-0 flex-col gap-2 overflow-hidden p-2 sm:p-3">
      <header className="flex shrink-0 items-center justify-between gap-2">
        {docked && !expanded && onBack ? <Button variant="ghost" size="icon" aria-label="Back to conversations" onClick={onBack}><ArrowLeftIcon /></Button> : null}
        <div className="min-w-0 flex-1">
          {expanded ? <DialogTitle className="truncate text-base font-semibold">{call.title}</DialogTitle> : <h2 className="truncate text-base font-semibold">{call.title}</h2>}
          <p className="text-xs text-muted-foreground" role="status">{call.status}{call.duration && call.joined ? ` · ${call.duration}` : ''}</p>
        </div>
        {!compact ? <Button ref={expanded ? undefined : fullscreenButton} variant="outline" size="sm" onClick={() => setFullscreen(!expanded)}>{expanded ? <Minimize2Icon /> : <Maximize2Icon />}{expanded ? 'Exit fullscreen' : 'Fullscreen'}</Button> : null}
      </header>
      <VoiceMediaStage tiles={call.tiles} emptyStateText={call.connecting ? 'Connecting…' : 'Waiting for participants'} />
      {!docked || expanded ? <div className={expanded ? 'call-toolbar flex max-w-full shrink-0 flex-wrap items-center justify-center gap-2 self-center rounded-2xl border bg-background p-3' : 'shrink-0 space-y-3'}>
        <VoiceControlBar call={call} onMore={compact ? () => setOptionsOpen(true) : undefined} onBack={expanded ? undefined : onBack} />
        {!compact ? <CallOptions call={call} inline collapseDevices={expanded} open={false} onOpenChange={setOptionsOpen} /> : null}
      </div> : call.error ? <p role="alert" className="shrink-0 text-sm break-words text-destructive">{call.error}</p> : null}
      {compact ? <CallOptions call={call} open={optionsOpen} onOpenChange={setOptionsOpen} /> : null}
    </section>
  )
  // The complete panel moves to a portal, so its controls share the media viewport.
  return <Dialog open={fullscreen && !compact} onOpenChange={setFullscreen}>
    {fullscreen && !compact ? <DialogContent className="call-fullscreen app-safe-area" showCloseButton={false} finalFocus={() => {
      // The inline button mounts after the fullscreen panel unmounts.
      requestAnimationFrame(() => fullscreenButton.current?.focus())
      return false
    }}>{panel(true)}</DialogContent> : panel(false)}
  </Dialog>
}
