import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckIcon, CompassIcon, EyeOffIcon, UsersIcon, XCircleIcon } from 'lucide-react'
import { reducers } from '../lib/spacetimedb'
import { cn } from '../lib/utils'
import { useDiscoverStore } from '../stores/discoverStore'
import { useJoinRequestStore } from '../stores/joinRequestStore'
import { useSelfStore } from '../stores/selfStore'
import { matchesSearch } from '../features/server-manage/helpers'
import { ListSearchInput } from '../features/server-manage/ListSearchInput'
import { serverInitials } from '../layouts/app-layout/helpers'
import type { DiscoverServer, JoinRequestStatus } from '../types/domain'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from 'sonner'

function formatMemberCount(count: number): string {
  return `${count} ${count === 1 ? 'member' : 'members'}`
}

function TagPill({ tag, active, onClick }: { tag: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
        active
          ? 'border-primary/60 bg-primary/10 text-primary'
          : 'border-border/60 text-muted-foreground hover:border-border hover:text-foreground',
      )}
    >
      {tag}
    </button>
  )
}

function DiscoverCard({
  server,
  status,
  selectedTags,
  isAdmin,
  onToggleTag,
  onJoined,
}: {
  server: DiscoverServer
  status: JoinRequestStatus | undefined
  selectedTags: string[]
  isAdmin: boolean
  onToggleTag: (tag: string) => void
  onJoined: (id: number) => void
}) {
  const [busy, setBusy] = useState(false)
  const directJoin = server.invitePolicy === 'Everyone'
  const description = server.description?.trim()

  const run = async (action: () => Promise<void>, failMessage: string) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } catch (error) {
      const message = error instanceof Error ? error.message : failMessage
      toast.error(failMessage, { description: message })
    } finally {
      setBusy(false)
    }
  }

  const join = () =>
    run(async () => {
      await reducers.joinDiscoverableServer(server.id)
      toast.success(`Joined ${server.name}`)
      onJoined(server.id)
    }, 'Could not join this space.')

  const request = () =>
    run(async () => {
      await reducers.requestToJoin(server.id)
      toast.success('Request sent', { description: 'A moderator will review your request to join.' })
    }, 'Could not send your request.')

  const cancel = () =>
    run(async () => {
      await reducers.cancelJoinRequest(server.id)
    }, 'Could not cancel your request.')

  const adminUnlist = () =>
    run(async () => {
      await reducers.adminUnlistServer(server.id)
      toast.success(`Removed ${server.name} from Discover`)
    }, 'Could not remove this space from Discover.')

  return (
    <Card className="flex flex-col border-border/70 bg-background/40 transition-colors hover:border-border">
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <Avatar className="size-11 shrink-0 rounded-xl">
            {server.iconUrl ? <AvatarImage src={server.iconUrl} alt={server.name} /> : null}
            <AvatarFallback className="rounded-xl bg-primary/10 text-sm">
              {serverInitials(server.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-semibold leading-tight">{server.name}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <UsersIcon className="size-3" />
              {formatMemberCount(server.memberCount)}
            </p>
          </div>
        </div>

        <p
          className={`line-clamp-2 text-sm ${
            description ? 'text-muted-foreground' : 'text-muted-foreground/55 italic'
          }`}
        >
          {description || 'No description yet.'}
        </p>

        {server.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {server.tags.map((tag) => (
              <TagPill key={tag} tag={tag} active={selectedTags.includes(tag)} onClick={() => onToggleTag(tag)} />
            ))}
          </div>
        ) : null}

        <div className="mt-auto pt-1">
          {directJoin ? (
            <Button type="button" className="w-full" disabled={busy} onClick={() => void join()}>
              {busy ? 'Joining…' : 'Join'}
            </Button>
          ) : status === 'pending' ? (
            <div className="flex items-center gap-2">
              <span className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-border/60 bg-muted/20 text-xs font-medium text-muted-foreground">
                <CheckIcon className="size-3.5 text-emerald-500" />
                Request pending
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={busy}
                onClick={() => void cancel()}
              >
                Cancel
              </Button>
            </div>
          ) : status === 'declined' ? (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <XCircleIcon className="size-3.5 text-destructive/80" />
                A moderator declined your request.
              </p>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                disabled={busy}
                onClick={() => void request()}
              >
                {busy ? 'Requesting…' : 'Request again'}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              disabled={busy}
              onClick={() => void request()}
            >
              {busy ? 'Requesting…' : 'Request to join'}
            </Button>
          )}
        </div>

        {isAdmin ? (
          <button
            type="button"
            onClick={() => void adminUnlist()}
            disabled={busy}
            className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-destructive"
            title="Instance-admin moderation: remove this space from Discover"
          >
            <EyeOffIcon className="size-3" />
            Remove from Discover
          </button>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function DiscoverPage() {
  const navigate = useNavigate()
  const servers = useDiscoverStore((s) => s.servers)
  const myStatusByServer = useJoinRequestStore((s) => s.myStatusByServer)
  const isAdmin = useSelfStore((s) => s.user?.isAdmin ?? false)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [search, setSearch] = useState('')

  const toggleTag = (tag: string) =>
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))

  const availableTags = [...new Set(servers.flatMap((s) => s.tags))].sort()
  const filteredServers = servers.filter((s) => {
    const matchesTags = selectedTags.length === 0 || s.tags.some((t) => selectedTags.includes(t))
    const matchesQuery =
      search.trim().length === 0 || matchesSearch(search, s.name, s.description ?? '', ...s.tags)
    return matchesTags && matchesQuery
  })

  const onJoined = (serverId: number) => {
    // The membership sync removes this space from Discover; jump into it.
    navigate(`/app/${serverId}`)
  }

  return (
    <Card className="h-full border-border/70 bg-card/70">
      <CardContent className="h-full overflow-auto p-4">
        <div className="mx-auto w-full max-w-5xl space-y-5">
          <header className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
              <CompassIcon className="size-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Discover Spaces</h1>
              <p className="text-sm text-muted-foreground">
                Public spaces on this instance you can browse and join.
              </p>
            </div>
          </header>

          {servers.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/10 px-6 py-16 text-center">
              <CompassIcon className="size-8 text-muted-foreground/60" />
              <p className="text-sm font-medium">Nothing to discover yet</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                No public spaces are listed right now. A space owner can list theirs from its
                management screen.
              </p>
            </div>
          ) : (
            <>
              <ListSearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search spaces by name, description, or tag…"
              />

              {availableTags.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-0.5 text-xs text-muted-foreground">Tags:</span>
                  {availableTags.map((tag) => (
                    <TagPill key={tag} tag={tag} active={selectedTags.includes(tag)} onClick={() => toggleTag(tag)} />
                  ))}
                  {selectedTags.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setSelectedTags([])}
                      className="ml-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              ) : null}

              {filteredServers.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No spaces match your search.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredServers.map((server) => (
                    <DiscoverCard
                      key={server.id}
                      server={server}
                      status={myStatusByServer[server.id]}
                      selectedTags={selectedTags}
                      isAdmin={isAdmin}
                      onToggleTag={toggleTag}
                      onJoined={onJoined}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
