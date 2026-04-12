import { CrownIcon, LogOutIcon, ServerIcon, Settings2Icon, ShieldCheckIcon, Trash2Icon, UserPlusIcon } from 'lucide-react'
import type { Server, ServerInvitePolicy } from '../../types/domain'
import { invitePolicyLabel, formatMemberSince } from './helpers'
import { serverInitials } from '../../layouts/app-layout/helpers'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type ServerTabProps = {
  server: Server
  isOwner: boolean
  leaving: boolean
  invitePolicySaving: boolean
  onOpenEditServer: () => void
  onOpenDeleteServer: () => void
  onLeaveServer: () => void
  onUpdateInvitePolicy: (policy: ServerInvitePolicy) => void
}

export function ServerTab({
  server,
  isOwner,
  leaving,
  invitePolicySaving,
  onOpenEditServer,
  onOpenDeleteServer,
  onLeaveServer,
  onUpdateInvitePolicy,
}: ServerTabProps) {
  const invitePolicyDescription = isOwner
    ? 'This controls both invite links and direct in-app invites.'
    : 'Only the owner can change invite permissions.'

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card className="border-border/70 bg-background/40">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ServerIcon className="size-4 text-muted-foreground" />
            Server Identity & Access
          </CardTitle>
          <CardDescription>Everything related to branding and who can bring new members in.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <section className="rounded-xl border border-border/70 bg-muted/20 p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="size-14 rounded-xl">
                  {server.iconUrl ? <AvatarImage src={server.iconUrl} alt={server.name} /> : null}
                  <AvatarFallback className="rounded-xl bg-primary/10 text-sm">
                    {serverInitials(server.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-base font-semibold">{server.name}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{server.iconUrl ? 'Custom icon' : 'Fallback icon'}</Badge>
                    {isOwner ? (
                      <Badge variant="secondary">
                        <CrownIcon className="size-3" />
                        Owner permissions
                      </Badge>
                    ) : (
                      <Badge variant="outline">Read-only settings</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Created {formatMemberSince(server.createdAt)}</p>
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" disabled={!isOwner} onClick={onOpenEditServer}>
                <Settings2Icon className="size-4" />
                Edit Name/Icon
              </Button>
            </div>
          </section>

          <Separator />

          <section className="space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3.5">
            <div className="flex items-center gap-2">
              <ShieldCheckIcon className="size-4 text-muted-foreground" />
              <p className="text-sm font-medium">Invite Permissions</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Decide who can invite new members. Current policy: <span className="font-medium">{invitePolicyLabel(server.invitePolicy)}</span>
            </p>
            <Select
              value={server.invitePolicy}
              onValueChange={(value) => onUpdateInvitePolicy(value as ServerInvitePolicy)}
              disabled={!isOwner || invitePolicySaving}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{invitePolicyLabel(server.invitePolicy)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ModeratorsOnly">Owner + Moderators</SelectItem>
                <SelectItem value="Everyone">Everyone (all members)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{invitePolicyDescription}</p>
          </section>

          {!isOwner ? (
            <p className="text-xs text-muted-foreground">
              You can review settings here, but only the owner can change branding, invite permissions, or delete this server.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <Card className="border-border/70 bg-background/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your Membership</CardTitle>
            <CardDescription>Leave this server if you no longer want access.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-xl border border-border/70 bg-muted/20 p-3.5">
              <div className="flex items-center gap-2">
                <UserPlusIcon className="size-4 text-muted-foreground" />
                <p className="text-sm font-medium">Exit Server</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Leaving removes this server from your sidebar. You can only return with a valid invite.
              </p>
              <Button type="button" variant="destructive" className="mt-3" disabled={isOwner || leaving} onClick={onLeaveServer}>
                <LogOutIcon className="size-4" />
                {leaving ? 'Leaving...' : 'Leave Server'}
              </Button>
            </div>
            {isOwner ? (
              <p className="text-xs text-muted-foreground">
                Owners cannot leave. Transfer ownership first in the Members tab.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-destructive/35 bg-destructive/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <Trash2Icon className="size-4" />
              Danger Zone
            </CardTitle>
            <CardDescription>Permanently delete the server and all associated channels/messages.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="destructive" disabled={!isOwner} onClick={onOpenDeleteServer}>
              <Trash2Icon className="size-4" />
              Delete Server
            </Button>
            {!isOwner ? (
              <p className="mt-2 text-xs text-muted-foreground">Only the owner can delete this server.</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
