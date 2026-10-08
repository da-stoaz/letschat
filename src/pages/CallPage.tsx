import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeftIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useActiveCall } from '../features/voice/hooks/useActiveCall'
import { callReturnPath } from '../features/voice/callNavigation'
import { CallPanel } from '../features/voice/components/CallPanel'

export function CallPage() {
  const call = useActiveCall()
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = callReturnPath(location.state?.returnTo, call.returnPath)
  if (!call.active) return <div className="flex h-full flex-col items-center justify-center gap-4 p-4">
    <p>{call.error ?? 'No active call'}</p><Button variant="outline" onClick={() => navigate(returnTo, { replace: true })}><ArrowLeftIcon />Back</Button>
  </div>
  return <CallPanel call={call} onBack={() => navigate(returnTo)} />
}
