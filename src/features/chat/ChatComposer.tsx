import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2Icon, PaperclipIcon, SendHorizonalIcon, XIcon } from 'lucide-react'
import { reducers } from '../../lib/spacetimedb'
import { MAX_UPLOAD_FILE_SIZE_BYTES, isBlockedMimeType, uploadFiles } from '../../lib/uploads'
import type { Identity } from '../../types/domain'
import type { ChatMessageAttachment } from '../../types/attachments'
import { TypingIndicator } from './TypingIndicator'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/sonner'

type UploadStage = 'requesting' | 'uploading' | 'confirming' | 'done'

type QueuedFile = {
  id: string
  file: File
}

export type ChatComposerSubmitPayload = {
  text: string
  attachments: ChatMessageAttachment[]
}

type ChatComposerProps = {
  value: string
  onChange: (value: string) => void
  onSubmit: (payload: ChatComposerSubmitPayload) => Promise<void> | void
  placeholder: string
  disabled?: boolean
  helperText?: string
  disabledHint?: string
  typingScopeKey?: string
  typingIdentity?: Identity | null
  error?: string | null
  maxLength?: number
  sendLabel?: string
}

function fileIdentity(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(precision)} ${units[index]}`
}

function stageLabel(stage: UploadStage): string {
  switch (stage) {
    case 'requesting':
      return 'Requesting URL…'
    case 'uploading':
      return 'Uploading…'
    case 'confirming':
      return 'Finalizing…'
    case 'done':
      return 'Uploaded'
    default:
      return ''
  }
}

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
  helperText = '',
  disabledHint = 'This channel is read-only for members.',
  typingScopeKey,
  typingIdentity = null,
  error = null,
  maxLength = 4000,
  sendLabel = 'Send',
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const typingSentRef = useRef(false)
  const lastTypingPulseMsRef = useRef(0)
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([])
  const [uploadStageByFileId, setUploadStageByFileId] = useState<Record<string, UploadStage>>({})
  const [localError, setLocalError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const emitTypingState = useCallback((isTyping: boolean) => {
    if (!typingScopeKey || !typingIdentity) return
    void reducers.setTypingState(typingScopeKey, isTyping).catch(() => undefined)
  }, [typingIdentity, typingScopeKey])

  useEffect(() => {
    if (!textareaRef.current) return
    textareaRef.current.style.height = 'auto'
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`
  }, [value])

  useEffect(() => {
    if (!typingScopeKey || !typingIdentity || disabled || submitting) return
    const hasContent = value.trim().length > 0
    const now = Date.now()

    if (hasContent) {
      if (!typingSentRef.current || now - lastTypingPulseMsRef.current >= 2000) {
        emitTypingState(true)
        typingSentRef.current = true
        lastTypingPulseMsRef.current = now
      }
      return
    }

    if (typingSentRef.current) {
      emitTypingState(false)
      typingSentRef.current = false
    }
  }, [disabled, emitTypingState, submitting, typingIdentity, typingScopeKey, value])

  useEffect(() => {
    if (!disabled || !typingSentRef.current) return
    emitTypingState(false)
    typingSentRef.current = false
  }, [disabled, emitTypingState])

  useEffect(
    () => () => {
      if (!typingSentRef.current) return
      emitTypingState(false)
      typingSentRef.current = false
    },
    [emitTypingState],
  )

  const tryQueueFiles = (files: File[]) => {
    if (files.length === 0) return

    setLocalError(null)
    const rejectedReasons: string[] = []
    const accepted: File[] = []

    for (const file of files) {
      const mimeType = file.type?.trim().toLowerCase() ?? ''
      if (file.size <= 0) {
        rejectedReasons.push(`${file.name}: empty file`)
        continue
      }
      if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
        rejectedReasons.push(`${file.name}: exceeds ${Math.round(MAX_UPLOAD_FILE_SIZE_BYTES / 1024 / 1024)} MB`)
        continue
      }
      if (mimeType && isBlockedMimeType(mimeType)) {
        rejectedReasons.push(`${file.name}: blocked file type`)
        continue
      }
      accepted.push(file)
    }

    setQueuedFiles((current) => {
      const existing = new Set(current.map((entry) => fileIdentity(entry.file)))
      const nextEntries = [...current]
      for (const file of accepted) {
        const identity = fileIdentity(file)
        if (existing.has(identity)) continue
        nextEntries.push({
          id: identity,
          file,
        })
        existing.add(identity)
      }
      return nextEntries
    })

    if (rejectedReasons.length > 0) {
      toast.error('Some files were not added', {
        description: rejectedReasons.slice(0, 3).join(' • '),
      })
    }
  }

  return (
    <form
      className="space-y-2 p-3"
      onSubmit={async (event) => {
        event.preventDefault()
        if (disabled || submitting) return
        const trimmed = value.trim()
        if (!trimmed && queuedFiles.length === 0) return

        setLocalError(null)
        setSubmitting(true)
        try {
          const uploads = queuedFiles.map((entry) => entry.file)
          const attachments =
            uploads.length > 0
              ? await uploadFiles(uploads, (file, stage) => {
                  const id = fileIdentity(file)
                  setUploadStageByFileId((current) => ({ ...current, [id]: stage }))
                })
              : []

          await onSubmit({ text: trimmed, attachments })
          setQueuedFiles([])
          setUploadStageByFileId({})
          if (fileInputRef.current) {
            fileInputRef.current.value = ''
          }

          if (typingSentRef.current) {
            emitTypingState(false)
            typingSentRef.current = false
          }
        } catch (submitError) {
          const message = submitError instanceof Error ? submitError.message : 'Could not send message.'
          setLocalError(message)
        } finally {
          setSubmitting(false)
        }
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          tryQueueFiles(files)
          event.currentTarget.value = ''
        }}
      />

      {queuedFiles.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/20 p-2">
          {queuedFiles.map((entry) => {
            const stage = uploadStageByFileId[entry.id]
            return (
              <span
                key={entry.id}
                className="inline-flex max-w-full items-center gap-2 rounded-md border border-border/70 bg-card px-2 py-1 text-xs"
              >
                <span className="truncate">{entry.file.name}</span>
                <span className="shrink-0 text-muted-foreground">{formatFileSize(entry.file.size)}</span>
                {stage ? (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    {stage !== 'done' ? <Loader2Icon className="size-3 animate-spin" /> : null}
                    {stageLabel(stage)}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  onClick={() => {
                    if (submitting) return
                    setLocalError(null)
                    setQueuedFiles((current) => current.filter((item) => item.id !== entry.id))
                    setUploadStageByFileId((current) => {
                      const next = { ...current }
                      delete next[entry.id]
                      return next
                    })
                  }}
                  disabled={submitting}
                  aria-label={`Remove ${entry.file.name}`}
                >
                  <XIcon className="size-3.5" />
                </button>
              </span>
            )
          })}
        </div>
      ) : null}

      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          setLocalError(null)
          onChange(event.target.value)
        }}
        onBlur={() => {
          if (!typingSentRef.current) return
          emitTypingState(false)
          typingSentRef.current = false
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled || submitting}
        className="min-h-12 resize-none overflow-y-auto"
      />
      {disabled ? <p className="text-xs text-muted-foreground">{disabledHint}</p> : (helperText ? <p className="text-xs text-muted-foreground">{helperText}</p> : null)}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {typingScopeKey ? (
            <TypingIndicator scopeKey={typingScopeKey} selfIdentity={typingIdentity} className="max-w-full" />
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={disabled || submitting}
            onClick={() => fileInputRef.current?.click()}
          >
            <PaperclipIcon className="size-4" />
            Attach
          </Button>
          <p className="text-xs text-muted-foreground">
            {value.length >= 3500 ? `${value.length}/${maxLength}` : 'Shift+Enter for newline'}
          </p>
          <Button type="submit" disabled={disabled || submitting || (value.trim().length === 0 && queuedFiles.length === 0)}>
            {submitting ? <Loader2Icon className="size-4 animate-spin" /> : <SendHorizonalIcon className="size-4" />}
            {submitting ? 'Sending…' : sendLabel}
          </Button>
        </div>
      </div>
      {localError ? <p className="text-sm text-destructive">{localError}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  )
}
