import { useMemo, useState } from 'react'
import { PhoneCallIcon, PhoneMissedIcon, PhoneOffIcon, PencilIcon, PinIcon, PinOffIcon, Trash2Icon, MoreHorizontalIcon, Loader2Icon } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useTouchInput } from '../../hooks/useTouchInput'
import { shouldSubmitOnEnter } from '../chat/submitComposer'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PresenceDot } from '@/components/user/PresenceDot'
import { useUserPresentation } from '../../hooks/useUserPresentation'
import { userInitials } from '../../layouts/app-layout/helpers'
import { MessageAttachmentList } from '../chat/MessageAttachmentList'
import { composeMessageWithAttachments, parseMessageAttachments } from '../chat/attachmentPayload'

export interface RenderableMessage {
  id: number
  senderIdentity: string
  content: string
  sentAt: string
  editedAt: string | null
  deleted: boolean
  systemKind?: 'call_started' | 'call_ended' | null
  systemMeta?: string | null
  systemMissed?: boolean
}

export interface MessageGroup {
  id: string
  senderIdentity: string
  messages: RenderableMessage[]
}

interface MessageBubbleProps {
  group: MessageGroup
  canModerate: boolean
  allowEditOwn?: boolean
  selfIdentity: string | null
  highlightMessageId?: number | null
  pinnedMessageIds?: Set<number> | null
  onTogglePin?: (message: RenderableMessage, pinned: boolean) => void
  onEditMessage: (message: RenderableMessage, newContent: string) => Promise<void> | void
  onDeleteMessage: (message: RenderableMessage) => void
}

