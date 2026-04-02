import {
  authServiceDownloadUrl,
  authServiceDownloadUrls,
  type DownloadUrlBatchItem,
} from './authService'
import { withSessionTokenRetry } from './uploadSession'

const DOWNLOAD_CACHE_EARLY_REFRESH_MS = 30_000
const BATCH_ENDPOINT_RECHECK_MS = 60_000

type DownloadCacheEntry = {
  url: string
  expiresAtMs: number
}

type BatchEndpointStatus = 'unknown' | 'available' | 'unavailable'

const downloadUrlCache = new Map<string, DownloadCacheEntry>()
const inflightDownloadRequests = new Map<string, Promise<string>>()
let batchEndpointStatus: BatchEndpointStatus = 'unknown'
let batchEndpointUnavailableUntilMs = 0

function toDownloadCacheEntry(item: DownloadUrlBatchItem): DownloadCacheEntry {
  return {
    url: item.url,
    expiresAtMs: Date.now() + item.expiresIn * 1000,
  }
}

function isBatchEndpointUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message.includes('request failed (404)') || message.includes('not found')
}

function canProbeBatchEndpoint(nowMs: number): boolean {
  if (batchEndpointStatus !== 'unavailable') return true
  return nowMs >= batchEndpointUnavailableUntilMs
}

function markBatchEndpointUnavailable(): void {
  batchEndpointStatus = 'unavailable'
  batchEndpointUnavailableUntilMs = Date.now() + BATCH_ENDPOINT_RECHECK_MS
}

async function requestDownloadUrlSingle(storageKey: string): Promise<DownloadCacheEntry> {
  const response = await withSessionTokenRetry((sessionToken) => authServiceDownloadUrl({ sessionToken, storageKey }))
  return {
    url: response.url,
    expiresAtMs: Date.now() + response.expiresIn * 1000,
  }
}

async function requestDownloadUrlBatch(storageKeys: string[]): Promise<Map<string, DownloadCacheEntry>> {
  const uniqueKeys = [...new Set(storageKeys)]
  const entriesByKey = new Map<string, DownloadCacheEntry>()
  const nowMs = Date.now()

  if (canProbeBatchEndpoint(nowMs)) {
    try {
      const batchResponse = await withSessionTokenRetry((sessionToken) =>
        authServiceDownloadUrls({ sessionToken, storageKeys: uniqueKeys }),
      )
      batchEndpointStatus = 'available'
      batchEndpointUnavailableUntilMs = 0

      for (const item of batchResponse.items) {
        entriesByKey.set(item.storageKey, toDownloadCacheEntry(item))
      }
    } catch (error) {
      if (!isBatchEndpointUnavailableError(error)) {
        throw error
      }
      markBatchEndpointUnavailable()
    }
  }

  if (entriesByKey.size < uniqueKeys.length) {
    const missingKeys = uniqueKeys.filter((storageKey) => !entriesByKey.has(storageKey))
    const fallbackEntries = await Promise.all(
      missingKeys.map(async (storageKey) => [storageKey, await requestDownloadUrlSingle(storageKey)] as const),
    )

    for (const [storageKey, entry] of fallbackEntries) {
      entriesByKey.set(storageKey, entry)
    }
  }

  return entriesByKey
}

export async function getSignedDownloadUrls(storageKeys: string[]): Promise<Map<string, string>> {
  const now = Date.now()
  const uniqueKeys = [...new Set(storageKeys.filter((key) => key.trim().length > 0))]
  const urlsByKey = new Map<string, string>()
  const missingKeys: string[] = []

  for (const storageKey of uniqueKeys) {
    const cached = downloadUrlCache.get(storageKey)
    if (cached && cached.expiresAtMs - DOWNLOAD_CACHE_EARLY_REFRESH_MS > now) {
      urlsByKey.set(storageKey, cached.url)
    } else {
      missingKeys.push(storageKey)
    }
  }

  if (missingKeys.length === 0) return urlsByKey

  const fetchedEntries = await requestDownloadUrlBatch(missingKeys)
  for (const [storageKey, entry] of fetchedEntries) {
    downloadUrlCache.set(storageKey, entry)
    urlsByKey.set(storageKey, entry.url)
  }

  return urlsByKey
}

export async function getSignedDownloadUrl(storageKey: string): Promise<string> {
  const now = Date.now()
  const cached = downloadUrlCache.get(storageKey)
  if (cached && cached.expiresAtMs - DOWNLOAD_CACHE_EARLY_REFRESH_MS > now) {
    return cached.url
  }

  const existingRequest = inflightDownloadRequests.get(storageKey)
  if (existingRequest) {
    return existingRequest
  }

  const request = (async () => {
    const urlsByKey = await getSignedDownloadUrls([storageKey])
    const resolvedUrl = urlsByKey.get(storageKey)
    if (!resolvedUrl) {
      throw new Error('Could not load attachment URL.')
    }
    return resolvedUrl
  })()

  inflightDownloadRequests.set(storageKey, request)

  try {
    return await request
  } finally {
    inflightDownloadRequests.delete(storageKey)
  }
}

export function clearSignedDownloadUrlCache(): void {
  downloadUrlCache.clear()
  inflightDownloadRequests.clear()
  batchEndpointStatus = 'unknown'
  batchEndpointUnavailableUntilMs = 0
}
