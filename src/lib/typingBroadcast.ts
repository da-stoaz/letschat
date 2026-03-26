import type { Identity } from '../types/domain'

export type TypingBroadcastPayload = {
  scopeKey: string
  identity: Identity
  isTyping: boolean
}

const CHANNEL_NAME = 'letschat.typing'
const STORAGE_EVENT_KEY = 'letschat.typing.event'

type TypingStoragePayload = TypingBroadcastPayload & {
  ts: number
  nonce: string
}

function canUseBroadcastChannel(): boolean {
  return typeof window !== 'undefined' && typeof window.BroadcastChannel !== 'undefined'
}

function toStoragePayload(payload: TypingBroadcastPayload): TypingStoragePayload {
  const nonce =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`

  return {
    ...payload,
    ts: Date.now(),
    nonce,
  }
}

function parsePayload(value: unknown): TypingBroadcastPayload | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<TypingBroadcastPayload>
  if (
    typeof candidate.scopeKey !== 'string' ||
    typeof candidate.identity !== 'string' ||
    typeof candidate.isTyping !== 'boolean'
  ) {
    return null
  }
  return {
    scopeKey: candidate.scopeKey,
    identity: candidate.identity,
    isTyping: candidate.isTyping,
  }
}

export function publishTypingBroadcast(payload: TypingBroadcastPayload): void {
  if (typeof window === 'undefined') return

  if (canUseBroadcastChannel()) {
    try {
      const channel = new BroadcastChannel(CHANNEL_NAME)
      channel.postMessage(payload)
      channel.close()
    } catch {
      // Ignore BroadcastChannel failures and fall back to storage event below.
    }
  }

  try {
    window.localStorage.setItem(
      STORAGE_EVENT_KEY,
      JSON.stringify(toStoragePayload(payload)),
    )
  } catch {
    // Ignore storage failures in restricted/private contexts.
  }
}

export function subscribeTypingBroadcast(
  handler: (payload: TypingBroadcastPayload) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined

  let channel: BroadcastChannel | null = null
  let onChannelMessage: ((event: MessageEvent<TypingBroadcastPayload>) => void) | null = null

  if (canUseBroadcastChannel()) {
    channel = new BroadcastChannel(CHANNEL_NAME)
    onChannelMessage = (event: MessageEvent<TypingBroadcastPayload>) => {
      const parsed = parsePayload(event.data)
      if (!parsed) return
      handler(parsed)
    }
    channel.addEventListener('message', onChannelMessage)
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_EVENT_KEY || !event.newValue) return
    try {
      const parsed = parsePayload(JSON.parse(event.newValue))
      if (!parsed) return
      handler(parsed)
    } catch {
      // Ignore malformed payloads.
    }
  }
  window.addEventListener('storage', onStorage)

  return () => {
    window.removeEventListener('storage', onStorage)
    if (channel && onChannelMessage) {
      channel.removeEventListener('message', onChannelMessage)
      channel.close()
    }
  }
}
