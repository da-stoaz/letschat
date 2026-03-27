import { useEffect, useMemo, useState } from 'react'
import { reducers } from '../../lib/spacetimedb'
import { useConnectionStore } from '../../stores/connectionStore'
import { useDmStore } from '../../stores/dmStore'
import { useUserPresentation } from '../../hooks/useUserPresentation'
import { ChatComposer } from '../chat/ChatComposer'
import { ChatMessageFeed } from '../chat/ChatMessageFeed'
import { TypingIndicator } from '../chat/TypingIndicator'
import { DmVoicePanel } from './DmVoicePanel'
import {
  formatDmSystemMetadata,
  formatDmSystemPrimaryText,
  parseDmSystemMessage,
} from './systemMessages'
import { PresenceDot } from '@/components/user/PresenceDot'
import type { DirectMessage, Identity } from '../../types/domain'
import { warnOnce } from '../../lib/devWarnings'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
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
  const selfIdentity = useConnectionStore((s) => s.identity)
  const conversations = useDmStore((s) => s.conversations)
  const usersByIdentity = useUsersStore((s) => s.byIdentity)
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
        }
      }),
    [messages, partner.displayName, selfIdentity, selfLabel],
  )

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
        <Avatar className="size-8 rounded-lg">
          {partner.avatarUrl ? <AvatarImage src={partner.avatarUrl} alt={partner.displayName} /> : null}
          <AvatarFallback className="rounded-lg bg-primary/15 text-xs">{toInitials(partnerIdentity)}</AvatarFallback>
        </Avatar>
        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium">{partner.displayName}</p>
            <PresenceDot status={partner.status} />
          </div>
          <p className="text-xs text-muted-foreground">Direct conversation with @{partner.username}</p>
        </div>
      </header>

      <div className="border-b border-border/70 p-3">
        <DmVoicePanel partnerIdentity={partnerIdentity} />
      </div>

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
      <div className="px-3 pb-2">
        <TypingIndicator scopeKey={typingScopeKey} selfIdentity={selfIdentity} />
      </div>
    </section>
  )
}
