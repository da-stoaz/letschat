import { useParams } from 'react-router-dom'
import { DMView } from '../features/dm/DMView'
import { FriendsView } from '../features/friends/FriendsView'

export function DMPage() {
  const { identity } = useParams()

  if (!identity || identity === 'friends') {
    return <FriendsView />
  }

  return <DMView partnerIdentity={identity} />
}
