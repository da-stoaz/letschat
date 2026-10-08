import { useCallback, useEffect, useRef } from 'react'
import { Loader2Icon, PaperclipIcon, SendHorizonalIcon, XIcon } from 'lucide-react'
import { reducers } from '../../lib/spacetimedb'
import { cancelUpload, isBlockedMimeType, type UploadScope } from '../../lib/uploads'
import type { Identity } from '../../types/domain'
import { EMPTY_DRAFT, useComposerStore, type QueuedFile, type UploadStage } from '../../stores/composerStore'
import { submitComposer, shouldSubmitOnEnter, type ChatComposerSubmitPayload } from './submitComposer'
import { useTouchInput } from '../../hooks/useTouchInput'
import { TypingIndicator } from './TypingIndicator'
import { getClipboardFiles } from './clipboardFiles'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

type ChatComposerProps = {
  scopeKey: string
  onSubmit: (payload: ChatComposerSubmitPayload) => Promise<void> | void
  /** Who may read the files attached here — see `UploadScope`. */
  uploadScope: UploadScope
  placeholder: string
  disabled?: boolean
  helperText?: string
  disabledHint?: string
  typingScopeKey?: string
  typingIdentity?: Identity | null
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
    case 'failed':
      return 'Failed'
    default:
      return ''
  }
}

export function ChatComposer({
  scopeKey,
  onSubmit,
  uploadScope,
  placeholder,
  disabled = false,
  helperText = '',
  disabledHint = 'This channel is read-only for members.',
  typingScopeKey,
  typingIdentity = null,
  maxLength = 4000,
  sendLabel = 'Send',
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const typingSentRef = useRef(false)
  const lastTypingPulseMsRef = useRef(0)
  const touch = useTouchInput()
  const draft = useComposerStore(s => s.drafts[scopeKey] ?? EMPTY_DRAFT)
  const { text: value, files: queuedFiles, stages: uploadStageByFileId, progress: uploadProgressByFileId, error: localError, submitting } = draft
  const updateDraft = (patch: Partial<typeof draft>) => useComposerStore.getState().update(scopeKey, patch)
  const setLocalError = (error: string | null) => updateDraft({ error })
  const setQueuedFiles = (update: (files: QueuedFile[]) => QueuedFile[]) => {
    const current = useComposerStore.getState().drafts[scopeKey] ?? EMPTY_DRAFT
    updateDraft({ files: update(current.files) })
  }

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
    if ((!disabled && !submitting) || !typingSentRef.current) return
    emitTypingState(false)
    typingSentRef.current = false
  }, [disabled, submitting, emitTypingState])

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
      className="shrink-0 space-y-2 border-t border-border/60 p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (disabled) return
        // Capture these props now; uploads can finish after this view changes.
        void submitComposer(scopeKey, uploadScope, onSubmit)
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
        <div className="flex max-h-[min(128px,calc(var(--app-height,100dvh)/4))] flex-wrap items-center gap-1.5 overflow-y-auto rounded-lg border border-border/70 bg-muted/20 p-1.5">
          {queuedFiles.map((entry) => {
            const stage = uploadStageByFileId[entry.id]
            const progressFraction = uploadProgressByFileId[entry.id] ?? 0
            const showProgress = stage === 'uploading' || stage === 'confirming'
            const progressPercent = Math.round(progressFraction * 100)
            return (
              <div
                key={entry.id}
                className="inline-flex max-w-full flex-col gap-1 rounded-md border border-border/70 bg-card px-2 py-1 text-xs"
              >
                <span className="inline-flex w-full min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate">{entry.file.name}</span>
                  <span className="shrink-0 text-muted-foreground">{formatFileSize(entry.file.size)}</span>
                  {stage ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      {stage !== 'done' && stage !== 'failed' ? <Loader2Icon className="size-3 animate-spin" /> : null}
                      {stageLabel(stage)}
                    </span>
                  ) : null}
                  {showProgress ? <span className="shrink-0 text-muted-foreground">{progressPercent}%</span> : null}
                  <button
                    type="button"
                    className="ml-auto inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    onClick={() => {
                      if (submitting) return
                      void cancelUpload(entry.file).catch(() => undefined)
                      setLocalError(null)
                      const current = useComposerStore.getState().drafts[scopeKey] ?? EMPTY_DRAFT
                      const stages = { ...current.stages }
                      const progress = { ...current.progress }
                      delete stages[entry.id]
                      delete progress[entry.id]
                      updateDraft({ files: current.files.filter(item => item.id !== entry.id), stages, progress })

                    }}
                    disabled={submitting}
                    aria-label={`Remove ${entry.file.name}`}
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </span>
                {showProgress ? (
                  <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary transition-all duration-150 ease-out"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      <Textarea
        ref={textareaRef}
        value={value}
        onPaste={(event) => {
          if (disabled || submitting) return
          const files = getClipboardFiles(event.clipboardData)
          if (files.length === 0) return
          // File clipboards can also contain filenames/URLs as text.
          event.preventDefault()
          tryQueueFiles(files)
        }}
        onChange={(event) => {
          setLocalError(null)
          updateDraft({ text: event.target.value })
        }}
        onBlur={() => {
          if (!typingSentRef.current) return
          emitTypingState(false)
          typingSentRef.current = false
        }}
        onKeyDown={(event) => {
          if (shouldSubmitOnEnter(event.key, event.shiftKey, event.nativeEvent.isComposing || event.keyCode === 229, touch)) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }}
        maxLength={maxLength}
        aria-label={placeholder}
        placeholder={placeholder}
        disabled={disabled || submitting}
        className="min-h-10 max-h-[min(180px,calc(var(--app-height,100dvh)/4))] resize-none overflow-y-auto"
      />
      {disabled ? <p className="text-xs text-muted-foreground">{disabledHint}</p> : (helperText ? <p className="text-xs text-muted-foreground">{helperText}</p> : null)}
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || submitting}
          onClick={() => fileInputRef.current?.click()}
        >
          <PaperclipIcon className="size-4" />
          Attach
        </Button>
        {typingScopeKey ? (
          <TypingIndicator
            scopeKey={typingScopeKey}
            selfIdentity={typingIdentity}
            className="min-w-0 truncate text-xs text-muted-foreground"
            fallbackText={value.length >= 3500 ? `${value.length}/${maxLength}` : ''}
          />
        ) : (
          <p className="truncate text-xs text-muted-foreground">
            {value.length >= 3500 ? `${value.length}/${maxLength}` : ''}
          </p>
        )}
        <Button
          type="submit"
          size="sm"
          className="ml-auto"
          disabled={disabled || submitting || (value.trim().length === 0 && queuedFiles.length === 0)}
        >
          {submitting ? <Loader2Icon className="size-4 animate-spin" /> : <SendHorizonalIcon className="size-4" />}
          {submitting ? 'Sending…' : sendLabel}
        </Button>
      </div>
      {localError ? <p role="alert" className="text-sm text-destructive">{localError}</p> : null}
    </form>
  )
}
