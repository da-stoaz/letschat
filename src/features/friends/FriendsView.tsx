import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { UserPlusIcon, UserCheckIcon, ShieldBanIcon, UserMinusIcon } from 'lucide-react'
import { reducers, resolveIdentityFromUsername } from '../../lib/spacetimedb'
import { useFriendsStore } from '../../stores/friendsStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { useUserPresentation } from '../../hooks/useUserPresentation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { PresenceDot } from '@/components/user/PresenceDot'
import type { Friend, Identity } from '../../types/domain'

type Tab = 'all' | 'pending' | 'blocked'

function normalizeIdentity(identity: string): string {
  return identity.trim().toLowerCase()
}

function sameIdentity(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return normalizeIdentity(a) === normalizeIdentity(b)
}

function shortIdentity(identity: string): string {
  return identity.slice(0, 14)
}

function IdentityLabel({ identity, subtitle }: { identity: Identity; subtitle?: string }) {
  const presentation = useUserPresentation(identity)
  return (
    <div className="flex items-center gap-2">
      <Avatar className="size-8 rounded-lg">
        {presentation.avatarUrl ? <AvatarImage src={presentation.avatarUrl} alt={presentation.displayName} /> : null}
        <AvatarFallback className="rounded-lg bg-secondary text-xs">{shortIdentity(identity).slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div>
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium">{presentation.displayName}</p>
          <PresenceDot status={presentation.status} className="size-1.5" />
        </div>
        <p className="text-xs text-muted-foreground">@{presentation.username || shortIdentity(identity)}</p>
        {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
    </div>
  )
}

export function FriendsView() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('all')
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const selfIdentity = useConnectionStore((s) => s.identity)
  const friends = useFriendsStore((s) => s.friends)
  const blocked = useFriendsStore((s) => s.blocked)

  const getOtherIdentity = (friend: Friend): Identity | null => {
    if (!selfIdentity) return null
    if (sameIdentity(friend.userA, selfIdentity)) return friend.userB
    if (sameIdentity(friend.userB, selfIdentity)) return friend.userA
    return null
  }

  const pending = useMemo(() => friends.filter((f) => f.status === 'Pending'), [friends])
  const accepted = useMemo(() => friends.filter((f) => f.status === 'Accepted'), [friends])
  const incomingPending = useMemo(
    () => pending.filter((f) => !sameIdentity(f.requestedBy, selfIdentity)),
    [pending, selfIdentity],
  )
  const outgoingPending = useMemo(
    () => pending.filter((f) => sameIdentity(f.requestedBy, selfIdentity)),
    [pending, selfIdentity],
  )

  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-border/70 bg-card/60 p-3">
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="min-h-0 flex-1">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Friends</h2>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="blocked">Blocked</TabsTrigger>
          </TabsList>
        </div>

        <form
          className="mb-3 flex items-center gap-2"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!username.trim()) return
            setError(null)
            try {
              const targetIdentity = await resolveIdentityFromUsername(username)
              if (!targetIdentity) {
                setError(`No user found for username "${username}"`)
                return
              }
              if (sameIdentity(targetIdentity, selfIdentity)) {
                setError('You cannot add yourself as a friend.')
                return
              }
              await reducers.sendFriendRequest(targetIdentity)
              setUsername('')
            } catch (e) {
              const message = e instanceof Error ? e.message : 'Could not send friend request.'
              setError(message)
            }
          }}
        >
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Add friend by username"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="none"
            autoComplete="off"
          />
          <Button type="submit">
            <UserPlusIcon className="size-4" />
            Add
          </Button>
        </form>
        {error ? <p className="mb-2 text-sm text-destructive">{error}</p> : null}

        <ScrollArea className="min-h-0 flex-1">
          <TabsContent value="all" className="space-y-2">
            {accepted.map((f) => {
              const targetIdentity = getOtherIdentity(f)
              if (!targetIdentity || sameIdentity(targetIdentity, selfIdentity)) return null
              return (
                <Card key={`${f.userA}:${f.userB}`} className="border-border/70 bg-background/45 py-0">
                  <CardContent className="flex items-center justify-between gap-3">
                    <IdentityLabel identity={targetIdentity} subtitle="Friend" />
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" size="sm" onClick={() => navigate(`/app/dm/${targetIdentity}`)}>
                        Message
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          setError(null)
                          try {
                            await reducers.removeFriend(targetIdentity)
                          } catch (e) {
                            const message = e instanceof Error ? e.message : 'Could not remove friend.'
                            setError(message)
                          }
                        }}
                      >
                        <UserMinusIcon className="size-4" />
                        Remove
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </TabsContent>

          <TabsContent value="pending" className="space-y-4">
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Incoming</Badge>
              </div>
              {incomingPending.map((f) => {
                const requesterIdentity = f.requestedBy
                return (
                  <Card key={`${f.userA}:${f.userB}:incoming`} className="border-border/70 bg-background/45 py-0">
                    <CardContent className="flex items-center justify-between gap-3">
                      <IdentityLabel identity={requesterIdentity} />
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={async () => {
                            setError(null)
                            try {
                              await reducers.acceptFriendRequest(requesterIdentity)
                            } catch (e) {
                              const message = e instanceof Error ? e.message : 'Could not accept request.'
                              setError(message)
                            }
                          }}
                        >
                          <UserCheckIcon className="size-4" />
                          Accept
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            setError(null)
                            try {
                              await reducers.declineFriendRequest(requesterIdentity)
                            } catch (e) {
                              const message = e instanceof Error ? e.message : 'Could not decline request.'
                              setError(message)
                            }
                          }}
                        >
                          Decline
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </section>

            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Outgoing</Badge>
              </div>
              {outgoingPending.map((f) => {
                const targetIdentity = getOtherIdentity(f)
                if (!targetIdentity) return null
                return (
                  <Card key={`${f.userA}:${f.userB}:outgoing`} className="border-border/70 bg-background/45 py-0">
                    <CardContent className="flex items-center justify-between gap-3">
                      <IdentityLabel identity={targetIdentity} />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          setError(null)
                          try {
                            await reducers.declineFriendRequest(targetIdentity)
                          } catch (e) {
                            const message = e instanceof Error ? e.message : 'Could not cancel request.'
                            setError(message)
                          }
                        }}
                      >
                        Cancel
                      </Button>
                    </CardContent>
                  </Card>
                )
              })}
            </section>
          </TabsContent>

          <TabsContent value="blocked" className="space-y-2">
            {blocked.map((b) => (
              <Card key={`${b.blocker}:${b.blocked}`} className="border-border/70 bg-background/45 py-0">
                <CardContent className="flex items-center justify-between gap-3">
                  <IdentityLabel identity={b.blocked} />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      setError(null)
                      try {
                        await reducers.unblockUser(b.blocked)
                      } catch (e) {
                        const message = e instanceof Error ? e.message : 'Could not unblock user.'
                        setError(message)
                      }
                    }}
                  >
                    <ShieldBanIcon className="size-4" />
                    Unblock
                  </Button>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </section>
  )
}
