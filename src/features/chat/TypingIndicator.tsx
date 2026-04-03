import { useEffect, useMemo } from 'react'
import { useUsersStore } from '../../stores/usersStore'
import { useTypingStore } from '../../stores/typingStore'
import type { Identity } from '../../types/domain'

function normalizeIdentity(value: string | null | undefined): string {
  if (!value) return ''
  return value.trim().toLowerCase()
}

function renderTypingText(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return `${names[0]} is typing...`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`
  return `${names[0]}, ${names[1]} and ${names.length - 2} others are typing...`
}

export function TypingIndicator({
  scopeKey,
  selfIdentity,
  className = '',
  fallbackText,
}: {
  scopeKey?: string
  selfIdentity: Identity | null
  className?: string
  fallbackText?: string
}) {
  const typingByScope = useTypingStore((s) => s.typingByScope)
  const pruneExpired = useTypingStore((s) => s.pruneExpired)
  const usersByIdentity = useUsersStore((s) => s.byIdentity)

  useEffect(() => {
    const interval = window.setInterval(() => {
      pruneExpired()
    }, 1000)
    return () => window.clearInterval(interval)
  }, [pruneExpired])

  const names = useMemo(() => {
    if (!scopeKey) return []
    const current = typingByScope[scopeKey] ?? {}
    const selfKey = normalizeIdentity(selfIdentity)
    return Object.keys(current)
      .filter((identity) => identity !== selfKey)
      .map((identity) => {
        const user = Object.values(usersByIdentity).find(
          (candidate) => normalizeIdentity(candidate.identity) === identity,
        )
        return user?.displayName || user?.username || identity.slice(0, 12)
      })
  }, [scopeKey, selfIdentity, typingByScope, usersByIdentity])

  if (names.length === 0) {
    return fallbackText ? <span className={className}>{fallbackText}</span> : null
  }

  return (
    <span className={`inline-flex items-center gap-2 text-xs text-muted-foreground ${className}`}>
      <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-2 py-1">
        <span className="size-1.5 rounded-full bg-muted-foreground/80 animate-pulse [animation-delay:-0.25s]" />
        <span className="size-1.5 rounded-full bg-muted-foreground/80 animate-pulse [animation-delay:-0.125s]" />
        <span className="size-1.5 rounded-full bg-muted-foreground/80 animate-pulse" />
      </span>
      <span className="truncate">{renderTypingText(names)}</span>
    </span>
  )
}
