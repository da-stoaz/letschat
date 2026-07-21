import { useMemo, useState } from 'react'
import { SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useUserPresentation } from '../../hooks/useUserPresentation'
import { parseMessageAttachments } from '../chat/attachmentPayload'
import type { Message } from '../../types/domain'

const MAX_RESULTS = 50
const SNIPPET_CONTEXT = 24

interface SearchResult {
  id: number
  senderIdentity: string
  sentAt: string
  text: string
  matchIndex: number
  matchLength: number
}

function buildResults(messages: Message[], rawQuery: string): SearchResult[] {
  const query = rawQuery.trim().toLowerCase()
  if (query.length === 0) return []

  const results: SearchResult[] = []
  // newest first — most recent matches are usually what people look for
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.deleted) continue
    const { text } = parseMessageAttachments(message.content)
    if (text.trim().length === 0) continue
    const matchIndex = text.toLowerCase().indexOf(query)
    if (matchIndex < 0) continue
    results.push({
      id: message.id,
      senderIdentity: message.senderIdentity,
      sentAt: message.sentAt,
      text,
      matchIndex,
      matchLength: rawQuery.trim().length,
    })
    if (results.length >= MAX_RESULTS) break
  }
  return results
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function SearchResultRow({ result, onJump }: { result: SearchResult; onJump: (messageId: number) => void }) {
  const author = useUserPresentation(result.senderIdentity)

  const start = Math.max(0, result.matchIndex - SNIPPET_CONTEXT)
  const before = (start > 0 ? '…' : '') + result.text.slice(start, result.matchIndex)
  const match = result.text.slice(result.matchIndex, result.matchIndex + result.matchLength)
  const afterStart = result.matchIndex + result.matchLength
  const after = result.text.slice(afterStart, afterStart + SNIPPET_CONTEXT * 2) + (result.text.length > afterStart + SNIPPET_CONTEXT * 2 ? '…' : '')

  return (
    <button
      type="button"
      onClick={() => onJump(result.id)}
      className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold">{author.displayName}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{formatTimestamp(result.sentAt)}</span>
      </div>
      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
        {before}
        <mark className="rounded bg-primary/25 px-0.5 text-foreground">{match}</mark>
        {after}
      </p>
    </button>
  )
}

export function ChannelMessageSearch({
  messages,
  onJump,
}: {
  messages: Message[]
  onJump: (messageId: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const results = useMemo(() => buildResults(messages, query), [messages, query])
  const trimmed = query.trim()

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-xs" aria-label="Search messages">
            <SearchIcon className="size-3.5" />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 gap-2">
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search this channel…"
          className="h-8"
        />
        <div className="max-h-72 overflow-y-auto app-scrollbar">
          {trimmed.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">Type to search loaded messages.</p>
          ) : results.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">No matches found.</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {results.map((result) => (
                <SearchResultRow
                  key={result.id}
                  result={result}
                  onJump={(messageId) => {
                    onJump(messageId)
                    setOpen(false)
                    setQuery('')
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
