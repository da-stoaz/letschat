export type AttachmentKind = 'image' | 'video' | 'audio' | 'file'

export function getAttachmentKind(mimeType: string): AttachmentKind {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'file'
}

/**
 * core-api renders a poster for each video in the background and stores it
 * next to the video (VideoThumbnailWorker.KeySuffix). Until it exists the
 * signed URL simply 404s and the player shows its placeholder.
 */
export function videoThumbnailKey(storageKey: string): string {
  return `${storageKey}.thumb.jpg`
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`

  const units = ['KB', 'MB', 'GB'] as const
  let value = bytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}
