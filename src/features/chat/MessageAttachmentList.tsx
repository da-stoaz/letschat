import { useMemo, useState } from 'react'
import type { ChatMessageAttachment } from '@/types/attachments'
import { AttachmentImageLightbox } from './components/attachments/AttachmentImageLightbox'
import { AttachmentListItem } from './components/attachments/AttachmentListItem'
import { AttachmentPdfLightbox } from './components/attachments/AttachmentPdfLightbox'
import { useAttachmentResolver } from './components/attachments/useAttachmentResolver'

type PreviewImage = {
  url: string
  fileName: string
}

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
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null)
  const [previewPdf, setPreviewPdf] = useState<PreviewPdf | null>(null)
  const uniqueAttachments = useMemo(() => dedupeAttachments(attachments), [attachments])
  const { getResolution, retry } = useAttachmentResolver(uniqueAttachments)

  if (uniqueAttachments.length === 0) return null

  return (
    <>
      <div className="space-y-2">
        {uniqueAttachments.map((attachment) => (
          <AttachmentListItem
            key={attachment.storageKey}
            attachment={attachment}
            resolution={getResolution(attachment.storageKey)}
            onRetry={retry}
            onOpenImage={setPreviewImage}
            onOpenPdf={setPreviewPdf}
          />
        ))}
      </div>

      <AttachmentImageLightbox key={previewImage?.url ?? 'no-image'} image={previewImage} onClose={() => setPreviewImage(null)} />
      <AttachmentPdfLightbox key={previewPdf?.url ?? 'no-pdf'} pdf={previewPdf} onClose={() => setPreviewPdf(null)} />
    </>
  )
}
