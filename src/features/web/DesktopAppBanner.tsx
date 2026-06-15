import { useState } from 'react'
import { MonitorDownIcon, XIcon } from 'lucide-react'
import { isHostedWebBuild } from '../../lib/tauri'
import { normalizeServerUrl } from '../../lib/discovery'
import { Button } from '@/components/ui/button'

const DISMISS_KEY = 'letschat.web.desktopBannerDismissed'

/** Maps the current browser to the platform slug the `/downloads/{os}` resolver accepts. */
function detectOs(): 'macos' | 'windows' | 'linux' {
  const ua = (navigator.userAgent || '').toLowerCase()
  if (ua.includes('mac')) return 'macos'
  if (ua.includes('win')) return 'windows'
  return 'linux'
}

/** The connect URL baked into a hosted-web build; the downloads resolver lives there. */
const WEB_CONNECT_URL = (import.meta.env.VITE_WEB_CONNECT_URL as string | undefined)?.trim() || undefined

/**
 * Dismissable "also available as a desktop app" banner. Renders only on the
 * hosted browser build (never in the Tauri desktop shell — you're already there)
 * and links to this instance's `/downloads/{os}` installer resolver. Dismissal is
 * persisted in localStorage so it stays gone for that browser.
 */
export function DesktopAppBanner() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')

  if (!isHostedWebBuild() || !WEB_CONNECT_URL || dismissed) return null

  const downloadUrl = `${normalizeServerUrl(WEB_CONNECT_URL)}/downloads/${detectOs()}`

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  return (
    <div className="flex items-center gap-3 border-b border-border/60 bg-card/80 px-4 py-2 text-sm text-foreground/80 backdrop-blur-sm">
      <MonitorDownIcon className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        LetsChat is also available as a desktop app —{' '}
        <a
          href={downloadUrl}
          className="font-medium text-primary underline-offset-2 hover:underline"
          rel="noreferrer"
        >
          download it here
        </a>
        .
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
        title="Dismiss"
        aria-label="Dismiss desktop app banner"
        onClick={dismiss}
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  )
}
