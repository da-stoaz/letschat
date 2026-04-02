import { useEffect, useMemo, useRef, useState } from 'react'
import { DownloadIcon, ExternalLinkIcon, FileIcon, ImageIcon, MusicIcon, VideoIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getSignedDownloadUrl } from '../../lib/uploads'
import type { ChatMessageAttachment } from '../../types/attachments'

type AttachmentResolution = {
  loading: boolean
  url: string | null
  error: string | null
}

const PENDING_RESOLUTION: AttachmentResolution = {
  loading: true,
  url: null,
  error: null,
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

function attachmentKind(mimeType: string): 'image' | 'video' | 'audio' | 'file' {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'file'
}

export function MessageAttachmentList({ attachments }: { attachments: ChatMessageAttachment[] }) {
  const [resolvedByStorageKey, setResolvedByStorageKey] = useState<Record<string, AttachmentResolution>>({})
  const requestedKeysRef = useRef<Set<string>>(new Set())

  const uniqueAttachments = useMemo(() => {
    const seen = new Set<string>()
    const deduped: ChatMessageAttachment[] = []
    for (const attachment of attachments) {
      if (seen.has(attachment.storageKey)) continue
      seen.add(attachment.storageKey)
      deduped.push(attachment)
    }
    return deduped
  }, [attachments])

  useEffect(() => {
    if (uniqueAttachments.length === 0) return

    let cancelled = false
    const activeKeys = new Set(uniqueAttachments.map((attachment) => attachment.storageKey))
    for (const key of Array.from(requestedKeysRef.current)) {
      if (!activeKeys.has(key)) {
        requestedKeysRef.current.delete(key)
      }
    }

    void Promise.all(
      uniqueAttachments.map(async (attachment) => {
        if (requestedKeysRef.current.has(attachment.storageKey)) return
        requestedKeysRef.current.add(attachment.storageKey)
        try {
          const url = await getSignedDownloadUrl(attachment.storageKey)
          if (cancelled) return
          setResolvedByStorageKey((previous) => ({
            ...previous,
            [attachment.storageKey]: {
              loading: false,
              url,
              error: null,
            },
          }))
        } catch (error) {
          if (cancelled) return
          const message = error instanceof Error ? error.message : 'Could not load attachment URL.'
          setResolvedByStorageKey((previous) => ({
            ...previous,
            [attachment.storageKey]: {
              loading: false,
              url: null,
              error: message,
            },
          }))
          requestedKeysRef.current.delete(attachment.storageKey)
        }
      }),
    )

    return () => {
      cancelled = true
    }
  }, [uniqueAttachments])

  if (uniqueAttachments.length === 0) return null

  return (
    <div className="space-y-2">
      {uniqueAttachments.map((attachment) => {
        const resolution = resolvedByStorageKey[attachment.storageKey] ?? PENDING_RESOLUTION
        const kind = attachmentKind(attachment.mimeType)
        const canOpen = Boolean(resolution.url)

        return (
          <div key={attachment.storageKey} className="rounded-lg border border-border/70 bg-muted/20 p-2">
            {(kind === 'image' || kind === 'video' || kind === 'audio') && canOpen ? (
              <div className="mb-2 overflow-hidden rounded-md border border-border/60 bg-background/50">
                {kind === 'image' ? (
                  <img src={resolution.url ?? ''} alt={attachment.fileName} className="max-h-72 w-full object-contain" />
                ) : kind === 'video' ? (
                  <video src={resolution.url ?? ''} controls className="max-h-80 w-full bg-black" />
                ) : (
                  <audio src={resolution.url ?? ''} controls className="w-full p-2" />
                )}
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {kind === 'image' ? (
                    <ImageIcon className="size-4 text-muted-foreground" />
                  ) : kind === 'video' ? (
                    <VideoIcon className="size-4 text-muted-foreground" />
                  ) : kind === 'audio' ? (
                    <MusicIcon className="size-4 text-muted-foreground" />
                  ) : (
                    <FileIcon className="size-4 text-muted-foreground" />
                  )}
                  <p className="truncate text-sm font-medium">{attachment.fileName}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(attachment.fileSize)} • {attachment.mimeType}
                </p>
                {resolution.error ? <p className="text-xs text-destructive">{resolution.error}</p> : null}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canOpen}
                  onClick={() => {
                    if (!resolution.url) return
                    window.open(resolution.url, '_blank', 'noopener,noreferrer')
                  }}
                >
                  <ExternalLinkIcon className="size-4" />
                  Open
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canOpen}
                  onClick={() => {
                    if (!resolution.url) return
                    const anchor = document.createElement('a')
                    anchor.href = resolution.url
                    anchor.download = attachment.fileName
                    anchor.rel = 'noopener noreferrer'
                    document.body.appendChild(anchor)
                    anchor.click()
                    anchor.remove()
                  }}
                >
                  <DownloadIcon className="size-4" />
                  Save
                </Button>
              </div>
            </div>

            {resolution.loading ? <p className="mt-1 text-xs text-muted-foreground">Loading secure file URL…</p> : null}
          </div>
        )
      })}
    </div>
  )
}
