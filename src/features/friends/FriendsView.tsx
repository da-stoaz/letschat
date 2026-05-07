import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  UserPlusIcon,
  UserCheckIcon,
  ShieldBanIcon,
  UserMinusIcon,
  MessageSquareIcon,
  XIcon,
} from 'lucide-react'
import { reducers, resolveIdentityFromUsername } from '../../lib/spacetimedb'
import { useFriendsStore } from '../../stores/friendsStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { usePresenceStore } from '../../stores/presenceStore'
import { useUserPresentation, AWAY_AFTER_MS, type UserPresenceStatus } from '../../hooks/useUserPresentation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { PresenceDot } from '@/components/user/PresenceDot'
import type { Friend, Identity } from '../../types/domain'

type Tab = 'online' | 'all' | 'pending' | 'blocked'
type PendingAction = 'accept' | 'decline' | 'remove' | 'cancel' | 'unblock'

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

const STATUS_RANK: Record<UserPresenceStatus, number> = {
  online: 0,
  away: 1,
  offline: 2,
}

function FriendRow({
  identity,
  trailing,
}: {
  identity: Identity
  trailing: React.ReactNode
}) {
  const presentation = useUserPresentation(identity)
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-border/60 hover:bg-background/60">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative shrink-0">
          <Avatar className="size-9 rounded-full">
            {presentation.avatarUrl ? <AvatarImage src={presentation.avatarUrl} alt={presentation.displayName} /> : null}
            <AvatarFallback className="rounded-full bg-secondary text-xs">
              {shortIdentity(identity).slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <PresenceDot
            status={presentation.status}
            className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card"
          />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{presentation.displayName}</p>
          <p className="truncate text-xs text-muted-foreground">@{presentation.username || shortIdentity(identity)}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>
    </div>
  )
}

function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-12 text-center">
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {hint ? <p className="text-xs text-muted-foreground/80">{hint}</p> : null}
    </div>
  )
}

