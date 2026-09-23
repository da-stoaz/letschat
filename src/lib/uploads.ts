import {
  authServiceUploadAbort, authServiceUploadConfirm, authServiceUploadPartUrl, authServiceUploadRequest,
  authServiceUploadStatus, type UploadRequestResponse, type UploadScope,
} from './authService'
import { withSessionTokenRetry } from './uploadSession'
import type { ChatMessageAttachment } from '../types/attachments'

export { clearSignedDownloadUrlCache, getSignedDownloadUrl, getSignedDownloadUrls } from './downloadUrls'
export type { UploadScope } from './authService'

const DEFAULT_MIME_TYPE = 'application/octet-stream'
const activeUploads = new WeakMap<File, {
  scope: string
  request: UploadRequestResponse
  expiresAt: number
  uploaded: boolean
}>()

/** Explicitly release a multipart reservation when a queued file is removed. */
export async function cancelUpload(file: File): Promise<void> {
  const active = activeUploads.get(file)
  if (!active) return
  try {
    await withSessionTokenRetry((sessionToken) =>
      authServiceUploadAbort({ sessionToken, uploadId: active.request.uploadId }),
    )
  } finally {
    if (activeUploads.get(file) === active) activeUploads.delete(file)
  }
}

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

function storageHost(uploadUrl: string): string {
  try {
    return new URL(uploadUrl).host
  } catch {
    return 'the storage host'
  }
}

/**
 * MinIO reports failures as an XML body (`<Error><Code>…`). Surfacing that code
 * turns an opaque "failed (403)" into something actionable — SignatureDoesNotMatch
 * and AccessDenied have very different fixes.
 */
function storageErrorCode(responseText: string | null): string | null {
  const match = /<Code>([^<]+)<\/Code>/.exec(responseText ?? '')
  return match ? match[1] : null
}

async function uploadFileToStorage(
  body: Blob,
  uploadUrl: string,
  mimeType: string,
  onBytes?: (loaded: number) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', uploadUrl, true)
    request.setRequestHeader('Content-Type', mimeType)
    request.responseType = 'text'

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      onBytes?.(Math.min(body.size, event.loaded))
    }

    request.onerror = () => {
      // A blocked CORS preflight and a dead socket are indistinguishable here —
      // XHR reports both as status 0 with no body. Name both causes rather than
      // failing with nothing anyone can act on: pinning MINIO_CORS_ALLOW_ORIGIN
      // to the web origin blocks the desktop app, whose origin is
      // tauri://localhost, and the upload then dies at the preflight.
      reject(
        new Error(
          `Storage upload failed — could not reach ${storageHost(uploadUrl)} (network error, or the storage host rejected the CORS preflight; check MINIO_CORS_ALLOW_ORIGIN).`,
        ),
      )
    }
    request.onabort = () => {
      reject(new Error('Storage upload was cancelled.'))
    }
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onBytes?.(body.size)
        resolve()
        return
      }
      const code = storageErrorCode(request.responseText)
      reject(
        new Error(
          code
            ? `Storage upload failed (${request.status} ${code}) at ${storageHost(uploadUrl)}.`
            : `Storage upload failed (${request.status}) at ${storageHost(uploadUrl)}.`,
        ),
      )
    }

    request.send(body)
  })
}

function reportProgress(file: File, loaded: number, onProgress?: UploadProgressCallback): void {
  onProgress?.(file, {
    loadedBytes: loaded,
    totalBytes: file.size,
    fraction: Math.min(1, loaded / file.size),
  })
}

