import { useEffect, useRef } from 'react'
import { SendHorizonalIcon } from 'lucide-react'
import { reducers } from '../../lib/spacetimedb'
import type { Identity } from '../../types/domain'
import { TypingIndicator } from './TypingIndicator'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type ChatComposerProps = {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => Promise<void> | void
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
  const typingSentRef = useRef(false)
  const lastTypingPulseMsRef = useRef(0)

  const emitTypingState = (isTyping: boolean) => {
    if (!typingScopeKey || !typingIdentity) return
    void reducers.setTypingState(typingScopeKey, isTyping).catch(() => undefined)
  }

  useEffect(() => {
    if (!textareaRef.current) return
    textareaRef.current.style.height = 'auto'
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`
  }, [value])

  useEffect(() => {
    if (!typingScopeKey || !typingIdentity || disabled) return
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
  }, [disabled, typingIdentity, typingScopeKey, value])

  useEffect(() => {
    if (!disabled || !typingSentRef.current) return
    emitTypingState(false)
    typingSentRef.current = false
  }, [disabled, typingIdentity, typingScopeKey])

  useEffect(
    () => () => {
      if (!typingSentRef.current) return
      emitTypingState(false)
      typingSentRef.current = false
    },
    [typingIdentity, typingScopeKey],
  )

  return (
    <form
      className="space-y-2 p-3"
      onSubmit={async (event) => {
        event.preventDefault()
        if (disabled) return
        const trimmed = value.trim()
        if (!trimmed) return
        await onSubmit(trimmed)
        if (typingSentRef.current) {
          emitTypingState(false)
          typingSentRef.current = false
        }
      }}
    >
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
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
        disabled={disabled}
        className="min-h-12 resize-none overflow-y-auto"
      />
      {disabled ? <p className="text-xs text-muted-foreground">{disabledHint}</p> : (helperText ? <p className="text-xs text-muted-foreground">{helperText}</p> : null)}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {typingScopeKey ? (
            <TypingIndicator scopeKey={typingScopeKey} selfIdentity={typingIdentity} className="max-w-full" />
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <p className="text-xs text-muted-foreground">
            {value.length >= 3500 ? `${value.length}/${maxLength}` : 'Shift+Enter for newline'}
          </p>
          <Button type="submit" disabled={disabled}>
            <SendHorizonalIcon className="size-4" />
            {sendLabel}
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  )
}
