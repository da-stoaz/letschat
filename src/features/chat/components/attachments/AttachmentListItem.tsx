import { useRef, useState } from 'react'
import { DownloadIcon, ExternalLinkIcon, FileIcon, ImageIcon, Loader2Icon, MusicIcon, VideoIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isDesktopTauriRuntime, tauriCommands } from '@/lib/tauri'
import type { ChatMessageAttachment } from '@/types/attachments'
import { formatFileSize, getAttachmentKind } from './attachmentUtils'
import type { AttachmentResolution } from './useAttachmentResolver'

type AttachmentListItemProps = {
  attachment: ChatMessageAttachment
  resolution: AttachmentResolution
  onRetry: (storageKey: string) => void
  onOpenImage: (image: { url: string; fileName: string }) => void
  onOpenPdf: (pdf: { url: string; fileName: string }) => void
}

function openUrl(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function triggerDownload(url: string, fileName: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

function createDownloadOperationId(storageKey: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${storageKey}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function downloadFile(
  url: string,
  fileName: string,
  onProgress?: (fraction: number | null) => void,
  onRequestCreated?: (request: XMLHttpRequest) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    onRequestCreated?.(request)
    request.open('GET', url, true)
    request.responseType = 'blob'

    request.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) {
        onProgress?.(null)
        return
      }
      onProgress?.(Math.min(1, event.loaded / event.total))
    }
    request.onerror = () => reject(new Error('Download failed (network error).'))
    request.onabort = () => reject(new Error('Download was cancelled.'))
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`Download failed (${request.status}).`))
        return
      }

      onProgress?.(1)
      const blob = request.response
      if (!blob) {
        reject(new Error('Download failed (empty response).'))
        return
      }

      const blobUrl = URL.createObjectURL(blob)
      try {
        triggerDownload(blobUrl, fileName)
        resolve()
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0)
      }
    }

    request.send()
  })
}

function isPdfAttachment(attachment: ChatMessageAttachment): boolean {
  return (
    attachment.mimeType.toLowerCase() === 'application/pdf' ||
    attachment.fileName.toLowerCase().endsWith('.pdf')
  )
}

