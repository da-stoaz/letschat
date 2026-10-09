import { useState } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './ui/button'

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
      toast.error('Could not copy', { description: 'Select the text and copy it manually.' })
    }
  }}>
    {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    {copied ? 'Copied!' : label}
  </Button>
}
