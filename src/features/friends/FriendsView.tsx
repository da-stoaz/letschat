import { useMemo, useState } from 'react'
import { UserPlusIcon, UserCheckIcon, ShieldBanIcon, UserMinusIcon } from 'lucide-react'
import { reducers, resolveIdentityFromUsername } from '../../lib/spacetimedb'
import { useFriendsStore } from '../../stores/friendsStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'

type Tab = 'all' | 'pending' | 'blocked'

export function FriendsView() {
  const [tab, setTab] = useState<Tab>('all')
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const selfIdentity = useConnectionStore((s) => s.identity)
  const friends = useFriendsStore((s) => s.friends)
  const blocked = useFriendsStore((s) => s.blocked)

  const pending = useMemo(() => friends.filter((f) => f.status === 'Pending'), [friends])
  const accepted = useMemo(() => friends.filter((f) => f.status === 'Accepted'), [friends])
  const incomingPending = useMemo(() => pending.filter((f) => f.requestedBy !== selfIdentity), [pending, selfIdentity])
  const outgoingPending = useMemo(() => pending.filter((f) => f.requestedBy === selfIdentity), [pending, selfIdentity])

  const otherIdentity = (a: string, b: string) => (a === selfIdentity ? b : a)

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
            const targetIdentity = await resolveIdentityFromUsername(username)
            if (!targetIdentity) {
              setError(`No user found for username "${username}"`)
              return
            }
            await reducers.sendFriendRequest(targetIdentity)
            setUsername('')
          }}
        >
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Add friend by username" />
          <Button type="submit">
            <UserPlusIcon className="size-4" />
            Add
          </Button>
        </form>
        {error ? <p className="mb-2 text-sm text-destructive">{error}</p> : null}

        <ScrollArea className="min-h-0 flex-1">
          <TabsContent value="all" className="space-y-2">
            {accepted.map((f) => {
              const targetIdentity = otherIdentity(f.userA, f.userB)
              return (
                <Card key={`${f.userA}:${f.userB}`} className="border-border/70 bg-background/45 py-0">
                  <CardContent className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{targetIdentity.slice(0, 14)}</p>
                      <p className="text-xs text-muted-foreground">Friend</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => reducers.removeFriend(targetIdentity)}>
                      <UserMinusIcon className="size-4" />
                      Remove
                    </Button>
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
                      <span className="text-sm">{requesterIdentity.slice(0, 14)}</span>
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => reducers.acceptFriendRequest(requesterIdentity)}>
                          <UserCheckIcon className="size-4" />
                          Accept
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => reducers.declineFriendRequest(requesterIdentity)}>
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
                const requesterIdentity = f.requestedBy
                return (
                  <Card key={`${f.userA}:${f.userB}:outgoing`} className="border-border/70 bg-background/45 py-0">
                    <CardContent className="flex items-center justify-between gap-3">
                      <span className="text-sm">{otherIdentity(f.userA, f.userB).slice(0, 14)}</span>
                      <Button variant="outline" size="sm" onClick={() => reducers.declineFriendRequest(requesterIdentity)}>
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
                  <span className="text-sm">{b.blocked.slice(0, 14)}</span>
                  <Button variant="outline" size="sm" onClick={() => reducers.unblockUser(b.blocked)}>
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
