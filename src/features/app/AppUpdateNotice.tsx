import { useEffect } from 'react'
import { isDesktopTauriRuntime } from '../../lib/tauri'
import { watchForAppUpdates } from '../../lib/appUpdates'

export function AppUpdateNotice() {
  useEffect(() => (isDesktopTauriRuntime() ? watchForAppUpdates() : undefined), [])
  return null
}