export function AttachmentListItem({ attachment, resolution, onRetry, onOpenImage, onOpenPdf }: AttachmentListItemProps) {
  const webDownloadRequestRef = useRef<XMLHttpRequest | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [downloadProgressFraction, setDownloadProgressFraction] = useState<number | null>(null)
  const [activeDownloadOperationId, setActiveDownloadOperationId] = useState<string | null>(null)
  const kind = getAttachmentKind(attachment.mimeType)
  const canOpen = Boolean(resolution.url)
  const isPdf = isPdfAttachment(attachment)
  const hasDownloadProgress = isSaving && downloadProgressFraction !== null
  const downloadPercent = hasDownloadProgress ? Math.round(downloadProgressFraction * 100) : null

  const renderKindIcon = () => {
    if (kind === 'image') return <ImageIcon className="size-4 text-muted-foreground" />
    if (kind === 'video') return <VideoIcon className="size-4 text-muted-foreground" />
    if (kind === 'audio') return <MusicIcon className="size-4 text-muted-foreground" />
    return <FileIcon className="size-4 text-muted-foreground" />
  }

  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-2">
      {(kind === 'image' || kind === 'video' || kind === 'audio') && canOpen ? (
        <div className="mb-2 overflow-hidden rounded-md border border-border/60 bg-background/50">
          {kind === 'image' ? (
            <button
              type="button"
              className="block w-full cursor-zoom-in focus:outline-none"
              onClick={() => resolution.url && onOpenImage({ url: resolution.url, fileName: attachment.fileName })}
            >
              <img src={resolution.url ?? ''} alt={attachment.fileName} className="max-h-72 w-full object-contain" />
            </button>
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
            {renderKindIcon()}
            <p className="truncate text-sm font-medium">{attachment.fileName}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {formatFileSize(attachment.fileSize)} • {attachment.mimeType}
          </p>
          {resolution.error ? (
            <div className="flex items-center gap-2">
              <p className="text-xs text-destructive">{resolution.error}</p>
              <Button size="xs" variant="outline" onClick={() => onRetry(attachment.storageKey)}>
                Retry
              </Button>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={!canOpen}
            onClick={() => {
              if (!resolution.url) return
              if (kind === 'image') {
                onOpenImage({ url: resolution.url, fileName: attachment.fileName })
                return
              }
              if (isPdf) {
                onOpenPdf({ url: resolution.url, fileName: attachment.fileName })
                return
              }
              openUrl(resolution.url)
            }}
          >
            <ExternalLinkIcon className="size-4" />
            {kind === 'image' || isPdf ? 'Preview' : 'Open'}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            disabled={!canOpen || isSaving}
            onClick={async () => {
              if (!resolution.url) return
              setIsSaving(true)
              setIsCancelling(false)
              setDownloadProgressFraction(0)
              setActiveDownloadOperationId(null)
              webDownloadRequestRef.current = null
              const isDesktopTauri = isDesktopTauriRuntime()
              try {
                if (isDesktopTauri) {
                  const operationId = createDownloadOperationId(attachment.storageKey)
                  setActiveDownloadOperationId(operationId)
                  const unlisten = await tauriCommands.onAttachmentDownloadProgress((event) => {
                    if (event.operationId !== operationId) return
                    if (event.totalBytes && event.totalBytes > 0) {
                      setDownloadProgressFraction(Math.min(1, event.bytesDownloaded / event.totalBytes))
                    } else if (event.completed) {
                      setDownloadProgressFraction(1)
                    } else {
                      setDownloadProgressFraction(null)
                    }
                  })
                  try {
                    await tauriCommands.saveAttachmentFile(resolution.url, attachment.fileName, operationId)
                  } finally {
                    unlisten()
                    setActiveDownloadOperationId(null)
                  }
                  return
                }
                await downloadFile(
                  resolution.url,
                  attachment.fileName,
                  setDownloadProgressFraction,
                  (request) => {
                    webDownloadRequestRef.current = request
                  },
                )
              } catch (error) {
                const isCancelled =
                  error instanceof Error && error.message.toLowerCase().includes('cancelled')
                if (!isDesktopTauri && !isCancelled) {
                  // Fallback: keep old browser flow if blob download is blocked by platform/CORS.
                  triggerDownload(resolution.url, attachment.fileName)
                }
              } finally {
                setIsSaving(false)
                setIsCancelling(false)
                setDownloadProgressFraction(null)
                setActiveDownloadOperationId(null)
                webDownloadRequestRef.current = null
              }
            }}
          >
            {isSaving ? <Loader2Icon className="size-4 animate-spin" /> : <DownloadIcon className="size-4" />}
            {isSaving ? (downloadPercent !== null ? `Saving ${downloadPercent}%` : 'Saving…') : 'Save'}
          </Button>
          {isSaving ? (
            <Button
              size="sm"
              variant="outline"
              disabled={isCancelling}
              onClick={async () => {
                if (!isSaving) return
                setIsCancelling(true)
                const isDesktopTauri = isDesktopTauriRuntime()
                if (isDesktopTauri) {
                  if (activeDownloadOperationId) {
                    await tauriCommands.cancelAttachmentDownload(activeDownloadOperationId)
                  }
                  return
                }
                webDownloadRequestRef.current?.abort()
              }}
            >
              <XIcon className="size-4" />
              {isCancelling ? 'Cancelling…' : 'Cancel'}
            </Button>
          ) : null}
        </div>
      </div>

      {isSaving ? (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-150 ease-out"
            style={{ width: hasDownloadProgress ? `${downloadPercent}%` : '35%' }}
          />
        </div>
      ) : null}
      {resolution.loading ? <p className="mt-1 text-xs text-muted-foreground">Loading secure file URL…</p> : null}
    </div>
  )
}
