import { useEffect, useMemo, useState } from 'react'
import { ConnectionState } from 'livekit-client'
import { PhoneCallIcon, PhoneOffIcon, PanelBottomCloseIcon, PanelBottomOpenIcon, ServerIcon, CheckIcon, XIcon } from 'lucide-react'
import { dmVoiceRoomKey, joinLiveKitDmVoice, leaveLiveKitDmVoice, useLiveKitRoom } from '../../lib/livekit'
import { reducers } from '../../lib/spacetimedb'
import { useConnectionStore } from '../../stores/connectionStore'
import { useDmStore } from '../../stores/dmStore'
import { useDmVoiceSessionStore } from '../../stores/dmVoiceSessionStore'
import { useDmVoiceStore } from '../../stores/dmVoiceStore'
import { useUiStore } from '../../stores/uiStore'
import { useDmServerInvitesStore } from '../../stores/dmServerInvitesStore'
import { useServersStore } from '../../stores/serversStore'
import { useUserPresentation } from '../../hooks/useUserPresentation'
import { useIsMobile } from '../../hooks/use-mobile'
import { useComposerStore } from '../../stores/composerStore'
import { CompactBack } from '../../components/CompactBack'
import { ChatComposer } from '../chat/ChatComposer'
import { ChatMessageFeed } from '../chat/ChatMessageFeed'
import { DmVoicePanel } from './DmVoicePanel'
import {
  encodeDmSystemMessage,
  formatDmSystemMetadata,
  formatDmSystemPrimaryText,
  getCallDurationSeconds,
  parseDmSystemMessage,
} from './systemMessages'
import { useOngoingCallDuration } from '../voice/hooks/useOngoingCallDuration'
import { composeMessageWithAttachments } from '../chat/attachmentPayload'
import { PresenceDot } from '@/components/user/PresenceDot'
import type { DirectMessage, DmServerInvite, Identity } from '../../types/domain'
import { warnOnce } from '../../lib/devWarnings'
import { loadOlderDirectMessages } from '../../lib/spacetimedb/history'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useUsersStore } from '../../stores/usersStore'

const EMPTY_DM_MESSAGES: DirectMessage[] = []

function DmServerInviteCard({ invite }: { invite: DmServerInvite }) {
  const [responding, setResponding] = useState<'accept' | 'decline' | null>(null)
  const servers = useServersStore((s) => s.servers)
  const selfIdentity = useConnectionStore((s) => s.identity)
  const isRecipient = selfIdentity && invite.recipientIdentity.toLowerCase() === selfIdentity.toLowerCase()
  const isSender = selfIdentity && invite.senderIdentity.toLowerCase() === selfIdentity.toLowerCase()
  const server = servers.find((s) => s.id === invite.serverId)
  const serverName = server?.name ?? 'this space'
  const isPending = invite.status === 'Pending'

  const handleRespond = async (accept: boolean) => {
    setResponding(accept ? 'accept' : 'decline')
    try {
      await reducers.respondDmServerInvite(invite.id, accept)
    } catch {
      setResponding(null)
    }
  }

  return (
    <div className="border-b border-border/60 bg-muted/20 px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
          <ServerIcon className="size-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            {isSender ? 'Space Invite Sent' : 'Space Invite'}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {isSender
              ? `You invited to join ${serverName}`
              : `You've been invited to join ${serverName}`}
          </p>
        </div>
        {!isPending && (
          <Badge
            variant={invite.status === 'Accepted' ? 'default' : 'secondary'}
            className="ml-auto text-[10px]"
          >
            {invite.status}
          </Badge>
        )}
      </div>

      {isPending && isRecipient && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="default"
            disabled={responding !== null}
            className="flex-1"
            onClick={() => handleRespond(true)}
          >
            <CheckIcon className="size-3.5" />
            {responding === 'accept' ? 'Joining…' : 'Accept'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={responding !== null}
            className="flex-1"
            onClick={() => handleRespond(false)}
          >
            <XIcon className="size-3.5" />
            {responding === 'decline' ? 'Declining…' : 'Decline'}
          </Button>
        </div>
      )}

      {isPending && isSender && (
        <p className="text-xs text-muted-foreground">Waiting for response…</p>
      )}
    </div>
  )
}

function toInitials(identity: string): string {
  return identity.replace(/^0x/, '').slice(0, 2).toUpperCase()
}

