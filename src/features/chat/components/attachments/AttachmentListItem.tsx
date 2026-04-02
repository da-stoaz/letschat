import { DownloadIcon, ExternalLinkIcon, FileIcon, ImageIcon, MusicIcon, VideoIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ChatMessageAttachment } from '@/types/attachments'
import { formatFileSize, getAttachmentKind } from './attachmentUtils'
import type { AttachmentResolution } from './useAttachmentResolver'

type AttachmentListItemProps = {
  attachment: ChatMessageAttachment
  resolution: AttachmentResolution
  onRetry: (storageKey: string) => void
  onOpenImage: (image: { url: string; fileName: string }) => void
}

function openUrl(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function downloadFile(url: string, fileName: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export function AttachmentListItem({ attachment, resolution, onRetry, onOpenImage }: AttachmentListItemProps) {
  const kind = getAttachmentKind(attachment.mimeType)
  const canOpen = Boolean(resolution.url)

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
              openUrl(resolution.url)
            }}
          >
            <ExternalLinkIcon className="size-4" />
            {kind === 'image' ? 'Preview' : 'Open'}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            disabled={!canOpen}
            onClick={() => {
              if (!resolution.url) return
              downloadFile(resolution.url, attachment.fileName)
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
}
