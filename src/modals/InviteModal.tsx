import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { reducers } from '../lib/spacetimedb'
import { useInvitesStore } from '../stores/invitesStore'
import { useServersStore } from '../stores/serversStore'
import { useMembersStore } from '../stores/membersStore'
import { useFriendsStore } from '../stores/friendsStore'
import { useUsersStore } from '../stores/usersStore'
import { useConnectionStore } from '../stores/connectionStore'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  CopyIcon,
  CheckIcon,
  QrCodeIcon,
  LinkIcon,
  Trash2Icon,
  SendIcon,
} from 'lucide-react'
import type { Invite } from '../types/domain'

const EMPTY: never[] = []

const APP_BASE_URL = (import.meta.env.VITE_APP_BASE_URL as string | undefined) ?? 'http://localhost:1420'

const EXPIRY_OPTIONS = [
  { label: '30 minutes', value: 30 * 60 },
  { label: '1 hour', value: 60 * 60 },
  { label: '6 hours', value: 6 * 60 * 60 },
  { label: '12 hours', value: 12 * 60 * 60 },
  { label: '1 day', value: 24 * 60 * 60 },
  { label: '3 days', value: 3 * 24 * 60 * 60 },
  { label: '7 days', value: 7 * 24 * 60 * 60 },
  { label: '30 days', value: 30 * 24 * 60 * 60 },
  { label: 'Never', value: undefined as number | undefined },
]

function inviteUrl(token: string): string {
  return `${APP_BASE_URL}/invite/${token}`
}

function formatExpiry(expiresAt: string): string {
  const remaining = new Date(expiresAt).getTime() - Date.now()
  if (remaining <= 0) return 'Expired'
  const days = Math.floor(remaining / (1000 * 60 * 60 * 24))
  const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60))
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} className="shrink-0">
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      {copied ? 'Copied!' : label}
    </Button>
  )
}

interface InviteCardProps {
  invite: Invite
  serverId: number
  nonMemberFriends: Array<{ identity: string; label: string }>
  onDelete: (token: string) => void
}