function dmTypingScope(selfIdentity: string | null, partnerIdentity: string): string {
  if (!selfIdentity) return `dm:${partnerIdentity}`
  const a = selfIdentity.toLowerCase()
  const b = partnerIdentity.toLowerCase()
  return a <= b ? `dm:${a}:${b}` : `dm:${b}:${a}`
}

function normalizeIdentity(identity: string | null | undefined): string {
  if (!identity) return ''
  return identity.trim().toLowerCase()
}

function isDeletedForViewer(message: DirectMessage, selfIdentity: string | null): boolean {
  if (!selfIdentity) return false
  if (normalizeIdentity(message.senderIdentity) === normalizeIdentity(selfIdentity)) {
    return message.deletedBySender
  }
  return message.deletedByRecipient
}

export function DMView({ partnerIdentity }: { partnerIdentity: Identity }) {
  const scopeKey = `dm:${partnerIdentity.toLowerCase()}`
  const setError = (error: string | null) => useComposerStore.getState().update(scopeKey, { error })
  const scrollToBottomToken = useComposerStore(s => s.drafts[scopeKey]?.sent ?? 0)
  const isMobile = useIsMobile()
  const [callPanelMinimized, setCallPanelMinimized] = useState(!isMobile)
  // Adjust-state-during-render: reset the panel to its default whenever the
  // conversation or form factor changes, without an extra effect pass.
  const panelResetKey = `${isMobile}|${partnerIdentity}`
  const [lastPanelResetKey, setLastPanelResetKey] = useState(panelResetKey)
  if (panelResetKey !== lastPanelResetKey) {
    setLastPanelResetKey(panelResetKey)
    setCallPanelMinimized(!isMobile)
  }
  const selfIdentity = useConnectionStore((s) => s.identity)
  const conversations = useDmStore((s) => s.conversations)
  const clearDmUnread = useUiStore((s) => s.clearDmUnread)
  const usersByIdentity = useUsersStore((s) => s.byIdentity)
  const allDmInvites = useDmServerInvitesStore((s) => s.invites)
  const dmInvites = useMemo(
    () =>
      allDmInvites.filter((inv) => {
        const senderMatch = inv.senderIdentity.toLowerCase() === partnerIdentity.toLowerCase()
        const recipientMatch = inv.recipientIdentity.toLowerCase() === partnerIdentity.toLowerCase()
        return senderMatch || recipientMatch
      }),
    [allDmInvites, partnerIdentity],
  )
  const participantsByRoom = useDmVoiceStore((s) => s.participantsByRoom)
  const dmRoom = useDmVoiceSessionStore((s) => s.room)
  const joinedPartnerIdentity = useDmVoiceSessionStore((s) => s.joinedPartnerIdentity)
  const dmJoining = useDmVoiceSessionStore((s) => s.joining)
  const dmAnswered = useDmVoiceSessionStore((s) => s.answered)
  const setDmRoom = useDmVoiceSessionStore((s) => s.setRoom)
  const setJoinedPartnerIdentity = useDmVoiceSessionStore((s) => s.setJoinedPartnerIdentity)
  const setDmJoining = useDmVoiceSessionStore((s) => s.setJoining)
  const setDmAnswered = useDmVoiceSessionStore((s) => s.setAnswered)
  const messages = conversations[partnerIdentity] ?? EMPTY_DM_MESSAGES
  const partner = useUserPresentation(partnerIdentity)
  const typingScopeKey = dmTypingScope(selfIdentity, partnerIdentity)
  const selfLabel = useMemo(() => {
    if (!selfIdentity) return 'You'
    const key = normalizeIdentity(selfIdentity)
    const knownUser = Object.values(usersByIdentity).find((user) => normalizeIdentity(user.identity) === key)
    return knownUser?.displayName || knownUser?.username || 'You'
  }, [selfIdentity, usersByIdentity])

  const renderMessages = useMemo(
    () =>
      messages.map((message) => {
        const systemMessage = parseDmSystemMessage(message.content)
        const senderIsSelf = normalizeIdentity(message.senderIdentity) === normalizeIdentity(selfIdentity)
        const senderLabel = senderIsSelf ? selfLabel : partner.displayName
        const systemLabel = formatDmSystemPrimaryText({
          content: message.content,
          sentAt: message.sentAt,
          senderLabel,
          partnerLabel: partner.displayName,
          viewerIsSender: senderIsSelf,
        })
        return {
          id: message.id,
          senderIdentity: message.senderIdentity,
          content: systemLabel ?? message.content,
          sentAt: message.sentAt,
          editedAt: message.editedAt,
          deleted: isDeletedForViewer(message, selfIdentity),
          systemKind: systemMessage?.kind ?? null,
          systemMeta: systemMessage ? formatDmSystemMetadata(message.sentAt) : null,
          systemMissed: systemMessage?.missed ?? false,
        }
      }),
    [messages, partner.displayName, selfIdentity, selfLabel],
  )

  const roomKey = useMemo(
    () => (selfIdentity ? dmVoiceRoomKey(selfIdentity, partnerIdentity) : null),
    [partnerIdentity, selfIdentity],
  )
  const voiceParticipants = useMemo(
    () => (roomKey ? (participantsByRoom[roomKey] ?? []) : []),
    [participantsByRoom, roomKey],
  )
  const roomForPartner =
    dmRoom && joinedPartnerIdentity && normalizeIdentity(joinedPartnerIdentity) === normalizeIdentity(partnerIdentity)
      ? dmRoom
      : null
  const { connectionState } = useLiveKitRoom(roomForPartner)
  const joined = roomForPartner !== null && connectionState === ConnectionState.Connected
  const connecting = dmJoining || (roomForPartner !== null && connectionState === ConnectionState.Connecting)
  const hasActiveCall = joined || connecting || voiceParticipants.length > 0
  // The call button already says "Joining…" / "Leave Call", so a badge repeating it
  // is noise sitting right next to its own label. Show the badge only for the one
  // state the button cannot express: a call already in progress that you are not in.
  const showStatusBadge = !connecting && !joined && voiceParticipants.length > 0
  const selfVoiceParticipant = useMemo(
    () =>
      voiceParticipants.find(
        (participant) => normalizeIdentity(participant.userIdentity) === normalizeIdentity(selfIdentity),
      ) ?? null,
    [selfIdentity, voiceParticipants],
  )
  const remoteJoinedCount = useMemo(
    () =>
      voiceParticipants.filter(
        (participant) => normalizeIdentity(participant.userIdentity) !== normalizeIdentity(selfIdentity),
      ).length,
    [selfIdentity, voiceParticipants],
  )
  useEffect(() => {
    if (!joined || remoteJoinedCount === 0) return
    setDmAnswered(true)
  }, [joined, remoteJoinedCount, setDmAnswered])
  const callStartedAt = useMemo(() => {
    if (voiceParticipants.length === 0) return null
    let earliest: string | null = null
    for (const participant of voiceParticipants) {
      if (!participant.joinedAt) continue
      if (!earliest || Date.parse(participant.joinedAt) < Date.parse(earliest)) {
        earliest = participant.joinedAt
      }
    }
    return earliest
  }, [voiceParticipants])
  const ongoingCallDuration = useOngoingCallDuration(callStartedAt, joined)

  const onPrimaryCallAction = async () => {
    try {
      if (joined) {
        const callDurationSeconds = getCallDurationSeconds(selfVoiceParticipant?.joinedAt)
        await leaveLiveKitDmVoice(partnerIdentity, roomForPartner)
        setDmRoom(null)
        setJoinedPartnerIdentity(null)
        setDmAnswered(false)
        if (callDurationSeconds !== null) {
          await reducers
            .sendDirectMessage(
              partnerIdentity,
              encodeDmSystemMessage('call_ended', {
                durationSeconds: callDurationSeconds,
                missed: !dmAnswered,
              }),
            )
            .catch(() => undefined)
        }
        return
      }

      setDmJoining(true)
      const shouldEmitCallStarted = voiceParticipants.length === 0
      if (dmRoom && joinedPartnerIdentity && normalizeIdentity(joinedPartnerIdentity) !== normalizeIdentity(partnerIdentity)) {
        await leaveLiveKitDmVoice(joinedPartnerIdentity, dmRoom)
        setDmRoom(null)
        setJoinedPartnerIdentity(null)
      }
      const nextRoom = await joinLiveKitDmVoice(partnerIdentity)
      setDmRoom(nextRoom)
      setJoinedPartnerIdentity(partnerIdentity)
      setDmAnswered(false)
      if (shouldEmitCallStarted) {
        await reducers.sendDirectMessage(partnerIdentity, encodeDmSystemMessage('call_started')).catch(() => undefined)
      }
      setCallPanelMinimized(false)
    } catch (callError) {
      const message = callError instanceof Error ? callError.message : 'Could not update DM call state.'
      toast.error(message)
    } finally {
      setDmJoining(false)
    }
  }

  useEffect(() => {
    if (messages !== EMPTY_DM_MESSAGES) return
    warnOnce(
      `missing_dm_messages_${partnerIdentity}`,
      `[zustand-stability] Missing DM array for ${partnerIdentity}; using stable EMPTY_DM_MESSAGES fallback.`,
    )
  }, [messages, partnerIdentity])

  const lastMessageId = messages[messages.length - 1]?.id ?? null

  useEffect(() => {
    const markRead = () => {
      if (!document.hasFocus()) return
      clearDmUnread(partnerIdentity)
      reducers.markDmRead(partnerIdentity).catch(() => undefined)
    }
    markRead()
    window.addEventListener('focus', markRead)
    return () => window.removeEventListener('focus', markRead)
  }, [clearDmUnread, partnerIdentity, lastMessageId])

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card/60">
      <header className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-2">
        <CompactBack />
        <div className="min-w-0 flex flex-1 items-center gap-2">
          <Avatar className="size-8 rounded-full">
            {partner.avatarUrl ? <AvatarImage src={partner.avatarUrl} alt={partner.displayName} /> : null}
            <AvatarFallback className="rounded-full bg-primary/15 text-xs">{toInitials(partnerIdentity)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-medium">{partner.displayName}</p>
              <PresenceDot status={partner.status} />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              @{partner.username}
              {ongoingCallDuration ? ` • Ongoing call since ${ongoingCallDuration}` : ''}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {showStatusBadge && !isMobile ? <Badge variant="outline">In call</Badge> : null}
          <Button
            size="sm"
            variant={joined ? 'destructive' : 'default'}
            aria-label={connecting ? 'Joining call' : joined ? 'Leave call' : 'Call'}
            disabled={connecting}
            onClick={() => {
              void onPrimaryCallAction()
            }}
          >
            {joined ? <PhoneOffIcon className="size-4" /> : <PhoneCallIcon className="size-4" />}
            <span className="hidden sm:inline">{connecting ? 'Joining…' : joined ? 'Leave call' : 'Call'}</span>
          </Button>
          {hasActiveCall ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={callPanelMinimized ? 'Show call' : 'Minimize call'}
              onClick={() => setCallPanelMinimized((value) => !value)}
            >
              {callPanelMinimized ? <PanelBottomOpenIcon className="size-4" /> : <PanelBottomCloseIcon className="size-4" />}
              <span className="hidden sm:inline">{callPanelMinimized ? 'Show call' : 'Minimize'}</span>
            </Button>
          ) : null}
        </div>
      </header>

      {hasActiveCall && !callPanelMinimized ? (
        <div className="border-b border-border/70 p-2">
          <DmVoicePanel partnerIdentity={partnerIdentity} showHeader={false} />
        </div>
      ) : null}

      <ChatMessageFeed
        key={scopeKey}
        scopeKey={scopeKey}
        messages={renderMessages}
        onLoadOlder={() => void loadOlderDirectMessages(partnerIdentity)}
        selfIdentity={selfIdentity}
        canDeleteAny
        allowEditOwn
        onEditMessage={async (message, newContent) => {
          await reducers.editDirectMessage(message.id, newContent)
        }}
        onDeleteMessage={async (message) => {
          setError(null)
          try {
            await reducers.deleteDirectMessage(message.id)
          } catch (e) {
            const nextError = e instanceof Error ? e.message : 'Could not delete direct message.'
            setError(nextError)
          }
        }}
        scrollToBottomToken={scrollToBottomToken}
      />

      {dmInvites.length > 0 && (
        <div className="border-t border-border/60">
          {dmInvites.map((inv) => (
            <DmServerInviteCard key={inv.id} invite={inv} />
          ))}
        </div>
      )}

      <ChatComposer
        key={scopeKey}
        scopeKey={scopeKey}
        placeholder={`Message @${partner.username}`}
        uploadScope={{ kind: 'dm', partner: partner.username }}
        typingScopeKey={typingScopeKey}
        typingIdentity={selfIdentity}
        onSubmit={async ({ text, attachments }) => {
          await reducers.sendDirectMessage(partnerIdentity, composeMessageWithAttachments(text, attachments))
        }}
      />
    </section>
  )
}
