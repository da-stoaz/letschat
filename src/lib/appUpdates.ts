import { toast } from 'sonner'
import { gt, rsort, valid } from 'semver'
import { CLIENT_VERSION } from './clientCompatibility'
import { fetchWellKnown } from './discovery'
import { tauriCommands } from './tauri'
import { useServerConfigStore, type ServerConfig } from '../stores/serverConfigStore'

const RECHECK_MS = 6 * 60 * 60 * 1000 // the app lives in the tray for days
const TOAST_ID = 'app-update' // one toast, even when StrictMode or a recheck finds it again
const hostsKey = (hosts: ServerConfig[]) => hosts.map(host => host.authServiceUrl).join('\n')

/**
 * The newest app version any saved server recommends. A server recommends the
 * app released with it (or the operator's RECOMMENDED_CLIENT_VERSION), so the app
 * never runs ahead of every backend it uses. Servers that are unreachable or
 * publish no valid version have no say.
 */
export async function recommendedAppVersion(hosts: ServerConfig[]): Promise<string | null> {
  const documents = await Promise.all(hosts.map(host =>
    fetchWellKnown(host.discoveryUrl ?? host.authServiceUrl).catch(() => null)))
  const versions = documents.flatMap(document =>
    typeof document?.recommendedClient === 'string' ? valid(document.recommendedClient) ?? [] : [])
  return rsort(versions)[0] ?? null
}

/**
 * Offers the signed desktop release that the saved servers recommend. Installing
 * waits for the user: it restarts the app and would end a running call.
 */
export function watchForAppUpdates(): () => void {
  let cancelled = false
  const look = async () => {
    const target = await recommendedAppVersion(useServerConfigStore.getState().knownHosts)
    if (!target || !gt(target, CLIENT_VERSION)) return
    // Offline, or that release is unpublished or has no update for this platform: the next check retries.
    const version = await tauriCommands.checkAppUpdate(target).catch(() => null)
    if (!version || cancelled) return
    toast(`LetsChat ${version} is available`, {
      id: TOAST_ID,
      duration: Infinity,
      action: {
        label: 'Restart to update',
        onClick: () => {
          toast.loading(`Installing LetsChat ${version}…`, { id: TOAST_ID, duration: Infinity })
          tauriCommands.installAppUpdate().catch(() => {
            toast.error('The update could not be installed', {
              id: TOAST_ID,
              duration: Infinity,
              action: {
                label: 'Download',
                onClick: () => void tauriCommands.openUrl(`https://github.com/da-stoaz/letschat/releases/tag/v${version}`),
              },
            })
          })
        },
      },
    })
  }
  void look()
  const timer = setInterval(() => void look(), RECHECK_MS)
  // Saving or switching servers: the new one may recommend a newer app.
  const unsubscribe = useServerConfigStore.subscribe((state, previous) => {
    if (hostsKey(state.knownHosts) !== hostsKey(previous.knownHosts)) void look()
  })
  return () => { cancelled = true; clearInterval(timer); unsubscribe() }
}
