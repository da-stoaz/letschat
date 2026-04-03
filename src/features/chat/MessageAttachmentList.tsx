import { useMemo, useState } from 'react'
import type { ChatMessageAttachment } from '@/types/attachments'
import { AttachmentImageLightbox } from './components/attachments/AttachmentImageLightbox'
import { AttachmentImageGrid, type AttachmentImageGridItem } from './components/attachments/AttachmentImageGrid'
import { AttachmentListItem } from './components/attachments/AttachmentListItem'
import { AttachmentPdfLightbox } from './components/attachments/AttachmentPdfLightbox'
import { getAttachmentKind } from './components/attachments/attachmentUtils'
import { useAttachmentResolver } from './components/attachments/useAttachmentResolver'

type PreviewPdf = {
  url: string
  fileName: string
}

function dedupeAttachments(attachments: ChatMessageAttachment[]): ChatMessageAttachment[] {
  const seen = new Set<string>()
  const deduped: ChatMessageAttachment[] = []

  for (const attachment of attachments) {
    if (seen.has(attachment.storageKey)) continue
    seen.add(attachment.storageKey)
    deduped.push(attachment)
  }

  return deduped
}

export function MessageAttachmentList({ attachments }: { attachments: ChatMessageAttachment[] }) {
  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null)
  const [previewPdf, setPreviewPdf] = useState<PreviewPdf | null>(null)
  const uniqueAttachments = useMemo(() => dedupeAttachments(attachments), [attachments])
  const { getResolution, retry } = useAttachmentResolver(uniqueAttachments)
  const imageAttachments = useMemo(
    () => uniqueAttachments.filter((attachment) => getAttachmentKind(attachment.mimeType) === 'image'),
    [uniqueAttachments],
  )
  const shouldUseImageGrid = imageAttachments.length > 1
  const imageGridItems = useMemo<AttachmentImageGridItem[]>(
    () =>
      imageAttachments.map((attachment) => {
        const resolution = getResolution(attachment.storageKey)
        return {
          storageKey: attachment.storageKey,
          fileName: attachment.fileName,
          url: resolution.url,
          loading: resolution.loading,
          error: resolution.error,
        }
      }),
    [getResolution, imageAttachments],
  )
  const regularAttachments = useMemo(
    () =>
      shouldUseImageGrid ?
        uniqueAttachments.filter((attachment) => getAttachmentKind(attachment.mimeType) !== 'image')
      : uniqueAttachments,
    [shouldUseImageGrid, uniqueAttachments],
  )

  if (uniqueAttachments.length === 0) return null

  return (
    <>
      <div className="space-y-2">
        {shouldUseImageGrid ? (
          <AttachmentImageGrid
            items={imageGridItems}
            onOpen={(index) => setPreviewImageIndex(index)}
            onRetry={retry}
          />
        ) : null}

        {regularAttachments.map((attachment) => (
          <AttachmentListItem
            key={attachment.storageKey}
            attachment={attachment}
            resolution={getResolution(attachment.storageKey)}
            onRetry={retry}
            onOpenImage={(image) => {
              const index = imageGridItems.findIndex((item) => item.fileName === image.fileName && item.url === image.url)
              setPreviewImageIndex(index >= 0 ? index : 0)
            }}
            onOpenPdf={setPreviewPdf}
          />
        ))}
      </div>

      <AttachmentImageLightbox
        images={shouldUseImageGrid ? imageGridItems : imageGridItems.length === 1 ? imageGridItems : []}
        initialIndex={previewImageIndex}
        onClose={() => setPreviewImageIndex(null)}
      />
      <AttachmentPdfLightbox key={previewPdf?.url ?? 'no-pdf'} pdf={previewPdf} onClose={() => setPreviewPdf(null)} />
    </>
  )
}