export function FriendsView() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('online')
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pendingByIdentity, setPendingByIdentity] = useState<Record<string, PendingAction>>({})

  const selfIdentity = useConnectionStore((s) => s.identity)
  const friends = useFriendsStore((s) => s.friends)
  const blocked = useFriendsStore((s) => s.blocked)
  const onlineByIdentity = usePresenceStore((s) => s.onlineByIdentity)
  const lastActiveByIdentity = usePresenceStore((s) => s.lastActiveByIdentity)
  const nowMs = usePresenceStore((s) => s.nowMs)

  const getOtherIdentity = useCallback(
    (friend: Friend): Identity | null => {
      if (!selfIdentity) return null
      if (sameIdentity(friend.userA, selfIdentity)) return friend.userB
      if (sameIdentity(friend.userB, selfIdentity)) return friend.userA
      return null
    },
    [selfIdentity],
  )

  const statusFor = useCallback(
    (identity: Identity): UserPresenceStatus => {
      const key = normalizeIdentity(identity)
      if (!onlineByIdentity[key]) return 'offline'
      const lastActive = lastActiveByIdentity[key] ?? nowMs
      return nowMs - lastActive > AWAY_AFTER_MS ? 'away' : 'online'
    },
    [onlineByIdentity, lastActiveByIdentity, nowMs],
  )

  const setPending = (identity: string, action: PendingAction | null) => {
    setPendingByIdentity((prev) => {
      const next = { ...prev }
      if (action === null) delete next[normalizeIdentity(identity)]
      else next[normalizeIdentity(identity)] = action
      return next
    })
  }

  const acceptedFriends = useMemo(() => {
    const rows = friends
      .filter((f) => f.status === 'Accepted')
      .map((f) => ({ friend: f, identity: getOtherIdentity(f) }))
      .filter((row): row is { friend: Friend; identity: Identity } => row.identity !== null && !sameIdentity(row.identity, selfIdentity))
      .map((row) => ({ ...row, status: statusFor(row.identity) }))
    rows.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status])
    return rows
  }, [friends, selfIdentity, getOtherIdentity, statusFor])

  const onlineFriends = useMemo(() => acceptedFriends.filter((row) => row.status !== 'offline'), [acceptedFriends])

  const incomingPending = useMemo(
    () =>
      friends.filter(
        (f) => f.status === 'Pending' && !sameIdentity(f.requestedBy, selfIdentity),
      ),
    [friends, selfIdentity],
  )
  const outgoingPending = useMemo(
    () =>
      friends.filter(
        (f) => f.status === 'Pending' && sameIdentity(f.requestedBy, selfIdentity),
      ),
    [friends, selfIdentity],
  )

  const incomingCount = incomingPending.length
  const blockedCount = blocked.length

  const handleSendRequest = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!username.trim()) return
    setError(null)
    setSubmitting(true)
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
      setError(e instanceof Error ? e.message : 'Could not send friend request.')
    } finally {
      setSubmitting(false)
    }
  }

  const runAction = async (
    identity: string,
    action: PendingAction,
    fn: () => Promise<unknown>,
    fallbackMessage: string,
  ) => {
    setError(null)
    setPending(identity, action)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : fallbackMessage)
      setPending(identity, null)
    }
    // Leave the pending marker until the store removes the row, so the UI
    // shows the action in flight without flicker.
  }

  const acceptedTrailing = (identity: Identity) => {
    const action = pendingByIdentity[normalizeIdentity(identity)]
    return (
      <>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigate(`/app/dm/${identity}`)}
          disabled={action !== undefined}
        >
          <MessageSquareIcon className="size-4" />
          Message
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Remove friend"
          disabled={action !== undefined}
          onClick={() =>
            runAction(identity, 'remove', () => reducers.removeFriend(identity), 'Could not remove friend.')
          }
        >
          <UserMinusIcon className="size-4" />
        </Button>
      </>
    )
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card/60">
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="flex min-h-0 flex-1 flex-col">
        <header className="flex flex-col gap-3 border-b border-border/70 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold leading-tight">Friends</h2>
              <p className="text-xs text-muted-foreground">
                {acceptedFriends.length} total · {onlineFriends.length} online
              </p>
            </div>
            <TabsList>
              <TabsTrigger value="online">Online</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="pending" className="gap-1.5">
                Pending
                {incomingCount > 0 ? (
                  <Badge variant="default" className="h-4 min-w-4 px-1 text-[10px]">
                    {incomingCount}
                  </Badge>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="blocked" className="gap-1.5">
                Blocked
                {blockedCount > 0 ? (
                  <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px]">
                    {blockedCount}
                  </Badge>
                ) : null}
              </TabsTrigger>
            </TabsList>
          </div>

          <form className="flex items-center gap-2" onSubmit={handleSendRequest}>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Add friend by username"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="none"
              autoComplete="off"
              disabled={submitting}
            />
            <Button type="submit" disabled={submitting || !username.trim()}>
              <UserPlusIcon className="size-4" />
              {submitting ? 'Sending...' : 'Add'}
            </Button>
          </form>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <div className="px-3 py-3">
            <TabsContent value="online" className="mt-0 space-y-1 data-[state=inactive]:hidden">
              {onlineFriends.length === 0 ? (
                <EmptyState
                  title="No friends online right now"
                  hint="When friends come online, they'll show up here."
                />
              ) : (
                onlineFriends.map(({ identity }) => (
                  <FriendRow key={identity} identity={identity} trailing={acceptedTrailing(identity)} />
                ))
              )}
            </TabsContent>

            <TabsContent value="all" className="mt-0 space-y-1 data-[state=inactive]:hidden">
              {acceptedFriends.length === 0 ? (
                <EmptyState title="No friends yet" hint="Add someone by username above to get started." />
              ) : (
                acceptedFriends.map(({ identity }) => (
                  <FriendRow key={identity} identity={identity} trailing={acceptedTrailing(identity)} />
                ))
              )}
            </TabsContent>

            <TabsContent value="pending" className="mt-0 space-y-5 data-[state=inactive]:hidden">
              <section>
                <div className="mb-2 flex items-center gap-2 px-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Incoming</h3>
                  <span className="text-xs text-muted-foreground/70">{incomingPending.length}</span>
                </div>
                {incomingPending.length === 0 ? (
                  <p className="px-3 text-xs text-muted-foreground">No incoming requests.</p>
                ) : (
                  <div className="space-y-1">
                    {incomingPending.map((f) => {
                      const requester = f.requestedBy
                      const action = pendingByIdentity[normalizeIdentity(requester)]
                      return (
                        <FriendRow
                          key={`${f.userA}:${f.userB}:incoming`}
                          identity={requester}
                          trailing={
                            <>
                              <Button
                                size="sm"
                                disabled={action !== undefined}
                                onClick={() =>
                                  runAction(
                                    requester,
                                    'accept',
                                    () => reducers.acceptFriendRequest(requester),
                                    'Could not accept request.',
                                  )
                                }
                              >
                                <UserCheckIcon className="size-4" />
                                {action === 'accept' ? 'Accepting...' : 'Accept'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Decline"
                                disabled={action !== undefined}
                                onClick={() =>
                                  runAction(
                                    requester,
                                    'decline',
                                    () => reducers.declineFriendRequest(requester),
                                    'Could not decline request.',
                                  )
                                }
                              >
                                <XIcon className="size-4" />
                              </Button>
                            </>
                          }
                        />
                      )
                    })}
                  </div>
                )}
              </section>

              <section>
                <div className="mb-2 flex items-center gap-2 px-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outgoing</h3>
                  <span className="text-xs text-muted-foreground/70">{outgoingPending.length}</span>
                </div>
                {outgoingPending.length === 0 ? (
                  <p className="px-3 text-xs text-muted-foreground">No outgoing requests.</p>
                ) : (
                  <div className="space-y-1">
                    {outgoingPending.map((f) => {
                      const target = getOtherIdentity(f)
                      if (!target) return null
                      const action = pendingByIdentity[normalizeIdentity(target)]
                      return (
                        <FriendRow
                          key={`${f.userA}:${f.userB}:outgoing`}
                          identity={target}
                          trailing={
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={action !== undefined}
                              onClick={() =>
                                runAction(
                                  target,
                                  'cancel',
                                  () => reducers.declineFriendRequest(target),
                                  'Could not cancel request.',
                                )
                              }
                            >
                              {action === 'cancel' ? 'Cancelling...' : 'Cancel'}
                            </Button>
                          }
                        />
                      )
                    })}
                  </div>
                )}
              </section>
            </TabsContent>

            <TabsContent value="blocked" className="mt-0 space-y-1 data-[state=inactive]:hidden">
              {blocked.length === 0 ? (
                <EmptyState title="You haven't blocked anyone." />
              ) : (
                blocked.map((b) => {
                  const action = pendingByIdentity[normalizeIdentity(b.blocked)]
                  return (
                    <FriendRow
                      key={`${b.blocker}:${b.blocked}`}
                      identity={b.blocked}
                      trailing={
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={action !== undefined}
                          onClick={() =>
                            runAction(
                              b.blocked,
                              'unblock',
                              () => reducers.unblockUser(b.blocked),
                              'Could not unblock user.',
                            )
                          }
                        >
                          <ShieldBanIcon className="size-4" />
                          {action === 'unblock' ? 'Unblocking...' : 'Unblock'}
                        </Button>
                      }
                    />
                  )
                })
              )}
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </section>
  )
}
