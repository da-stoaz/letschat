import {
  CrownIcon,
  LogOutIcon,
  ServerIcon,
  Settings2Icon,
  Trash2Icon,
  UserPlusIcon,
} from 'lucide-react'
import { ServerAccessSettings, type ServerAccessSettingsProps } from './ServerAccessSettings'
import { formatMemberSince } from './helpers'
import { serverInitials } from '../../layouts/app-layout/helpers'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'

type ServerTabProps = ServerAccessSettingsProps & {
  onOpenEditServer: () => void
  onOpenDeleteServer: () => void
  onLeaveServer: () => void
}

export function ServerTab({
  server,
  isOwner,
  invitePolicySaving,
  discoverySaving,
  onOpenEditServer,
  onOpenDeleteServer,
  onLeaveServer,
  onUpdateInvitePolicy,
  onUpdateDiscovery,
  onUpdateTags,
}: ServerTabProps) {
  return (
    <ScrollArea className="h-full pr-2">
      {/* Container query: two columns only when the panel itself is wide
          enough — collapses to one column in windowed/small-laptop sizes
          regardless of the viewport width. */}
      <div className="@container">
        <div className="grid items-start gap-3 pb-1 @5xl:grid-cols-2">
        {/* ── Left column: identity + your relationship to the space ─── */}
        <div className="space-y-3">
          <Card className="border-border/70 bg-background/40">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ServerIcon className="size-4 text-muted-foreground" />
                Identity
              </CardTitle>
              <CardDescription>Branding shown to members and on Discover.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-start justify-between gap-3 py-1">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="size-14 shrink-0 rounded-xl">
                    {server.iconUrl ? <AvatarImage src={server.iconUrl} alt={server.name} /> : null}
                    <AvatarFallback className="rounded-xl bg-primary/10 text-sm">
                      {serverInitials(server.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-base font-semibold">{server.name}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {isOwner ? (
                        <Badge variant="secondary" className="gap-1">
                          <CrownIcon className="size-3" />
                          Owner
                        </Badge>
                      ) : (
                        <Badge variant="outline">Member</Badge>
                      )}
                      <Badge variant="outline">{server.iconUrl ? 'Custom icon' : 'Fallback icon'}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">Created {formatMemberSince(server.createdAt)}</p>
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" disabled={!isOwner} onClick={onOpenEditServer}>
                  <Settings2Icon className="size-4" />
                  Edit
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-background/40">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <UserPlusIcon className="size-4 text-muted-foreground" />
                Your membership
              </CardTitle>
              <CardDescription>Leave this space if you no longer want access.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start text-destructive hover:text-destructive"
                disabled={isOwner}
                onClick={onLeaveServer}
              >
                <LogOutIcon className="size-4" />
                Leave space
              </Button>
              <p className="text-xs text-muted-foreground">
                {isOwner
                  ? 'Owners cannot leave — transfer ownership first in the Members tab.'
                  : 'Leaving removes this space from your sidebar; you can only return with a valid invite.'}
              </p>
            </CardContent>
          </Card>

          <Card className="border-destructive/35 bg-destructive/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-destructive">
                <Trash2Icon className="size-4" />
                Danger zone
              </CardTitle>
              <CardDescription>Permanently delete this space and all its channels and messages.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button type="button" variant="destructive" className="w-full" disabled={!isOwner} onClick={onOpenDeleteServer}>
                <Trash2Icon className="size-4" />
                Delete space
              </Button>
              {!isOwner ? (
                <p className="text-xs text-muted-foreground">Only the owner can delete this space.</p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* ── Right column: access & discovery settings ─────────────── */}
        <div className="space-y-3">
          <ServerAccessSettings server={server} isOwner={isOwner} invitePolicySaving={invitePolicySaving} discoverySaving={discoverySaving}
            onUpdateInvitePolicy={onUpdateInvitePolicy} onUpdateDiscovery={onUpdateDiscovery} onUpdateTags={onUpdateTags} />
        </div>
        </div>
      </div>
    </ScrollArea>
  )
}
