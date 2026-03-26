import { useEffect, useRef } from 'react'
import { SendHorizonalIcon } from 'lucide-react'
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
  helperText = 'Typing indicator coming soon.',
  disabledHint = 'This channel is read-only for members.',
  error = null,
  maxLength = 4000,
  sendLabel = 'Send',
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!textareaRef.current) return
    textareaRef.current.style.height = 'auto'
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`
  }, [value])

  return (
    <form
      className="space-y-2 p-3"
      onSubmit={async (event) => {
        event.preventDefault()
        if (disabled) return
        const trimmed = value.trim()
        if (!trimmed) return
        await onSubmit(trimmed)
      }}
    >
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
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
      {disabled ? <p className="text-xs text-muted-foreground">{disabledHint}</p> : <p className="text-xs text-muted-foreground">{helperText}</p>}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{value.length >= 3500 ? `${value.length}/${maxLength}` : 'Shift+Enter for newline'}</p>
        <Button type="submit" disabled={disabled}>
          <SendHorizonalIcon className="size-4" />
          {sendLabel}
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  )
}
