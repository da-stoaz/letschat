import { useMemo } from 'react'
import { PencilIcon, Trash2Icon } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { PresenceDot } from '@/components/user/PresenceDot'
import { useUserPresentation } from '../../hooks/useUserPresentation'
import { userInitials } from '../../layouts/app-layout/helpers'

export interface RenderableMessage {
  id: number
  senderIdentity: string
  content: string
  sentAt: string
  editedAt: string | null
  deleted: boolean
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
  onEditMessage: (message: RenderableMessage) => void
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
  onEditMessage,
  onDeleteMessage,
}: MessageBubbleProps) {
  const sender = useUserPresentation(group.senderIdentity)
  const firstMessage = group.messages[0]

  const canDeleteGroupMessage = useMemo(
    () =>
      group.messages.reduce<Record<number, boolean>>((acc, message) => {
        acc[message.id] = canModerate || sameIdentity(message.senderIdentity, selfIdentity)
        return acc
      }, {}),
    [canModerate, group.messages, selfIdentity],
  )

  return (
    <article className="group/bubble rounded-lg px-2 py-1 transition-colors hover:bg-muted/35">
      <div className="flex items-start gap-3">
        <Avatar className="mt-0.5 size-8 rounded-lg">
          {sender.avatarUrl ? <AvatarImage src={sender.avatarUrl} alt={sender.displayName} /> : null}
          <AvatarFallback className="rounded-lg bg-primary/10 text-xs">{userInitials(sender.displayName)}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm font-semibold">{sender.displayName}</span>
            <PresenceDot status={sender.status} />
            <span className="text-xs text-muted-foreground">{formatTimestamp(firstMessage.sentAt)}</span>
          </div>

          <div className="space-y-1">
            {group.messages.map((message) => {
              const isOwn = sameIdentity(message.senderIdentity, selfIdentity)
              const canEdit = allowEditOwn && isOwn && !message.deleted
              const canDelete = canDeleteGroupMessage[message.id]

              return (
                <div key={message.id} className="group/message relative rounded-md pr-16">
                  {message.deleted ? (
                    <p className="text-sm italic text-muted-foreground">[message deleted]</p>
                  ) : (
                    <div className="prose prose-invert max-w-none break-words text-sm text-foreground prose-p:my-0 prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-pre:rounded prose-pre:border prose-pre:border-border/70 prose-pre:bg-muted/70 prose-a:text-sky-400 hover:prose-a:text-sky-300">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  )}
                  {message.editedAt ? <span className="ml-1 text-xs text-muted-foreground">[edited]</span> : null}

                  {(canEdit || canDelete) ? (
                    <div className="absolute right-0 top-0 flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100">
                      {canEdit ? (
                        <Button size="icon-xs" variant="ghost" onClick={() => onEditMessage(message)}>
                          <PencilIcon className="size-3.5" />
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <Button size="icon-xs" variant="ghost" onClick={() => onDeleteMessage(message)}>
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
