import { useRef, useState } from 'react'
import { DownloadIcon, ExternalLinkIcon, FileIcon, ImageIcon, Loader2Icon, MusicIcon, VideoIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { downloadAttachment } from '@/lib/attachmentDownload'
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

function isPdfAttachment(attachment: ChatMessageAttachment): boolean {
  return (
    attachment.mimeType.toLowerCase() === 'application/pdf' ||
    attachment.fileName.toLowerCase().endsWith('.pdf')
  )
}

export function AttachmentListItem({ attachment, resolution, onRetry, onOpenImage, onOpenPdf }: AttachmentListItemProps) {
  const cancelDownloadRef = useRef<(() => Promise<void>) | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [downloadProgressFraction, setDownloadProgressFraction] = useState<number | null>(null)
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
    <div className="rounded-lg border border-border/70 bg-muted/20 p-1">
      {(kind === 'image' || kind === 'video' || kind === 'audio') && canOpen ? (
        <div className="mb-1 overflow-hidden rounded-md border border-border/60 bg-background/50">
          {kind === 'image' ? (
            <button
              type="button"
              className="block w-full cursor-zoom-in focus:outline-none"
              onClick={() => resolution.url && onOpenImage({ url: resolution.url, fileName: attachment.fileName })}
            >
              <img src={resolution.url ?? ''} alt={attachment.fileName} className="max-h-56 w-full object-contain" />
            </button>
          ) : kind === 'video' ? (
            <video src={resolution.url ?? ''} controls className="max-h-56 w-full bg-black" />
          ) : (
            <audio src={resolution.url ?? ''} controls className="w-full p-1.5" />
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
              cancelDownloadRef.current = null
              try {
                await downloadAttachment({
                  url: resolution.url,
                  fileName: attachment.fileName,
                  onProgress: setDownloadProgressFraction,
                  onCancelReady: (cancel) => {
                    cancelDownloadRef.current = cancel
                  },
                })
              } catch (error) {
                void error
              } finally {
                setIsSaving(false)
                setIsCancelling(false)
                setDownloadProgressFraction(null)
                cancelDownloadRef.current = null
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
                await cancelDownloadRef.current?.()
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
