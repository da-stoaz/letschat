import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CompassIcon, LockIcon, UsersIcon } from 'lucide-react'
import { reducers } from '../lib/spacetimedb'
import { useDiscoverStore } from '../stores/discoverStore'
import { serverInitials } from '../layouts/app-layout/helpers'
import type { DiscoverServer } from '../types/domain'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from '@/components/ui/sonner'

function formatMemberCount(count: number): string {
  if (count === 1) return '1 member'
  return `${count} members`
}

function DiscoverCard({ server, onJoined }: { server: DiscoverServer; onJoined: (id: number) => void }) {
  const [joining, setJoining] = useState(false)
  const canJoin = server.invitePolicy === 'Everyone'

  const join = async () => {
    if (!canJoin || joining) return
    setJoining(true)
    try {
      await reducers.joinDiscoverableServer(server.id)
      toast.success(`Joined ${server.name}`)
      onJoined(server.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not join this space.'
      toast.error('Failed to join', { description: message })
      setJoining(false)
    }
  }

  return (
    <Card className="flex flex-col border-border/70 bg-background/40">
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <Avatar className="size-12 rounded-xl">
            {server.iconUrl ? <AvatarImage src={server.iconUrl} alt={server.name} /> : null}
            <AvatarFallback className="rounded-xl bg-primary/10 text-sm">
              {serverInitials(server.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate font-semibold leading-tight">{server.name}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="gap-1 text-[11px]">
                <UsersIcon className="size-3" />
                {formatMemberCount(server.memberCount)}
              </Badge>
              {server.invitePolicy === 'Everyone' ? (
                <Badge variant="secondary" className="text-[11px]">Open to all</Badge>
              ) : (
                <Badge variant="outline" className="gap-1 text-[11px]">
                  <LockIcon className="size-3" />
                  Invite only
                </Badge>
              )}
            </div>
          </div>
        </div>

        <p className="line-clamp-3 min-h-[3.75rem] text-sm text-muted-foreground">
          {server.description?.trim() || 'No description provided.'}
        </p>

        {canJoin ? (
          <Button type="button" className="mt-auto w-full" disabled={joining} onClick={() => void join()}>
            {joining ? 'Joining…' : 'Join'}
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button type="button" variant="outline" className="mt-auto w-full" disabled>
                  Invite only
                </Button>
              }
            />
            <TooltipContent>Ask a moderator to invite you.</TooltipContent>
          </Tooltip>
        )}
      </CardContent>
    </Card>
  )
}

export function DiscoverPage() {
  const navigate = useNavigate()
  const servers = useDiscoverStore((s) => s.servers)

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
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {servers.map((server) => (
                <DiscoverCard key={server.id} server={server} onJoined={onJoined} />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
