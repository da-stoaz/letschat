import type { Identity } from '../types/domain'

export type TypingBroadcastPayload = {
  scopeKey: string
  identity: Identity
  isTyping: boolean
}

const CHANNEL_NAME = 'letschat.typing'

function canUseBroadcastChannel(): boolean {
  return typeof window !== 'undefined' && typeof window.BroadcastChannel !== 'undefined'
}

export function publishTypingBroadcast(payload: TypingBroadcastPayload): void {
  if (!canUseBroadcastChannel()) return
  const channel = new BroadcastChannel(CHANNEL_NAME)
  channel.postMessage(payload)
  channel.close()
}

export function subscribeTypingBroadcast(
  handler: (payload: TypingBroadcastPayload) => void,
): () => void {
  if (!canUseBroadcastChannel()) return () => undefined
  const channel = new BroadcastChannel(CHANNEL_NAME)
  const onMessage = (event: MessageEvent<TypingBroadcastPayload>) => {
    const data = event.data
    if (!data || typeof data.scopeKey !== 'string' || typeof data.identity !== 'string') return
    handler(data)
  }
  channel.addEventListener('message', onMessage)
  return () => {
    channel.removeEventListener('message', onMessage)
    channel.close()
  }
}
