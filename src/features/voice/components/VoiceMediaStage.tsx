import { useRef, useState } from 'react'
import { Maximize2Icon, Minimize2Icon } from 'lucide-react'
import { type LocalParticipant, type RemoteParticipant } from 'livekit-client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useIsMobile } from '../../../hooks/use-mobile'
import { selectCallTiles } from '../mediaLayout'
import { ParticipantMediaTile } from './ParticipantMediaTile'

export type VoiceMediaTile = {
  key: string
  displayName: string
  avatarUrl: string | null
  joinedAt?: string
  participant: LocalParticipant | RemoteParticipant | null
  tileType: 'profile' | 'screen'
  isLocal: boolean
  isSpeaking: boolean
  isScreenAudioActive: boolean
  muted: boolean
  deafened: boolean
  sharingScreen: boolean
  sharingCamera: boolean
  hasVisual: boolean
  priority: number
}

export function VoiceMediaStage({ tiles, className, emptyStateText = 'No participants yet' }: {
  tiles: VoiceMediaTile[]
  className?: string
  emptyStateText?: string
}) {
  const compact = useIsMobile()
  const primaryButton = useRef<HTMLButtonElement>(null)
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const { spotlight, secondary, focused } = selectCallTiles(tiles, compact, focusedKey)
  const focusTile = (key: string | null) => {
    setFocusedKey(key)
    requestAnimationFrame(() => primaryButton.current?.focus())
  }
  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col gap-2', className)}>
      {spotlight.length === 0 ? <div className="grid min-h-0 flex-1 place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">{emptyStateText}</div> : (
        <div className={cn('call-spotlight grid min-h-0 flex-1 gap-2', spotlight.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {spotlight.map((tile, index) => (
            <div key={tile.key} className="relative min-h-0 min-w-0">
              <ParticipantMediaTile {...tile} className="h-full" stageClassName="aspect-auto min-h-0 flex-1" avatarClassName="size-24 max-h-[70%] max-w-[70%] sm:size-36" />
              {tiles.length > 1 ? <Button ref={index === 0 ? primaryButton : undefined} size="icon" variant="secondary" className="absolute right-2 top-2" aria-label={focused ? 'Show all participants' : `Focus ${tile.displayName}${tile.tileType === 'screen' ? ' screen' : ''}`} aria-pressed={focused} onClick={() => focusTile(focused ? null : tile.key)}>{focused ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}</Button> : null}
            </div>
          ))}
        </div>
      )}
      {secondary.length > 0 && !focused ? <div className="min-h-0 shrink-0 overflow-x-auto overscroll-x-contain p-0.5">
        <div className="flex w-max gap-2">
          {secondary.map((tile) => <button key={tile.key} type="button" className="w-28 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-ring md:w-40" aria-label={`Focus ${tile.displayName}${tile.tileType === 'screen' ? ' screen' : ''}`} onClick={() => focusTile(tile.key)}>
            <ParticipantMediaTile {...tile} stageClassName="h-[min(14dvh,5rem)] md:h-20 aspect-auto" avatarClassName="size-10 max-h-[80%]" />
          </button>)}
        </div>
      </div> : null}
    </div>
  )
}
