import { useEffect, useState } from 'react'
import { supportsMicrophoneCapture } from '../../../lib/livekit'

/**
 * Why this device can't use a camera, or null when it can. Follows plugging
 * and unplugging.
 *
 * Needs no camera permission: browsers list one unlabeled entry per kind of
 * device that exists. A runtime that hides every device until permission is
 * granted returns nothing at all, which counts as unknown rather than "no
 * camera", so a working camera is never locked out.
 */
export function useCameraUnavailableReason(): string | null {
  const supported = supportsMicrophoneCapture()
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    const mediaDevices = supported ? navigator.mediaDevices : undefined
    if (typeof mediaDevices?.enumerateDevices !== 'function') return
    let cancelled = false
    const check = () => {
      void mediaDevices.enumerateDevices().then((devices) => {
        if (!cancelled) setMissing(devices.length > 0 && !devices.some((device) => device.kind === 'videoinput'))
      }, () => undefined)
    }
    check()
    mediaDevices.addEventListener?.('devicechange', check)
    return () => {
      cancelled = true
      mediaDevices.removeEventListener?.('devicechange', check)
    }
  }, [supported])

  if (!supported) return 'Camera access isn’t supported here.'
  return missing ? 'No camera found. Connect one to use video.' : null
}
