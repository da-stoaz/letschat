import { ArrowLeftIcon } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from './ui/button'
import { parentListPath } from '../layouts/app-layout/navigation'

export function CompactBack() {
  const navigate = useNavigate()
  const location = useLocation()
  return <Button variant="ghost" size="icon" className="md:hidden" aria-label="Back" onClick={() => navigate(parentListPath(location.pathname))}>
    <ArrowLeftIcon className="size-5" />
  </Button>
}
