import type { UserPresenceStatus } from '../../hooks/useUserPresentation'

function statusClass(status: UserPresenceStatus): string {
  if (status === 'online') return 'bg-emerald-400'
  if (status === 'away') return 'bg-amber-400'
  return 'bg-muted-foreground/40'
}

export function PresenceDot({ status, className }: { status: UserPresenceStatus; className?: string }) {
  return <span className={`${statusClass(status)} inline-block rounded-full ${className ?? 'size-2'}`} />
}

