import { useCallback, useEffect, useMemo, useState } from 'react'
import { Maximize2Icon, Minimize2Icon } from 'lucide-react'
import { type LocalParticipant, type RemoteParticipant } from 'livekit-client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
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

type VoiceMediaStageProps = {
  tiles: VoiceMediaTile[]
  className?: string
  showFullscreenToggle?: boolean
  emptyStateText?: string
  emptyStateClassName?: string
}

export function VoiceMediaStage({
  tiles,
  className,
  showFullscreenToggle = true,
  emptyStateText = 'No participants are sharing media yet.',
  emptyStateClassName,
}: VoiceMediaStageProps) {
  const [manualSpotlightKeys, setManualSpotlightKeys] = useState<string[]>([])
  const [isFullscreen, setIsFullscreen] = useState(false)

  const sortedMediaTiles = useMemo(
    () => [...tiles].sort((left, right) => right.priority - left.priority),
    [tiles],
  )

  const tileByKey = useMemo(() => {
    const map = new Map<string, VoiceMediaTile>()
    for (const tile of sortedMediaTiles) {
      map.set(tile.key, tile)
    }
    return map
  }, [sortedMediaTiles])

  useEffect(() => {
    setManualSpotlightKeys((previous) => {
      const next = previous.filter((key) => tileByKey.has(key)).slice(0, 2)
      if (next.length === previous.length && next.every((value, index) => value === previous[index])) {
        return previous
      }
      return next
    })
  }, [tileByKey])

  const autoSpotlightKeys = useMemo(() => {
    if (sortedMediaTiles.length === 0) return []
    const visualTiles = sortedMediaTiles.filter((tile) => tile.hasVisual).slice(0, 2)
    if (visualTiles.length > 0) {
      return visualTiles.map((tile) => tile.key)
    }
    return [sortedMediaTiles[0].key]
  }, [sortedMediaTiles])

  const effectiveSpotlightKeys = useMemo(() => {
    const pinned = manualSpotlightKeys.filter((key) => tileByKey.has(key)).slice(0, 2)
    if (pinned.length > 0) return pinned
    return autoSpotlightKeys
  }, [autoSpotlightKeys, manualSpotlightKeys, tileByKey])

  const spotlightSet = useMemo(() => new Set(effectiveSpotlightKeys), [effectiveSpotlightKeys])

  const spotlightTiles = useMemo(
    () =>
      effectiveSpotlightKeys
        .map((key) => tileByKey.get(key))
        .filter((tile): tile is VoiceMediaTile => tile !== undefined),
    [effectiveSpotlightKeys, tileByKey],
  )

  const secondaryMediaTiles = useMemo(
    () => sortedMediaTiles.filter((tile) => !spotlightSet.has(tile.key)),
    [sortedMediaTiles, spotlightSet],
  )

  const toggleSpotlightTile = useCallback((key: string) => {
    setManualSpotlightKeys((previous) => {
      if (previous.includes(key)) {
        return previous.filter((entry) => entry !== key)
      }
      const next = [...previous, key]
      return next.slice(-2)
    })
  }, [])

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((previous) => !previous)
  }, [])

  useEffect(() => {
    if (!isFullscreen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFullscreen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isFullscreen])

  useEffect(() => {
    if (!isFullscreen || typeof document === 'undefined') return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isFullscreen])

  return (
    <>
      {isFullscreen ? (
        <button
          type="button"
          className="fixed inset-0 z-[119] bg-black/72 backdrop-blur-[2px]"
          onClick={toggleFullscreen}
          aria-label="Exit fullscreen"
        />
      ) : null}
      <div
        className={cn(
          'relative flex h-full min-h-0 flex-col gap-2',
          isFullscreen
            ? 'fixed inset-2 z-[120] h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] rounded-xl border border-border/70 bg-background/98 p-3 shadow-2xl'
            : null,
          className,
        )}
      >
        {showFullscreenToggle ? (
          <div className="pointer-events-none absolute right-2 top-2 z-20 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              className="pointer-events-auto h-8 bg-background/85 backdrop-blur-sm"
              onClick={toggleFullscreen}
            >
              {isFullscreen ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
              {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </Button>
          </div>
        ) : null}

        {sortedMediaTiles.length === 0 ? (
          <div
            className={cn(
              'grid h-full min-h-[260px] place-items-center rounded-xl border border-dashed border-border/70 bg-muted/10',
              emptyStateClassName,
            )}
          >
            <p className="text-sm text-muted-foreground">{emptyStateText}</p>
          </div>
        ) : (
          <>
            <div
              className={cn(
                'grid min-h-0 flex-1 gap-2',
                spotlightTiles.length > 1 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1',
              )}
            >
              {spotlightTiles.map((tile) => {
                const manuallyPinned = manualSpotlightKeys.includes(tile.key)
                return (
                  <button
                    key={tile.key}
                    type="button"
                    onClick={() => toggleSpotlightTile(tile.key)}
                    className={cn(
                      'h-full min-h-0 rounded-xl text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
                      manuallyPinned ? 'ring-2 ring-primary/60' : 'ring-1 ring-border/40 hover:ring-border/70',
                    )}
                    title={manuallyPinned ? 'Remove from big view' : 'Pin to big view'}
                  >
                    <ParticipantMediaTile
                      displayName={tile.displayName}
                      avatarUrl={tile.avatarUrl}
                      joinedAt={tile.joinedAt}
                      participant={tile.participant}
                      tileType={tile.tileType}
                      isLocal={tile.isLocal}
                      isSpeaking={tile.isSpeaking}
                      isScreenAudioActive={tile.isScreenAudioActive}
                      muted={tile.muted}
                      deafened={tile.deafened}
                      sharingScreen={tile.sharingScreen}
                      sharingCamera={tile.sharingCamera}
                      className="h-full min-h-0"
                      stageClassName={cn(
                        'aspect-auto h-full',
                        spotlightTiles.length > 1 ? 'min-h-[220px]' : 'min-h-[320px]',
                      )}
                      avatarClassName={spotlightTiles.length > 1 ? 'size-28 sm:size-36' : 'size-36 sm:size-44 md:size-48'}
                    />
                  </button>
                )
              })}
            </div>

            {secondaryMediaTiles.length > 0 ? (
              <div className="shrink-0 overflow-x-auto pb-1">
                <div className="flex min-w-max items-stretch gap-2 pr-1">
                  {secondaryMediaTiles.map((tile) => {
                    const manuallyPinned = manualSpotlightKeys.includes(tile.key)
                    return (
                      <button
                        key={tile.key}
                        type="button"
                        onClick={() => toggleSpotlightTile(tile.key)}
                        className={cn(
                          'w-[220px] shrink-0 rounded-lg text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 sm:w-[250px]',
                          manuallyPinned ? 'ring-2 ring-primary/60' : 'ring-1 ring-border/40 hover:ring-border/70',
                        )}
                        title={manuallyPinned ? 'Remove from big view' : 'Pin to big view'}
                      >
                        <ParticipantMediaTile
                          displayName={tile.displayName}
                          avatarUrl={tile.avatarUrl}
                          joinedAt={tile.joinedAt}
                          participant={tile.participant}
                          tileType={tile.tileType}
                          isLocal={tile.isLocal}
                          isSpeaking={tile.isSpeaking}
                          isScreenAudioActive={tile.isScreenAudioActive}
                          muted={tile.muted}
                          deafened={tile.deafened}
                          sharingScreen={tile.sharingScreen}
                          sharingCamera={tile.sharingCamera}
                          stageClassName="aspect-video"
                          avatarClassName="size-16 sm:size-20"
                        />
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  )
}
