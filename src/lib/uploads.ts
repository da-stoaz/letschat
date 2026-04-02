import {
  authServiceDownloadUrl,
  authServiceRenewSession,
  authServiceUploadConfirm,
  authServiceUploadRequest,
  type AuthFrameworkToken,
  getStoredAuthSessionToken,
} from './authService'
import { getCurrentSessionToken } from './spacetimedb'
import type { ChatMessageAttachment } from '../types/attachments'
import { useConnectionStore } from '../stores/connectionStore'

export const MAX_UPLOAD_FILE_SIZE_BYTES = 500 * 1024 * 1024 // 500 MB
const DEFAULT_MIME_TYPE = 'application/octet-stream'
const DOWNLOAD_CACHE_EARLY_REFRESH_MS = 30_000

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

type DownloadCacheEntry = {
  url: string
  expiresAtMs: number
}

const downloadUrlCache = new Map<string, DownloadCacheEntry>()
const inflightDownloadRequests = new Map<string, Promise<DownloadCacheEntry>>()
let renewSessionPromise: Promise<AuthFrameworkToken> | null = null

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

function isSessionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message.includes('invalid or expired session token') || message.includes('invalid auth session')
}

function isTokenExpiredSoon(token: AuthFrameworkToken, bufferMs = 30_000): boolean {
  const expiresAtMs = Date.parse(token.expires_at)
  if (!Number.isFinite(expiresAtMs)) return true
  return Date.now() >= expiresAtMs - bufferMs
}

async function renewAuthSession(): Promise<AuthFrameworkToken> {
  if (renewSessionPromise) return renewSessionPromise

  renewSessionPromise = (async () => {
    const spacetimeToken = getCurrentSessionToken()
    const spacetimeIdentity = useConnectionStore.getState().identity
    if (!spacetimeToken || !spacetimeIdentity) {
      throw new Error('Your auth session expired. Please sign in again.')
    }
    return authServiceRenewSession({
      spacetimeToken,
      spacetimeIdentity,
    })
  })()

  try {
    return await renewSessionPromise
  } finally {
    renewSessionPromise = null
  }
}

async function ensureActiveSessionToken(): Promise<AuthFrameworkToken> {
  const currentToken = getStoredAuthSessionToken()
  if (currentToken && !isTokenExpiredSoon(currentToken)) {
    return currentToken
  }
  return renewAuthSession()
}

async function withSessionTokenRetry<T>(fn: (sessionToken: AuthFrameworkToken) => Promise<T>): Promise<T> {
  const initialToken = await ensureActiveSessionToken()
  try {
    return await fn(initialToken)
  } catch (error) {
    if (!isSessionError(error)) throw error
  }

  const refreshedToken = await renewAuthSession()
  return fn(refreshedToken)
}

export async function uploadSingleFile(
  file: File,
  onStage?: UploadStageCallback,
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
  const uploadResponse = await fetch(request.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
    },
    body: file,
  })
  if (!uploadResponse.ok) {
    throw new Error(`Storage upload failed (${uploadResponse.status})`)
  }

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
): Promise<ChatMessageAttachment[]> {
  const uploaded: ChatMessageAttachment[] = []

  for (const file of files) {
    try {
      const next = await uploadSingleFile(file, onStage)
      uploaded.push(next)
    } catch (error) {
      throw new Error(buildUploadErrorMessage(file.name, error))
    }
  }

  return uploaded
}

export async function getSignedDownloadUrl(storageKey: string): Promise<string> {
  const now = Date.now()
  const cached = downloadUrlCache.get(storageKey)
  if (cached && cached.expiresAtMs - DOWNLOAD_CACHE_EARLY_REFRESH_MS > now) {
    return cached.url
  }

  const existingRequest = inflightDownloadRequests.get(storageKey)
  if (existingRequest) {
    const entry = await existingRequest
    return entry.url
  }

  const request = (async () => {
    const response = await withSessionTokenRetry((sessionToken) => authServiceDownloadUrl({ sessionToken, storageKey }))
    const entry: DownloadCacheEntry = {
      url: response.url,
      expiresAtMs: Date.now() + response.expiresIn * 1000,
    }
    downloadUrlCache.set(storageKey, entry)
    return entry
  })()

  inflightDownloadRequests.set(storageKey, request)

  try {
    const entry = await request
    return entry.url
  } finally {
    inflightDownloadRequests.delete(storageKey)
  }
}

export function clearSignedDownloadUrlCache(): void {
  downloadUrlCache.clear()
  inflightDownloadRequests.clear()
}
