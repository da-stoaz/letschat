import { useState } from 'react'
import {
  CompassIcon,
  CrownIcon,
  InfoIcon,
  LogOutIcon,
  Loader2Icon,
  ServerIcon,
  Settings2Icon,
  ShieldCheckIcon,
  Trash2Icon,
  UserPlusIcon,
  XIcon,
} from 'lucide-react'
import type { Server, ServerInvitePolicy } from '../../types/domain'
import { invitePolicyLabel, formatMemberSince } from './helpers'
import { serverInitials } from '../../layouts/app-layout/helpers'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const DESCRIPTION_MAX = 280
const MAX_TAGS = 5
const TAG_MAX_LEN = 24

type ServerTabProps = {
  server: Server
  isOwner: boolean
  leaving: boolean
  invitePolicySaving: boolean
  discoverySaving: boolean
  onOpenEditServer: () => void
  onOpenDeleteServer: () => void
  onLeaveServer: () => void
  onUpdateInvitePolicy: (policy: ServerInvitePolicy) => void
  onUpdateDiscovery: (isDiscoverable: boolean, description: string | null) => void
  onUpdateTags: (tags: string[]) => void
}

export function ServerTab({
  server,
  isOwner,
  leaving,
  invitePolicySaving,
  discoverySaving,
  onOpenEditServer,
  onOpenDeleteServer,
  onLeaveServer,
  onUpdateInvitePolicy,
  onUpdateDiscovery,
  onUpdateTags,
}: ServerTabProps) {
  // Discovery applies immediately. The toggle is optimistic-local (instant, and
  // a consistent source for the blur-commit below — reading the prop mid-save
  // could send a stale value). Description is the one free-text field, so it
  // commits on blur if changed rather than per keystroke.
  const [discoverable, setDiscoverable] = useState(server.isDiscoverable)
  const [description, setDescription] = useState(server.description ?? '')

  const commitDiscovery = (isDiscoverable: boolean, desc: string) =>
    onUpdateDiscovery(isDiscoverable, desc.trim().length > 0 ? desc.trim() : null)

  const toggleDiscoverable = (value: boolean) => {
    setDiscoverable(value)
    commitDiscovery(value, description)
  }

  const commitDescriptionIfChanged = () => {
    if (description.trim() !== (server.description ?? '').trim()) {
      commitDiscovery(discoverable, description)
    }
  }

  // Tags apply immediately on add/remove (optimistic-local, like the toggle).
  const [tags, setTags] = useState<string[]>(server.tags)
  const [tagDraft, setTagDraft] = useState('')

  const addTag = () => {
    const tag = tagDraft.trim().toLowerCase().slice(0, TAG_MAX_LEN)
    setTagDraft('')
    if (!tag || tags.includes(tag) || tags.length >= MAX_TAGS) return
    const next = [...tags, tag]
    setTags(next)
    onUpdateTags(next)
  }

  const removeTag = (tag: string) => {
    const next = tags.filter((t) => t !== tag)
    setTags(next)
    onUpdateTags(next)
  }

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
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 p-3.5">
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
                disabled={isOwner || leaving}
                onClick={onLeaveServer}
              >
                <LogOutIcon className="size-4" />
                {leaving ? 'Leaving…' : 'Leave space'}
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
          <Card className="border-border/70 bg-background/40">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheckIcon className="size-4 text-muted-foreground" />
                Access &amp; Discovery
              </CardTitle>
              <CardDescription>Who can find this space and how new members get in.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Invite permissions</p>
                  {invitePolicySaving ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2Icon className="size-3 animate-spin" />
                      Saving
                    </span>
                  ) : null}
                </div>
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
                  Applies to both invite links and direct in-app invites.
                </p>
              </section>

              <Separator />

              <section className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <CompassIcon className="mt-0.5 size-4 text-muted-foreground" />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium">List on Discover</p>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button type="button" className="text-muted-foreground/70 hover:text-foreground">
                                <InfoIcon className="size-3.5" />
                              </button>
                            }
                          />
                          <TooltipContent className="max-w-60">
                            {server.invitePolicy === 'Everyone'
                              ? 'With “Everyone” invites, people can join this space in one click from Discover.'
                              : 'Invites are moderator-only, so people who find this space on Discover can request to join — a moderator approves each request.'}
                          </TooltipContent>
                        </Tooltip>
                        {discoverySaving ? <Loader2Icon className="size-3 animate-spin text-muted-foreground" /> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Let non-members find this space from Discover.
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={discoverable}
                    onCheckedChange={toggleDiscoverable}
                    disabled={!isOwner || discoverySaving}
                    aria-label="List on Discover"
                  />
                </div>

                <div className="space-y-1.5">
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
                    onBlur={commitDescriptionIfChanged}
                    placeholder="Briefly describe this space — shown on its Discover card."
                    rows={3}
                    maxLength={DESCRIPTION_MAX}
                    disabled={!isOwner || discoverySaving}
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-muted-foreground">
                      {isOwner ? 'Saved when you click away.' : 'Only the owner can edit this.'}
                    </p>
                    <p className="text-[11px] tabular-nums text-muted-foreground">
                      {description.length}/{DESCRIPTION_MAX}
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                        {tag}
                        {isOwner ? (
                          <button
                            type="button"
                            onClick={() => removeTag(tag)}
                            disabled={discoverySaving}
                            className="rounded-full text-muted-foreground hover:text-foreground"
                            aria-label={`Remove ${tag}`}
                          >
                            <XIcon className="size-3" />
                          </button>
                        ) : null}
                      </Badge>
                    ))}
                    {tags.length === 0 ? (
                      <span className="text-[11px] text-muted-foreground">No tags yet.</span>
                    ) : null}
                  </div>
                  {isOwner && tags.length < MAX_TAGS ? (
                    <Input
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value.slice(0, TAG_MAX_LEN))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault()
                          addTag()
                        }
                      }}
                      onBlur={addTag}
                      placeholder="Add a tag, then press Enter"
                      disabled={discoverySaving}
                      className="h-8 text-sm"
                    />
                  ) : null}
                  <p className="text-[11px] text-muted-foreground">
                    Up to {MAX_TAGS} topic tags help people find this space on Discover.
                  </p>
                </div>
              </section>
            </CardContent>
          </Card>
        </div>
        </div>
      </div>
    </ScrollArea>
  )
}
