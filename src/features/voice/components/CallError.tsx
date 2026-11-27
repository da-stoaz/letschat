import { toast } from 'sonner'
import { CircleAlertIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { privacySettingsDevice } from '../../../lib/livekit'
import { isDesktopTauriRuntime, tauriCommands } from '../../../lib/tauri'

/** A call error, with a way into the OS privacy settings when that is where the fix is. */
export function CallError({ message, className }: { message: string | null; className?: string }) {
  if (!message) return null
  const device = privacySettingsDevice(message)
  // Only the desktop app can open them, and only Windows and macOS have a page to open.
  const canOpen = device && isDesktopTauriRuntime() && /Windows|Macintosh/.test(navigator.userAgent)
  return <p role="alert" className={cn('flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 break-words text-destructive', className)}>
    <CircleAlertIcon aria-hidden className="mt-[0.2em] size-[1.1em] shrink-0" />
    <span className="min-w-0">{message}
    {canOpen ? <> <button type="button" className="rounded-sm font-medium underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-current" onClick={() => {
      tauriCommands.openPrivacySettings(device).catch(() => toast.error('Could not open the privacy settings.'))
    }}>Open privacy settings</button></> : null}</span>
  </p>
}
