import { useMemo, useState } from 'react'
import { CheckIcon, InboxIcon, XIcon } from 'lucide-react'
import { reducers } from '../../lib/spacetimedb'
import type { JoinRequestWithUser } from '../../stores/joinRequestStore'
import { userInitials } from '../../layouts/app-layout/helpers'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { formatMemberSince, matchesSearch } from './helpers'
import { ListSearchInput } from './ListSearchInput'

function requestLabel(request: JoinRequestWithUser): string {
  return request.user?.displayName || request.user?.username || request.userIdentity.slice(0, 10)
}

function requestUsername(request: JoinRequestWithUser): string {
  return request.user?.username || request.userIdentity.slice(0, 12)
}

type RequestsTabProps = {
  serverId: number
  joinRequests: JoinRequestWithUser[]
}

export function RequestsTab({ serverId, joinRequests }: RequestsTabProps) {
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<'newest' | 'oldest'>('newest')
  const [busyId, setBusyId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const list = joinRequests.filter((req) => matchesSearch(query, requestLabel(req), requestUsername(req)))
    return [...list].sort((a, b) =>
      sortBy === 'newest' ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt),
    )
  }, [joinRequests, query, sortBy])

  const resolve = async (userIdentity: string, action: () => Promise<void>, failMessage: string) => {
    setBusyId(userIdentity)
    try {
      await action()
    } catch (error) {
      toast.error(failMessage, { description: error instanceof Error ? error.message : failMessage })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card className="flex h-full min-h-0 flex-col border-border/70 bg-background/40">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Requests</CardTitle>
          <CardDescription>People asking to join this space.</CardDescription>
        </div>
        <Badge variant="secondary">{joinRequests.length}</Badge>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 pt-0">
        {joinRequests.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-45 flex-1">
              <ListSearchInput value={query} onChange={setQuery} placeholder="Search by name or @username…" />
            </div>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="h-9 w-37.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Sort: Newest</SelectItem>
                <SelectItem value="oldest">Sort: Oldest</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <ScrollArea className="h-full pr-2">
          {joinRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <InboxIcon className="size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No pending requests</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                When someone asks to join from Discover, they&rsquo;ll appear here for you to approve or decline.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No requests match &ldquo;{query}&rdquo;.</p>
          ) : (
            <ul className="space-y-2">
              {filtered.map((req) => {
                const label = requestLabel(req)
                const busy = busyId === req.userIdentity
                return (
                  <li
                    key={req.userIdentity}
                    className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/20 p-2.5"
                  >
                    <Avatar className="size-9 shrink-0 rounded-full">
                      {req.user?.avatarUrl ? <AvatarImage src={req.user.avatarUrl} alt={label} /> : null}
                      <AvatarFallback className="rounded-full bg-primary/10 text-[11px]">
                        {userInitials(label)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{label}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        @{requestUsername(req)} · requested {formatMemberSince(req.createdAt)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void resolve(
                          req.userIdentity,
                          async () => {
                            await reducers.approveJoinRequest(serverId, req.userIdentity)
                            toast.success(`${label} joined the space`)
                          },
                          'Could not approve the request.',
                        )
                      }
                    >
                      <CheckIcon className="size-4" />
                      Approve
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      disabled={busy}
                      onClick={() =>
                        void resolve(
                          req.userIdentity,
                          () => reducers.declineJoinRequest(serverId, req.userIdentity),
                          'Could not decline the request.',
                        )
                      }
                    >
                      <XIcon className="size-4" />
                      Decline
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