async function uploadMultipart(
  file: File,
  request: UploadRequestResponse,
  mimeType: string,
  onProgress?: UploadProgressCallback,
): Promise<void> {
  const partSize = request.partSizeBytes
  const partCount = request.partCount
  if (!partSize || !partCount || partSize <= 0 || partCount !== Math.ceil(file.size / partSize)) {
    throw new Error('Server returned invalid multipart upload parameters.')
  }
  const status = await withSessionTokenRetry((sessionToken) =>
    authServiceUploadStatus({ sessionToken, uploadId: request.uploadId }),
  )
  const completed = new Set(status.completedParts)
  let doneBytes = 0
  for (const number of completed) {
    if (number < 1 || number > partCount) throw new Error('Server returned an invalid uploaded part.')
    doneBytes += Math.min(partSize, file.size - (number - 1) * partSize)
  }
  reportProgress(file, doneBytes, onProgress)

  for (let number = 1; number <= partCount; number += 1) {
    if (completed.has(number)) continue
    const start = (number - 1) * partSize
    const body = file.slice(start, Math.min(file.size, start + partSize))
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const { url } = await withSessionTokenRetry((sessionToken) =>
          authServiceUploadPartUrl({ sessionToken, uploadId: request.uploadId, partNumber: number }),
        )
        await uploadFileToStorage(body, url, mimeType, (loaded) =>
          reportProgress(file, doneBytes + loaded, onProgress),
        )
        lastError = null
        break
      } catch (error) {
        lastError = error
      }
    }
    if (lastError) throw lastError
    doneBytes += body.size
    reportProgress(file, doneBytes, onProgress)
  }
}

export async function uploadSingleFile(
  file: File,
  scope: UploadScope,
  onStage?: UploadStageCallback,
  onProgress?: UploadProgressCallback,
): Promise<ChatMessageAttachment> {
  const mimeType = safeMimeType(file)

  if (file.size <= 0) {
    throw new Error('File is empty.')
  }

  if (isBlockedMimeType(mimeType)) {
    throw new Error('This file type is not allowed.')
  }

  onStage?.(file, 'requesting')
  const scopeKey = JSON.stringify(scope)
  let active = activeUploads.get(file)
  if (active && (active.scope !== scopeKey || active.expiresAt <= Date.now())) {
    // The old session is either unusable or belongs to another storage scope.
    // Cleanup is best-effort; the server sweeper handles an outage.
    void cancelUpload(file).catch(() => undefined)
    activeUploads.delete(file)
    active = undefined
  }
  if (!active) {
    const request = await withSessionTokenRetry((sessionToken) =>
      authServiceUploadRequest({
        sessionToken,
        fileName: file.name,
        fileSize: file.size,
        mimeType,
        scope,
        supportsMultipart: true,
      }),
    )
    active = { scope: scopeKey, request, expiresAt: Date.now() + request.expiresIn * 1000 - 10_000, uploaded: false }
    if (request.mode === 'multipart') activeUploads.set(file, active)
  }
  const request = active.request

  onStage?.(file, 'uploading')
  reportProgress(file, 0, onProgress)
  if (!active.uploaded) {
    if (request.mode === 'multipart') {
      await uploadMultipart(file, request, mimeType, onProgress)
    } else {
      if (!request.uploadUrl) throw new Error('Server did not return an upload URL.')
      await uploadFileToStorage(file, request.uploadUrl, mimeType, (loaded) =>
        reportProgress(file, loaded, onProgress),
      )
    }
    active.uploaded = true
  }

  onStage?.(file, 'confirming')
  const confirmed = await withSessionTokenRetry((sessionToken) =>
    authServiceUploadConfirm({
      sessionToken,
      uploadId: request.uploadId,
    }),
  )
  activeUploads.delete(file)
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
  scope: UploadScope,
  onStage?: UploadStageCallback,
  onProgress?: UploadProgressCallback,
): Promise<ChatMessageAttachment[]> {
  const uploaded: ChatMessageAttachment[] = []

  for (const file of files) {
    try {
      const next = await uploadSingleFile(file, scope, onStage, onProgress)
      uploaded.push(next)
    } catch (error) {
      throw new Error(buildUploadErrorMessage(file.name, error), { cause: error })
    }
  }

  return uploaded
}
