import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { privacySettingsDevice } from '../../../lib/livekit'
import { isDesktopTauriRuntime, tauriCommands } from '../../../lib/tauri'

/** A call error, with a way into the OS privacy settings when that is where the fix is. */
export function CallError({ message, className }: { message: string | null; className?: string }) {
  if (!message) return null
  const device = privacySettingsDevice(message)
  // Only the desktop app can open them, and only Windows and macOS have a page to open.
  const canOpen = device && isDesktopTauriRuntime() && /Windows|Macintosh/.test(navigator.userAgent)
  return <p role="alert" className={cn('break-words text-destructive', className)}>
    {message}
    {canOpen ? <> <button type="button" className="rounded-sm font-medium underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-current" onClick={() => {
      tauriCommands.openPrivacySettings(device).catch(() => toast.error('Could not open the privacy settings.'))
    }}>Open privacy settings</button></> : null}
  </p>
}
