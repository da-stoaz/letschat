import { useEffect, useMemo, useState } from 'react'
import { ConnectionState } from 'livekit-client'
import { PhoneCallIcon, PhoneOffIcon, PanelBottomCloseIcon, PanelBottomOpenIcon } from 'lucide-react'
import { dmVoiceRoomKey, joinLiveKitDmVoice, leaveLiveKitDmVoice, useLiveKitRoom } from '../../lib/livekit'
import { reducers } from '../../lib/spacetimedb'
import { useConnectionStore } from '../../stores/connectionStore'
import { useDmStore } from '../../stores/dmStore'
import { useDmVoiceSessionStore } from '../../stores/dmVoiceSessionStore'
import { useDmVoiceStore } from '../../stores/dmVoiceStore'
import { useUserPresentation } from '../../hooks/useUserPresentation'
import { useIsMobile } from '../../hooks/use-mobile'
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
import { PresenceDot } from '@/components/user/PresenceDot'
import type { DirectMessage, Identity } from '../../types/domain'
import { warnOnce } from '../../lib/devWarnings'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/components/ui/sonner'
import { useUsersStore } from '../../stores/usersStore'

const EMPTY_DM_MESSAGES: DirectMessage[] = []

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
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [scrollToBottomToken, setScrollToBottomToken] = useState(0)
  const isMobile = useIsMobile()
  const [callPanelMinimized, setCallPanelMinimized] = useState(!isMobile)
  const selfIdentity = useConnectionStore((s) => s.identity)
  const conversations = useDmStore((s) => s.conversations)
  const usersByIdentity = useUsersStore((s) => s.byIdentity)
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
          editedAt: null,
          deleted: isDeletedForViewer(message, selfIdentity),
          systemKind: systemMessage?.kind ?? null,
          systemMeta: systemMessage ? formatDmSystemMetadata(message.sentAt) : null,
          systemMissed: systemMessage?.missed ?? false,
        }
      }),
    [messages, partner.displayName, selfIdentity, selfLabel],
  )

  useEffect(() => {
    setCallPanelMinimized(!isMobile)
  }, [isMobile, partnerIdentity])

  const roomKey = useMemo(
    () => (selfIdentity ? dmVoiceRoomKey(selfIdentity, partnerIdentity) : null),
    [partnerIdentity, selfIdentity],
  )
  const voiceParticipants = roomKey ? (participantsByRoom[roomKey] ?? []) : []
  const roomForPartner =
    dmRoom && joinedPartnerIdentity && normalizeIdentity(joinedPartnerIdentity) === normalizeIdentity(partnerIdentity)
      ? dmRoom
      : null
  const { connectionState } = useLiveKitRoom(roomForPartner)
  const joined = roomForPartner !== null && connectionState === ConnectionState.Connected
  const connecting = dmJoining || (roomForPartner !== null && connectionState === ConnectionState.Connecting)
  const statusBadge = connecting ? 'Joining...' : joined ? 'Joined' : voiceParticipants.length > 0 ? 'Syncing...' : 'Not joined'
  const statusVariant = connecting ? 'outline' : joined ? 'default' : voiceParticipants.length > 0 ? 'outline' : 'secondary'
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

  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-border/70 bg-card/60">
      <header className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
        <div className="min-w-0 flex flex-1 items-center gap-2">
          <Avatar className="size-8 rounded-lg">
            {partner.avatarUrl ? <AvatarImage src={partner.avatarUrl} alt={partner.displayName} /> : null}
            <AvatarFallback className="rounded-lg bg-primary/15 text-xs">{toInitials(partnerIdentity)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-medium">{partner.displayName}</p>
              <PresenceDot status={partner.status} />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              Direct conversation with @{partner.username}
              {ongoingCallDuration ? ` • Ongoing call since ${ongoingCallDuration}` : ''}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={statusVariant}>{statusBadge}</Badge>
          <Button
            size="sm"
            variant={joined ? 'destructive' : 'default'}
            disabled={connecting}
            onClick={() => {
              void onPrimaryCallAction()
            }}
          >
            {joined ? <PhoneOffIcon className="size-4" /> : <PhoneCallIcon className="size-4" />}
            {connecting ? 'Joining...' : joined ? 'Leave Call' : 'Call User'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setCallPanelMinimized((value) => !value)}
          >
            {callPanelMinimized ? <PanelBottomOpenIcon className="size-4" /> : <PanelBottomCloseIcon className="size-4" />}
            {callPanelMinimized ? 'Show Call' : 'Minimize'}
          </Button>
        </div>
      </header>

      {!callPanelMinimized ? (
        <div className="border-b border-border/70 p-3">
          <DmVoicePanel partnerIdentity={partnerIdentity} showHeader={false} />
        </div>
      ) : null}

      <ChatMessageFeed
        scopeKey={`dm:${partnerIdentity}`}
        messages={renderMessages}
        selfIdentity={selfIdentity}
        canDeleteAny
        allowEditOwn={false}
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

      <Separator />

      <ChatComposer
        value={draft}
        onChange={setDraft}
        placeholder={`Message @${partner.username}`}
        typingScopeKey={typingScopeKey}
        typingIdentity={selfIdentity}
        error={error}
        onSubmit={async (trimmed) => {
          setError(null)
          try {
            await reducers.sendDirectMessage(partnerIdentity, trimmed)
            setDraft('')
            setScrollToBottomToken((current) => current + 1)
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Could not send direct message.'
            setError(message)
          }
        }}
      />
    </section>
  )
}
