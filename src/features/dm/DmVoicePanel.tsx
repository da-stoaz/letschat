import type { Identity } from '../../types/domain'
import { useActiveCall } from '../voice/hooks/useActiveCall'
import { CallPanel } from '../voice/components/CallPanel'

export function DmVoicePanel({ partnerIdentity }: { partnerIdentity: Identity }) {
  const call = useActiveCall()
  if (call.partnerIdentity?.toLowerCase() !== partnerIdentity.toLowerCase()) return null
  return <div className="h-[min(440px,calc(var(--app-height,100dvh)*0.45))] min-h-0"><CallPanel call={call} /></div>
}
