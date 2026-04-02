import { authServiceUploadConfirm, authServiceUploadRequest } from './authService'
import { withSessionTokenRetry } from './uploadSession'
import type { ChatMessageAttachment } from '../types/attachments'

export { clearSignedDownloadUrlCache, getSignedDownloadUrl, getSignedDownloadUrls } from './downloadUrls'

export const MAX_UPLOAD_FILE_SIZE_BYTES = 500 * 1024 * 1024 // 500 MB
const DEFAULT_MIME_TYPE = 'application/octet-stream'

const BLOCKED_MIME_PREFIXES = [
  'application/x-msdownload',
  'application/x-executable',
  'application/x-sh',
  'application/x-bat',
  'application/x-msdos-program',
  'application/x-dosexec',
]

type UploadStage = 'requesting' | 'uploading' | 'confirming' | 'done'
type UploadStageCallback = (file: File, stage: UploadStage) => void
export type UploadProgress = {
  loadedBytes: number
  totalBytes: number
  fraction: number
}
type UploadProgressCallback = (file: File, progress: UploadProgress) => void

function safeMimeType(file: File): string {
  const mimeType = file.type?.trim().toLowerCase()
  return mimeType.length > 0 ? mimeType : DEFAULT_MIME_TYPE
}

function buildUploadErrorMessage(fileName: string, error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return `${fileName}: ${error.message}`
  }
  return `${fileName}: Upload failed.`
}

export function isBlockedMimeType(mimeType: string): boolean {
  const normalized = mimeType.trim().toLowerCase()
  return BLOCKED_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

async function uploadFileToStorage(
  file: File,
  uploadUrl: string,
  mimeType: string,
  onProgress?: UploadProgressCallback,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', uploadUrl, true)
    request.setRequestHeader('Content-Type', mimeType)
    request.responseType = 'text'

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      const totalBytes = Math.max(1, event.total)
      onProgress?.(file, {
        loadedBytes: event.loaded,
        totalBytes,
        fraction: Math.min(1, event.loaded / totalBytes),
      })
    }

    request.onerror = () => {
      reject(new Error('Storage upload failed (network error).'))
    }
    request.onabort = () => {
      reject(new Error('Storage upload was cancelled.'))
    }
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(file, {
          loadedBytes: file.size,
          totalBytes: Math.max(1, file.size),
          fraction: 1,
        })
        resolve()
        return
      }
      reject(new Error(`Storage upload failed (${request.status})`))
    }

    request.send(file)
  })
}

export async function uploadSingleFile(
  file: File,
  onStage?: UploadStageCallback,
  onProgress?: UploadProgressCallback,
): Promise<ChatMessageAttachment> {
  const mimeType = safeMimeType(file)

  if (file.size <= 0) {
    throw new Error('File is empty.')
  }

  if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
    throw new Error(`File exceeds ${Math.round(MAX_UPLOAD_FILE_SIZE_BYTES / 1024 / 1024)} MB.`)
  }

  if (isBlockedMimeType(mimeType)) {
    throw new Error('This file type is not allowed.')
  }

  onStage?.(file, 'requesting')
  const request = await withSessionTokenRetry((sessionToken) =>
    authServiceUploadRequest({
      sessionToken,
      fileName: file.name,
      fileSize: file.size,
      mimeType,
    }),
  )

  onStage?.(file, 'uploading')
  onProgress?.(file, {
    loadedBytes: 0,
    totalBytes: Math.max(1, file.size),
    fraction: 0,
  })
  await uploadFileToStorage(file, request.uploadUrl, mimeType, onProgress)

  onStage?.(file, 'confirming')
  const confirmed = await withSessionTokenRetry((sessionToken) =>
    authServiceUploadConfirm({
      sessionToken,
      uploadId: request.uploadId,
    }),
  )
  onStage?.(file, 'done')

  return {
    storageKey: confirmed.storageKey,
    fileName: confirmed.fileName,
    fileSize: confirmed.fileSize,
    mimeType: confirmed.mimeType,
  }
}

export async function uploadFiles(
  files: File[],
  onStage?: UploadStageCallback,
  onProgress?: UploadProgressCallback,
): Promise<ChatMessageAttachment[]> {
  const uploaded: ChatMessageAttachment[] = []

  for (const file of files) {
    try {
      const next = await uploadSingleFile(file, onStage, onProgress)
      uploaded.push(next)
    } catch (error) {
      throw new Error(buildUploadErrorMessage(file.name, error))
    }
  }

  return uploaded
}
