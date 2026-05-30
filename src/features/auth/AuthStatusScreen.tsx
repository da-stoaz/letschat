import type { ReactNode } from 'react'

type Tone = 'primary' | 'success'

/**
 * Centered icon + title + message layout shared by the non-form auth screens
 * (confirm-email, account-ready, blocked, reset-link-sent). Action buttons are
 * passed as children.
 */
export function AuthStatusScreen({
  icon,
  tone = 'primary',
  title,
  description,
  children,
}: {
  icon: ReactNode
  tone?: Tone
  title: string
  description: ReactNode
  children?: ReactNode
}) {
  const toneBg = tone === 'success' ? 'bg-emerald-500/10' : 'bg-primary/10'
  return (
    <div className="space-y-4 text-center">
      <div className={`mx-auto flex size-12 items-center justify-center rounded-full ${toneBg}`}>
        {icon}
      </div>
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  )
}
