import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { reducers } from '../lib/spacetimedb'
import { useInvitesStore } from '../stores/invitesStore'
import { useServersStore } from '../stores/serversStore'
import { useMembersStore } from '../stores/membersStore'
import { useDmServerInvitesStore } from '../stores/dmServerInvitesStore'
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
import { toast } from '@/components/ui/sonner'
import {
  CopyIcon,
  CheckIcon,
  QrCodeIcon,
  LinkIcon,
  Trash2Icon,
  UserPlusIcon,
  XIcon,
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
] as const
const LINKS_LIST_MAX_HEIGHT_PX = 480
const LINKS_LIST_MAX_VIEWPORT_RATIO = 0.52

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
  onDelete: (token: string) => void
}

function InviteCard({ invite, onDelete }: InviteCardProps) {
  const [showQr, setShowQr] = useState(false)
  const url = inviteUrl(invite.token)
  const expired = new Date(invite.expiresAt).getTime() <= Date.now()

  return (
    <div className={`rounded-lg border p-3 space-y-2 overflow-hidden ${expired ? 'opacity-60' : 'border-border/70'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <LinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <code className="text-xs text-primary font-mono truncate">{invite.token}</code>
          {expired && <Badge variant="destructive" className="text-[10px] py-0">Expired</Badge>}
        </div>
        <div className="ml-auto flex items-center gap-1 shrink-0">
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
            <span>Allowed users: {invite.allowedUsernames.map((u) => `@${u}`).join(', ')}</span>
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
    </div>
  )
}

export function InviteModal({ serverId, onClose }: { serverId: number; onClose: () => void }) {
  type InviteTab = 'people' | 'create-link' | 'links'
  const [expirySeconds, setExpirySeconds] = useState<number | undefined>(7 * 24 * 60 * 60)
  const [maxUses, setMaxUses] = useState<number | ''>('')
  const [selectedRecipientIdentities, setSelectedRecipientIdentities] = useState<string[]>([])
  const [recipientQuery, setRecipientQuery] = useState('')
  const [sendingDirectInvite, setSendingDirectInvite] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [activeTab, setActiveTab] = useState<InviteTab>('people')
  const [panelHeight, setPanelHeight] = useState<number | null>(null)
  const [linksListHeight, setLinksListHeight] = useState<number>(0)
  const peoplePanelRef = useRef<HTMLDivElement | null>(null)
  const createLinkPanelRef = useRef<HTMLDivElement | null>(null)
  const linksPanelRef = useRef<HTMLDivElement | null>(null)
  const linksListContentRef = useRef<HTMLDivElement | null>(null)
  const invites = useInvitesStore((s) => s.invitesByServer[serverId] ?? EMPTY)
  const server = useServersStore((s) => s.servers.find((sv) => sv.id === serverId) ?? null)
  const selfIdentity = useConnectionStore((s) => s.identity)
  const dmInvites = useDmServerInvitesStore((s) => s.invites)
  const members = useMembersStore((s) => s.membersByServer[serverId] ?? EMPTY)
  const usersByIdentity = useUsersStore((s) => s.byIdentity)
  const usersByNormalizedIdentity = useMemo(() => {
    const map = new Map<string, { identity: string; username: string; displayName: string }>()
    for (const user of Object.values(usersByIdentity)) {
      map.set(user.identity.toLowerCase(), {
        identity: user.identity,
        username: user.username,
        displayName: user.displayName,
      })
    }
    return map
  }, [usersByIdentity])

  const memberIdentities = useMemo(
    () => new Set(members.map((m) => m.userIdentity.toLowerCase())),
    [members],
  )
  const pendingRecipientIdentities = useMemo(() => {
    return new Set(
      dmInvites
        .filter((inv) => inv.serverId === serverId && inv.status === 'Pending')
        .map((inv) => inv.recipientIdentity.toLowerCase()),
    )
  }, [dmInvites, serverId])
  const inviteCandidates = useMemo(() => {
    const normalizedSelf = selfIdentity?.toLowerCase() ?? null
    return Object.values(usersByIdentity)
      .filter((user) => {
        const normalizedIdentity = user.identity.toLowerCase()
        if (normalizedSelf && normalizedIdentity === normalizedSelf) return false
        return !memberIdentities.has(normalizedIdentity)
      })
      .map((user) => ({
        identity: user.identity,
        username: user.username,
        label: user.displayName || user.username,
        pending: pendingRecipientIdentities.has(user.identity.toLowerCase()),
      }))
      .sort((a, b) => {
        const labelCmp = a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
        if (labelCmp !== 0) return labelCmp
        return a.username.localeCompare(b.username, undefined, { sensitivity: 'base' })
      })
  }, [memberIdentities, pendingRecipientIdentities, selfIdentity, usersByIdentity])
  const selectedRecipientSet = useMemo(
    () => new Set(selectedRecipientIdentities.map((identity) => identity.toLowerCase())),
    [selectedRecipientIdentities],
  )
  const selectedRecipients = useMemo(
    () =>
      selectedRecipientIdentities
        .map((identity) => inviteCandidates.find((candidate) => candidate.identity === identity) ?? null)
        .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null),
    [inviteCandidates, selectedRecipientIdentities],
  )
  const filteredInviteCandidates = useMemo(() => {
    const query = recipientQuery.trim().toLowerCase()
    const selectable = inviteCandidates.filter(
      (candidate) => !candidate.pending && !selectedRecipientSet.has(candidate.identity.toLowerCase()),
    )
    if (!query) return selectable.slice(0, 8)
    return selectable.filter((candidate) => (
      candidate.label.toLowerCase().includes(query)
      || candidate.username.toLowerCase().includes(query)
    ))
  }, [inviteCandidates, recipientQuery, selectedRecipientSet])
  const pendingDirectInvites = useMemo(() => {
    return dmInvites
      .filter((invite) => invite.serverId === serverId && invite.status === 'Pending')
      .map((invite) => {
        const user = usersByNormalizedIdentity.get(invite.recipientIdentity.toLowerCase())
        const label = user?.displayName || user?.username || invite.recipientIdentity.slice(0, 12)
        return {
          id: invite.id,
          recipientIdentity: invite.recipientIdentity,
          label,
          username: user?.username ?? null,
          createdAt: invite.createdAt,
        }
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  }, [dmInvites, serverId, usersByNormalizedIdentity])

  const handleSendDirectInvite = async () => {
    if (selectedRecipients.length === 0) return
    setError(null)
    setSendingDirectInvite(true)
    const toastId = toast.loading(
      selectedRecipients.length === 1
        ? `Sending invite to ${selectedRecipients[0].label}...`
        : `Sending ${selectedRecipients.length} invites...`,
    )
    try {
      const results = await Promise.allSettled(
        selectedRecipients.map((recipient) => reducers.sendDmServerInvite(recipient.identity, serverId)),
      )
      const failedIdentities: string[] = []
      const failedMessages: string[] = []
      let successCount = 0
      for (let idx = 0; idx < results.length; idx += 1) {
        const result = results[idx]
        if (result.status === 'fulfilled') {
          successCount += 1
        } else {
          failedIdentities.push(selectedRecipients[idx].identity)
          const message = result.reason instanceof Error ? result.reason.message : 'Failed to send invite.'
          failedMessages.push(message)
        }
      }

      if (failedIdentities.length === 0) {
        toast.success(successCount === 1 ? 'Invite sent' : 'Invites sent', {
          id: toastId,
          description:
            successCount === 1
              ? `${selectedRecipients[0].label} can now accept it in DMs.`
              : `${successCount} users can now accept your invite in DMs.`,
        })
        setSelectedRecipientIdentities([])
        setRecipientQuery('')
      } else if (successCount === 0) {
        const message = failedMessages[0] ?? 'Failed to send invites.'
        setError(message)
        toast.error('Could not send invites', {
          id: toastId,
          description: message,
        })
      } else {
        toast.error('Some invites failed', {
          id: toastId,
          description: `${successCount} sent, ${failedIdentities.length} failed.`,
        })
        setSelectedRecipientIdentities((prev) => prev.filter((id) => failedIdentities.includes(id)))
        setRecipientQuery('')
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to send invite.'
      setError(message)
      toast.error('Could not send invite', {
        id: toastId,
        description: message,
      })
    } finally {
      setSendingDirectInvite(false)
    }
  }

  const handleCreate = async () => {
    setError(null)
    setCreating(true)
    const toastId = toast.loading('Creating invite link...')
    try {
      await reducers.createInvite(
        serverId,
        expirySeconds,
        maxUses === '' ? undefined : maxUses,
        [],
      )
      toast.success('Invite link created', {
        id: toastId,
        description: `Ready for ${server?.name ?? 'this server'}.`,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not create invite.'
      setError(message)
      toast.error('Failed to create invite link', {
        id: toastId,
        description: message,
      })
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

  const activeInviteCount = invites.length
  const expirySelectValue = expirySeconds == null ? 'never' : String(expirySeconds)
  const selectedExpiryLabel =
    EXPIRY_OPTIONS.find((opt) => (opt.value == null ? 'never' : String(opt.value)) === expirySelectValue)?.label
    ?? '7 days'

  useEffect(() => {
    void reducers.cleanupExpiredInvites()
  }, [serverId])

  useLayoutEffect(() => {
    const activePanel =
      activeTab === 'people'
        ? peoplePanelRef.current
        : activeTab === 'create-link'
          ? createLinkPanelRef.current
          : linksPanelRef.current
    if (!activePanel) return

    const updateHeight = () => {
      const next = Math.ceil(activePanel.scrollHeight) + 1
      setPanelHeight((prev) => (prev === next ? prev : next))
    }

    updateHeight()
    const rafId = window.requestAnimationFrame(updateHeight)

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => updateHeight())
    observer.observe(activePanel)
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(rafId)
    }
  }, [activeTab])

  useLayoutEffect(() => {
    const content = linksListContentRef.current
    if (!content) return

    const viewportCap = () =>
      Math.min(
        Math.floor(window.innerHeight * LINKS_LIST_MAX_VIEWPORT_RATIO),
        LINKS_LIST_MAX_HEIGHT_PX,
      )

    const updateHeight = () => {
      const contentHeight = Math.ceil(content.scrollHeight)
      setLinksListHeight(Math.min(contentHeight, viewportCap()))
    }

    updateHeight()

    const observer = new ResizeObserver(() => updateHeight())
    observer.observe(content)
    window.addEventListener('resize', updateHeight)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateHeight)
    }
  }, [activeTab, invites.length])

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <LinkIcon className="size-4 text-primary" />
          Invite to {server?.name ?? 'Server'}
        </DialogTitle>
        <DialogDescription>Invite people directly or create shareable server links.</DialogDescription>
      </DialogHeader>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as InviteTab)}
        className="min-h-0 gap-0 overflow-hidden"
      >
        <TabsList className="w-full">
          <TabsTrigger value="people" className="flex-1">Invite People</TabsTrigger>
          <TabsTrigger value="create-link" className="flex-1">Create Link</TabsTrigger>
          <TabsTrigger value="links" className="flex-1">
            Active Links
            {activeInviteCount > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] py-0">{activeInviteCount}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <div
          className="overflow-hidden transition-[height] duration-200 ease-out"
          style={panelHeight === null ? undefined : { height: `${panelHeight}px` }}
        >
          <TabsContent value="people" className="flex-none">
            <div ref={peoplePanelRef} className="space-y-3 pt-4">
              <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-medium">Invite Existing User</h3>
                  <p className="text-xs text-muted-foreground">
                    Search by username or display name and send an in-app invite directly.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="rounded-md border border-border/70 bg-background/60 p-2">
                    {selectedRecipients.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {selectedRecipients.map((recipient) => (
                          <Badge key={recipient.identity} variant="secondary" className="gap-1">
                            <span className="truncate max-w-[160px]">{recipient.label}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedRecipientIdentities((prev) => prev.filter((id) => id !== recipient.identity))
                              }}
                              className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                              aria-label={`Remove ${recipient.label}`}
                            >
                              <XIcon className="size-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}

                    <Input
                      value={recipientQuery}
                      onChange={(event) => setRecipientQuery(event.target.value)}
                      placeholder={selectedRecipients.length > 0 ? 'Add another username...' : 'Type username or display name...'}
                      className="h-9 w-full text-sm"
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="none"
                      autoComplete="off"
                    />
                  </div>

                  <ScrollArea className="h-44 rounded-md border border-border/60 bg-background/40 px-1 py-1">
                    <div className="space-y-1 px-1">
                      {filteredInviteCandidates.length === 0 ? (
                        <p className="px-2 py-3 text-xs text-muted-foreground">No matching users found.</p>
                      ) : (
                        filteredInviteCandidates.map((candidate) => (
                          <button
                            key={candidate.identity}
                            type="button"
                            onClick={() => {
                              setSelectedRecipientIdentities((prev) => (
                                prev.includes(candidate.identity) ? prev : [...prev, candidate.identity]
                              ))
                              setRecipientQuery('')
                            }}
                            className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-medium">{candidate.label}</p>
                                <p className="truncate text-[11px] text-muted-foreground">@{candidate.username}</p>
                              </div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[11px] text-muted-foreground">
                    {selectedRecipients.length > 0
                      ? `${selectedRecipients.length} user${selectedRecipients.length === 1 ? '' : 's'} selected.`
                      : 'Choose one or more users to enable sending.'}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="shrink-0"
                    disabled={selectedRecipients.length === 0 || sendingDirectInvite}
                    onClick={handleSendDirectInvite}
                  >
                    <UserPlusIcon className="size-3.5" />
                    {sendingDirectInvite ? 'Sending…' : selectedRecipients.length > 1 ? 'Send Invites' : 'Send Invite'}
                  </Button>
                </div>
              </div>

              {pendingDirectInvites.length > 0 && (
                <div className="rounded-lg border border-border/70 p-3 space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Pending Invites</p>
                  <div className="space-y-1">
                    {pendingDirectInvites.slice(0, 5).map((invite) => (
                      <div key={invite.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1.5">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium">{invite.label}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {invite.username ? `@${invite.username}` : invite.recipientIdentity}
                          </p>
                        </div>
                        <Badge variant="secondary" className="text-[10px]">Pending</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error ? <p className="text-sm text-destructive">{error}</p> : null}

              <div className="flex items-center justify-end pt-1">
                <Button type="button" variant="outline" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="create-link" className="flex-none">
            <div ref={createLinkPanelRef} className="space-y-3 pt-4">
              <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-medium">Create Shareable Link</h3>
                  <p className="text-xs text-muted-foreground">
                    Generate a reusable invite link with configurable lifetime and usage limits.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Expires after</Label>
                    <Select
                      value={expirySelectValue}
                      onValueChange={(v) => {
                        const selected = EXPIRY_OPTIONS.find(
                          (opt) => (opt.value == null ? 'never' : String(opt.value)) === v,
                        )
                        setExpirySeconds(selected?.value)
                      }}
                    >
                      <SelectTrigger className="h-8 w-full text-xs">
                        <span className="truncate font-medium">{selectedExpiryLabel}</span>
                        <SelectValue className="sr-only" />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {EXPIRY_OPTIONS.map((opt) => (
                          <SelectItem
                            key={opt.label}
                            value={opt.value == null ? 'never' : String(opt.value)}
                            className="py-1.5 text-xs"
                          >
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
                    />
                  </div>
                </div>
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
            </div>
          </TabsContent>

          <TabsContent value="links" className="flex-none">
            <div ref={linksPanelRef} className="flex flex-col gap-3 pt-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">Manage shareable links for this server.</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveTab('create-link')}
                >
                  New Link
                </Button>
              </div>
              {invites.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No invite links yet. Create one first.</p>
              ) : (
                <ScrollArea
                  className="pr-2"
                  style={linksListHeight > 0 ? { height: `${linksListHeight}px` } : undefined}
                >
                  <div ref={linksListContentRef} className="space-y-2">
                    {invites.map((inv) => (
                      <InviteCard
                        key={inv.token}
                        invite={inv}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                </ScrollArea>
              )}
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <div className="mt-1 flex justify-end gap-2">
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
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
