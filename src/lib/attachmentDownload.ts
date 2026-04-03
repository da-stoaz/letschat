import { isDesktopTauriRuntime, tauriCommands } from './tauri'

export type AttachmentDownloadOptions = {
  url: string
  fileName: string
  onProgress?: (fraction: number | null) => void
  onCancelReady?: (cancel: () => Promise<void>) => void
}

function createDownloadOperationId(fileName: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${fileName}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  anchor.rel = 'noopener noreferrer'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}

async function downloadForWeb({
  url,
  fileName,
  onProgress,
  onCancelReady,
}: AttachmentDownloadOptions): Promise<void> {
  const abortController = new AbortController()
  onCancelReady?.(async () => {
    abortController.abort()
  })

  const response = await fetch(url, { signal: abortController.signal })
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}).`)
  }

  const contentLengthHeader = response.headers.get('content-length')
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN
  const totalBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null

  if (!response.body) {
    const blob = await response.blob()
    onProgress?.(1)
    triggerBrowserDownload(blob, fileName)
    return
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let receivedBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    receivedBytes += value.byteLength
    if (totalBytes) {
      onProgress?.(Math.min(1, receivedBytes / totalBytes))
    } else {
      onProgress?.(null)
    }
  }

  const blob = new Blob(chunks)
  onProgress?.(1)
  triggerBrowserDownload(blob, fileName)
}

async function downloadForTauri({
  url,
  fileName,
  onProgress,
  onCancelReady,
}: AttachmentDownloadOptions): Promise<void> {
  const operationId = createDownloadOperationId(fileName)
  onCancelReady?.(async () => {
    await tauriCommands.cancelAttachmentDownload(operationId)
  })

  const unlisten = await tauriCommands.onAttachmentDownloadProgress((event) => {
    if (event.operationId !== operationId) return
    if (event.totalBytes && event.totalBytes > 0) {
      onProgress?.(Math.min(1, event.bytesDownloaded / event.totalBytes))
    } else if (event.completed) {
      onProgress?.(1)
    } else {
      onProgress?.(null)
    }
  })

  try {
    await tauriCommands.saveAttachmentFile(url, fileName, operationId)
  } finally {
    unlisten()
  }
}

export async function downloadAttachment(options: AttachmentDownloadOptions): Promise<void> {
  if (isDesktopTauriRuntime()) {
    await downloadForTauri(options)
    return
  }
  await downloadForWeb(options)
}
