import { useEffect } from 'react'
import { subscribeTypingBroadcast } from '../lib/typingBroadcast'
import { usePresenceStore } from '../stores/presenceStore'
import { useTypingStore } from '../stores/typingStore'

export function useTypingBroadcastBridge() {
  const setTyping = useTypingStore((s) => s.setTyping)
  const touchActive = usePresenceStore((s) => s.touchActive)

  useEffect(() => {
    return subscribeTypingBroadcast((payload) => {
      setTyping(payload.scopeKey, payload.identity, payload.isTyping)
      if (payload.isTyping) {
        touchActive(payload.identity, Date.now())
      }
    })
  }, [setTyping, touchActive])
}
