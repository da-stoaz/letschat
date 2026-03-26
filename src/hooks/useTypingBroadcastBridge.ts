import { useEffect } from 'react'
import { subscribeTypingBroadcast } from '../lib/typingBroadcast'
import { useTypingStore } from '../stores/typingStore'

export function useTypingBroadcastBridge() {
  const setTyping = useTypingStore((s) => s.setTyping)

  useEffect(() => {
    return subscribeTypingBroadcast((payload) => {
      setTyping(payload.scopeKey, payload.identity, payload.isTyping)
    })
  }, [setTyping])
}
