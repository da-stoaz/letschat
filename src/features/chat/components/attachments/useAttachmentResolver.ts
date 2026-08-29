import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getSignedDownloadUrls } from '@/lib/uploads'
import type { ChatMessageAttachment } from '@/types/attachments'

export type AttachmentResolution = {
  loading: boolean
  url: string | null
  error: string | null
}

const URL_RESOLVE_TIMEOUT_MS = 15_000
const LOADING_STATE: AttachmentResolution = {
  loading: true,
  url: null,
  error: null,
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs)

    promise
      .then((value) => {
        window.clearTimeout(timeoutId)
        resolve(value)
      })
      .catch((error: unknown) => {
        window.clearTimeout(timeoutId)
        reject(error)
      })
  })
}

export function useAttachmentResolver(attachments: ChatMessageAttachment[]) {
  const [resolutions, setResolutions] = useState<Record<string, AttachmentResolution>>({})
  const mountedRef = useRef(true)
  const inFlightRef = useRef<Set<string>>(new Set())

  // Unknown keys already read as LOADING_STATE via getResolution, and entries
  // for attachments that scrolled away are simply never read, so there is no
  // seeding or pruning state pass — the only setState happens when async
  // resolution completes.
  const attachmentKeys = useMemo(
    () => [...new Set(attachments.map((attachment) => attachment.storageKey))],
    [attachments],
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const keysToResolve = attachmentKeys.filter((storageKey) => {
      if (inFlightRef.current.has(storageKey)) return false
      const state = resolutions[storageKey]
      if (!state) return true
      return state.loading
    })

    if (keysToResolve.length === 0) return

    for (const storageKey of keysToResolve) {
      inFlightRef.current.add(storageKey)
    }

    void (async () => {
      try {
        const urlsByKey = await withTimeout(
          getSignedDownloadUrls(keysToResolve),
          URL_RESOLVE_TIMEOUT_MS,
          'Timed out loading secure file URL.',
        )

        if (!mountedRef.current) return
        setResolutions((previous) => {
          const next = { ...previous }
          for (const storageKey of keysToResolve) {
            const url = urlsByKey.get(storageKey)
            if (!url) {
              next[storageKey] = {
                loading: false,
                url: null,
                error: 'Could not load attachment URL.',
              }
              continue
            }
            next[storageKey] = {
              loading: false,
              url,
              error: null,
            }
          }
          return next
        })
      } catch (error) {
        if (!mountedRef.current) return
        const errorMessage = error instanceof Error ? error.message : 'Could not load attachment URL.'
        setResolutions((previous) => {
          const next = { ...previous }
          for (const storageKey of keysToResolve) {
            next[storageKey] = {
              loading: false,
              url: null,
              error: errorMessage,
            }
          }
          return next
        })
      } finally {
        for (const storageKey of keysToResolve) {
          inFlightRef.current.delete(storageKey)
        }
      }
    })()
  }, [attachmentKeys, resolutions])

  const retry = useCallback((storageKey: string) => {
    setResolutions((previous) => ({
      ...previous,
      [storageKey]: LOADING_STATE,
    }))
  }, [])

  const getResolution = useCallback(
    (storageKey: string): AttachmentResolution => resolutions[storageKey] ?? LOADING_STATE,
    [resolutions],
  )

  return {
    getResolution,
    retry,
  }
}
