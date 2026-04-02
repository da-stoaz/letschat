import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getSignedDownloadUrl } from '@/lib/uploads'
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

  const attachmentKeys = useMemo(() => attachments.map((attachment) => attachment.storageKey), [attachments])

  useEffect(
    () => () => {
      mountedRef.current = false
    },
    [],
  )

  useEffect(() => {
    if (attachmentKeys.length === 0) {
      setResolutions({})
      return
    }

    const visibleKeys = new Set(attachmentKeys)
    setResolutions((previous) => {
      let changed = false
      const next: Record<string, AttachmentResolution> = {}
      for (const [key, value] of Object.entries(previous)) {
        if (visibleKeys.has(key)) {
          next[key] = value
        } else {
          changed = true
        }
      }
      return changed ? next : previous
    })
  }, [attachmentKeys])

  useEffect(() => {
    if (attachments.length === 0) return

    const keysToResolve = attachments
      .map((attachment) => attachment.storageKey)
      .filter((storageKey) => {
        if (inFlightRef.current.has(storageKey)) return false
        const state = resolutions[storageKey]
        if (!state) return true
        return state.loading
      })

    if (keysToResolve.length === 0) return

    setResolutions((previous) => {
      let changed = false
      const next = { ...previous }
      for (const storageKey of keysToResolve) {
        const current = next[storageKey]
        if (!current || !current.loading || current.url !== null || current.error !== null) {
          next[storageKey] = LOADING_STATE
          changed = true
        }
      }
      return changed ? next : previous
    })

    for (const storageKey of keysToResolve) {
      inFlightRef.current.add(storageKey)
      void (async () => {
        try {
          const url = await withTimeout(
            getSignedDownloadUrl(storageKey),
            URL_RESOLVE_TIMEOUT_MS,
            'Timed out loading secure file URL.',
          )

          if (!mountedRef.current) return
          setResolutions((previous) => ({
            ...previous,
            [storageKey]: {
              loading: false,
              url,
              error: null,
            },
          }))
        } catch (error) {
          if (!mountedRef.current) return
          const errorMessage = error instanceof Error ? error.message : 'Could not load attachment URL.'
          setResolutions((previous) => ({
            ...previous,
            [storageKey]: {
              loading: false,
              url: null,
              error: errorMessage,
            },
          }))
        } finally {
          inFlightRef.current.delete(storageKey)
        }
      })()
    }
  }, [attachments, resolutions])

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