function InviteCard({ invite, serverId, nonMemberFriends, onDelete }: InviteCardProps) {
  const [showQr, setShowQr] = useState(false)
  const url = inviteUrl(invite.token)
  const expired = new Date(invite.expiresAt).getTime() <= Date.now()

  const [sendTarget, setSendTarget] = useState<string>('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendSuccess, setSendSuccess] = useState(false)

  const handleSendDm = async () => {
    if (!sendTarget) return
    setSending(true)
    setSendError(null)
    try {
      await reducers.sendDmServerInvite(sendTarget, serverId)
      setSendSuccess(true)
      setTimeout(() => setSendSuccess(false), 2000)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Failed to send invite')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${expired ? 'opacity-60' : 'border-border/70'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <LinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <code className="text-xs text-primary font-mono truncate">{invite.token}</code>
          {expired && <Badge variant="destructive" className="text-[10px] py-0">Expired</Badge>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setShowQr((v) => !v)}
            title="Toggle QR code"
          >
            <QrCodeIcon className="size-3.5" />
          </Button>
          <CopyButton text={url} label="Link" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-destructive hover:text-destructive"
            onClick={() => onDelete(invite.token)}
            title="Delete invite"
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>Uses: {invite.useCount}{invite.maxUses != null ? ` / ${invite.maxUses}` : ''}</span>
        <span>·</span>
        <span>{expired ? 'Expired' : `Expires in ${formatExpiry(invite.expiresAt)}`}</span>
        {invite.allowedUsernames.length > 0 && (
          <>
            <span>·</span>
            <span>Whitelist: {invite.allowedUsernames.map((u) => `@${u}`).join(', ')}</span>
          </>
        )}
      </div>

      {showQr && (
        <div className="flex flex-col items-center gap-2 pt-1 pb-1">
          <div className="rounded-lg bg-white p-3">
            <QRCodeSVG value={url} size={160} />
          </div>
          <p className="text-[10px] text-muted-foreground break-all max-w-xs text-center">{url}</p>
        </div>
      )}

      {!expired && nonMemberFriends.length > 0 && (
        <div className="flex items-center gap-2 pt-1 border-t border-border/50">
          <select
            className="flex-1 text-xs bg-background border border-border/60 rounded px-2 py-1"
            value={sendTarget}
            onChange={(e) => setSendTarget(e.target.value)}
          >
            <option value="">Send as in-app invite to…</option>
            {nonMemberFriends.map((f) => (
              <option key={f.identity} value={f.identity}>{f.label}</option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="shrink-0"
            disabled={!sendTarget || sending}
            onClick={handleSendDm}
          >
            {sendSuccess ? <CheckIcon className="size-3.5" /> : <SendIcon className="size-3.5" />}
            {sendSuccess ? 'Sent!' : 'Send'}
          </Button>
        </div>
      )}
      {sendError && <p className="text-xs text-destructive">{sendError}</p>}
    </div>
  )
}

export function InviteModal({ serverId, onClose }: { serverId: number; onClose: () => void }) {
  const [expirySeconds, setExpirySeconds] = useState<number | undefined>(7 * 24 * 60 * 60)
  const [maxUses, setMaxUses] = useState<number | ''>('')
  const [allowedUsernamesRaw, setAllowedUsernamesRaw] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const invites = useInvitesStore((s) => s.invitesByServer[serverId] ?? EMPTY)
  const server = useServersStore((s) => s.servers.find((sv) => sv.id === serverId) ?? null)
  const selfIdentity = useConnectionStore((s) => s.identity)
  const friends = useFriendsStore((s) => s.friends)
  const members = useMembersStore((s) => s.membersByServer[serverId] ?? EMPTY)
  const usersByIdentity = useUsersStore((s) => s.byIdentity)

  const memberIdentities = new Set(members.map((m) => m.userIdentity.toLowerCase()))
  const nonMemberFriends = friends
    .filter((f) => f.status === 'Accepted')
    .flatMap((f) => {
      const other = selfIdentity && f.userA.toLowerCase() === selfIdentity.toLowerCase() ? f.userB : f.userA
      if (!other || memberIdentities.has(other.toLowerCase())) return []
      const user = Object.values(usersByIdentity).find((u) => u.identity.toLowerCase() === other.toLowerCase())
      return [{ identity: other, label: user?.displayName ?? user?.username ?? other.slice(0, 12) }]
    })

  const handleCreate = async () => {
    setError(null)
    setCreating(true)
    try {
      const usernames = allowedUsernamesRaw
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean)
      await reducers.createInvite(
        serverId,
        expirySeconds,
        maxUses === '' ? undefined : maxUses,
        usernames,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create invite.')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (token: string) => {
    setError(null)
    try {
      await reducers.deleteInvite(token)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete invite.')
    }
  }

  const activeInviteCount = invites.filter((i) => new Date(i.expiresAt).getTime() > Date.now()).length

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <LinkIcon className="size-4 text-primary" />
          Invite to {server?.name ?? 'Server'}
        </DialogTitle>
        <DialogDescription>Create invite links or send in-app invites to friends.</DialogDescription>
      </DialogHeader>

      <Tabs defaultValue="create">
        <TabsList className="w-full">
          <TabsTrigger value="create" className="flex-1">Create Invite</TabsTrigger>
          <TabsTrigger value="links" className="flex-1">
            Active Links
            {activeInviteCount > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] py-0">{activeInviteCount}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="create" className="space-y-3 mt-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Expires after</Label>
              <Select
                value={expirySeconds == null ? 'never' : String(expirySeconds)}
                onValueChange={(v) => setExpirySeconds(v === 'never' ? undefined : Number(v))}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.label} value={opt.value == null ? 'never' : String(opt.value)} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Max uses</Label>
              <Input
                type="number"
                min={1}
                placeholder="Unlimited"
                className="h-8 text-xs"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value === '' ? '' : Number(e.target.value))}
                disabled={allowedUsernamesRaw.trim().length > 0}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              Username whitelist
              <span className="ml-1 text-muted-foreground">(comma-separated — disables max uses)</span>
            </Label>
            <Input
              placeholder="alice, bob, charlie"
              className="h-8 text-xs"
              value={allowedUsernamesRaw}
              onChange={(e) => setAllowedUsernamesRaw(e.target.value)}
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" disabled={creating} onClick={handleCreate}>
              <LinkIcon className="size-3.5" />
              {creating ? 'Creating…' : 'Create Link'}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="links" className="mt-4">
          {invites.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No invite links yet. Create one first.</p>
          ) : (
            <ScrollArea className="max-h-80">
              <div className="space-y-2 pr-1">
                {invites.map((inv) => (
                  <InviteCard
                    key={inv.token}
                    invite={inv}
                    serverId={serverId}
                    nonMemberFriends={nonMemberFriends}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
          {error ? <p className="text-sm text-destructive mt-2">{error}</p> : null}
          <div className="flex justify-end gap-2 mt-3">
            {invites.some((i) => new Date(i.expiresAt).getTime() <= Date.now()) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void reducers.cleanupExpiredInvites()}
              >
                Clean up expired
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
