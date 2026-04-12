import { LogOutIcon, Settings2Icon, Trash2Icon } from 'lucide-react'
import type { Server, ServerInvitePolicy } from '../../types/domain'
import { invitePolicyLabel, formatMemberSince } from './helpers'
import { serverInitials } from '../../layouts/app-layout/helpers'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card className="border-border/70 bg-background/40">
        <CardHeader>
          <CardTitle className="text-base">Server Settings</CardTitle>
          <CardDescription>Manage branding and invitation permissions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-xl border border-border/70 bg-muted/20 p-3.5">
            <p className="text-sm font-medium">Server Profile</p>
            <p className="text-xs text-muted-foreground">Icon and name shown across rails, headers, and invites.</p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="size-12 rounded-xl">
                  {server.iconUrl ? <AvatarImage src={server.iconUrl} alt={server.name} /> : null}
                  <AvatarFallback className="rounded-xl bg-primary/10 text-sm">{serverInitials(server.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{server.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {server.iconUrl ? 'Custom icon enabled' : 'Using initials as fallback icon'}
                  </p>
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" disabled={!isOwner} onClick={onOpenEditServer}>
                <Settings2Icon className="size-4" />
                Edit Name/Icon
              </Button>
            </div>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-3.5">
            <p className="text-sm font-medium">Created</p>
            <p className="text-sm text-muted-foreground">{formatMemberSince(server.createdAt)}</p>
          </div>
          <div className="space-y-1.5 rounded-xl border border-border/70 bg-muted/20 p-3.5">
            <p className="text-sm font-medium">Who can invite users</p>
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
            <p className="text-xs text-muted-foreground">
              {isOwner
                ? 'This controls invite links and direct in-app invites.'
                : 'Only the owner can change invite permissions.'}
            </p>
          </div>
          <div className="rounded-xl border border-destructive/35 bg-destructive/5 p-3.5">
            <p className="text-sm font-medium text-destructive">Danger Zone</p>
            <p className="mb-2 text-xs text-muted-foreground">Delete the entire server and all channels/messages.</p>
            <Button type="button" variant="destructive" disabled={!isOwner} onClick={onOpenDeleteServer}>
              <Trash2Icon className="size-4" />
              Delete Server
            </Button>
          </div>
          {!isOwner ? (
            <p className="text-xs text-muted-foreground">Only the server owner can edit branding or delete the server.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-background/40">
        <CardHeader>
          <CardTitle className="text-base">Membership</CardTitle>
          <CardDescription>Leave this server or transfer ownership first.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button type="button" variant="destructive" disabled={isOwner || leaving} onClick={onLeaveServer}>
            <LogOutIcon className="size-4" />
            {leaving ? 'Leaving...' : 'Leave Server'}
          </Button>
          {isOwner ? (
            <p className="text-xs text-muted-foreground">Owners must transfer ownership in the Members tab before leaving.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