function sameIdentity(left: string, right: string | null): boolean {
  if (!right) return false
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function MessageBubble({
  group,
  canModerate,
  allowEditOwn = true,
  selfIdentity,
  highlightMessageId = null,
  pinnedMessageIds = null,
  onTogglePin,
  onEditMessage,
  onDeleteMessage,
}: MessageBubbleProps) {
  const touch = useTouchInput()
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const sender = useUserPresentation(group.senderIdentity)
  const firstMessage = group.messages[0]
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const isSystemGroup =
    group.messages.length > 0 &&
    group.messages.every((message) => Boolean(message.systemKind))

  const canDeleteGroupMessage = useMemo(
    () =>
      group.messages.reduce<Record<number, boolean>>((acc, message) => {
        acc[message.id] = canModerate || sameIdentity(message.senderIdentity, selfIdentity)
        return acc
      }, {}),
    [canModerate, group.messages, selfIdentity],
  )

  if (isSystemGroup) {
    const systemIcon =
      firstMessage.systemKind === 'call_started' ? (
        <PhoneCallIcon className="size-3.5 text-emerald-400" />
      ) : firstMessage.systemMissed ? (
        <PhoneMissedIcon className="size-3.5 text-red-400" />
      ) : (
        <PhoneOffIcon className="size-3.5 text-muted-foreground" />
      )

    return (
      <article className="px-3 py-1.5">
        <div className="flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
            {systemIcon}
            {firstMessage.content}
          </span>
        </div>
        {firstMessage.systemMeta ? (
          <p className="mt-1 text-center text-[11px] text-muted-foreground/80">{firstMessage.systemMeta}</p>
        ) : null}
      </article>
    )
  }

  return (
    <article className="group/bubble rounded-lg px-3 py-1 transition-colors hover:bg-muted/35">
      <div className="flex items-start gap-3.5">
        <Avatar className="mt-0.5 size-9 rounded-full">
          {sender.avatarUrl ? <AvatarImage src={sender.avatarUrl} alt={sender.displayName} /> : null}
          <AvatarFallback className="rounded-full bg-primary/10 text-xs">{userInitials(sender.displayName)}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 break-words text-sm font-semibold">{sender.displayName}</span>
            <PresenceDot status={sender.status} />
            <span className="text-xs text-muted-foreground">{formatTimestamp(firstMessage.sentAt)}</span>
          </div>

          <div className="space-y-1">
            {group.messages.map((message) => {
              const isOwn = sameIdentity(message.senderIdentity, selfIdentity)
              const canEdit = allowEditOwn && isOwn && !message.deleted
              const canDelete = canDeleteGroupMessage[message.id]
              const isPinned = pinnedMessageIds?.has(message.id) ?? false
              const canPin = Boolean(onTogglePin) && canModerate && !message.deleted
              const parsed = parseMessageAttachments(message.content)
              const hasText = parsed.text.trim().length > 0

              const isEditing = editingId === message.id

              const submitEdit = async () => {
                if (saving) return
                const trimmed = editDraft.trim()
                if (!trimmed && parsed.attachments.length === 0) return
                setSaving(true)
                setEditError(null)
                try {
                  await onEditMessage(message, composeMessageWithAttachments(trimmed, parsed.attachments))
                  setEditingId(null)
                  setEditDraft('')
                } catch (error) {
                  setEditError(error instanceof Error ? error.message : 'Could not save message.')
                } finally {
                  setSaving(false)
                }
              }

              const cancelEdit = () => {
                setEditingId(null)
                setEditDraft('')
                setEditError(null)
              }

              const isHighlighted = highlightMessageId != null && message.id === highlightMessageId

              return (
                <div
                  key={message.id}
                  data-message-id={message.id}
                  className={`group/message relative rounded-md transition-colors ${touch && !message.deleted && !isEditing && (canEdit || canDelete || canPin) ? 'pr-11 min-h-11' : ''} ${
                    isHighlighted ? 'bg-primary/15 ring-1 ring-primary/40' : ''
                  }`}
                >
                  {message.deleted ? (
                    <p className="text-sm italic text-muted-foreground">[message deleted]</p>
                  ) : isEditing ? (
                    <div className="space-y-1.5 py-0.5">
                      <Textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (shouldSubmitOnEnter(e.key, e.shiftKey, e.nativeEvent.isComposing || e.keyCode === 229, touch)) { e.preventDefault(); void submitEdit() }
                          if (e.key === 'Escape' && !saving && !e.nativeEvent.isComposing) cancelEdit()
                        }}
                        className="min-h-0"
                        aria-label="Edit message"
                        disabled={saving}
                        autoFocus
                      />
                      <div className="flex items-center gap-2">
                        <Button size="sm" disabled={saving || (!editDraft.trim() && !parsed.attachments.length)} onClick={() => void submitEdit()}>{saving ? <Loader2Icon className="size-4 animate-spin" /> : null}{saving ? 'Saving…' : 'Save'}</Button>
                        <Button size="sm" variant="ghost" disabled={saving} onClick={cancelEdit}>Cancel</Button>
                      </div>
                      {editError ? <p role="alert" className="text-sm text-destructive">{editError}</p> : null}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <MessageAttachmentList messageKey={`${message.senderIdentity}:${message.sentAt}:${message.id}`} attachments={parsed.attachments} />
                      {hasText ? (
                        <div className="message-content prose prose-invert min-w-0 max-w-none break-words text-sm text-foreground prose-p:my-0 prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-pre:rounded prose-pre:border prose-pre:border-border/70 prose-pre:bg-muted/70 prose-a:text-sky-400 hover:prose-a:text-sky-300">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
                            }}
                          >
                            {parsed.text}
                          </ReactMarkdown>
                        </div>
                      ) : null}
                    </div>
                  )}
                  {!message.deleted && !isEditing && message.editedAt ? <span className="ml-1 text-xs text-muted-foreground">[edited]</span> : null}
                  {!isEditing && isPinned ? (
                    <span className="ml-1 inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                      <PinIcon className="size-3" />
                    </span>
                  ) : null}

                  {!isEditing && !message.deleted && touch && (canEdit || canDelete || canPin) ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="absolute top-0 right-0" aria-label="Message actions" />}><MoreHorizontalIcon className="size-4" /></DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        {canEdit ? <DropdownMenuItem onClick={() => { setEditingId(message.id); setEditDraft(parsed.text); setEditError(null) }}><PencilIcon />Edit message</DropdownMenuItem> : null}
                        {canPin ? <DropdownMenuItem onClick={() => onTogglePin?.(message, !isPinned)}>{isPinned ? <PinOffIcon /> : <PinIcon />}{isPinned ? 'Unpin message' : 'Pin message'}</DropdownMenuItem> : null}
                        {canDelete ? <DropdownMenuItem variant="destructive" onClick={() => onDeleteMessage(message)}><Trash2Icon />Delete message</DropdownMenuItem> : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                  {!isEditing && !message.deleted && !touch && (canEdit || canDelete || canPin) ? (
                    <div className="absolute -top-3 right-1 flex items-center gap-0.5 rounded-md border border-border/70 bg-popover/95 p-0.5 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100">
                      {canPin ? (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={isPinned ? 'Unpin message' : 'Pin message'}
                          onClick={() => onTogglePin?.(message, !isPinned)}
                        >
                          {isPinned ? <PinOffIcon className="size-3.5" /> : <PinIcon className="size-3.5" />}
                        </Button>
                      ) : null}
                      {canEdit ? (
                        <Button size="icon-xs" variant="ghost" aria-label="Edit message" onClick={() => {
                          setEditingId(message.id)
                          setEditDraft(parsed.text)
                          setEditError(null)
                        }}>
                          <PencilIcon className="size-3.5" />
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <Button size="icon-xs" variant="ghost" aria-label="Delete message" onClick={() => onDeleteMessage(message)}>
                          <Trash2Icon className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </article>
  )
}
