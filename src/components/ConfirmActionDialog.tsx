import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

export function ConfirmActionDialog({ open, title, description, action, onClose, onConfirm, returnFocus }: {
  open: boolean; title: string; description: string; action: string
  onClose: () => void; onConfirm: () => Promise<void> | void
  returnFocus?: React.RefObject<HTMLElement | null>
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return <Dialog open={open} onOpenChange={next => { if (!next && !pending) { setError(null); onClose() } }}>
    <DialogContent finalFocus={returnFocus}>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button autoFocus variant="outline" disabled={pending} onClick={() => { setError(null); onClose() }}>Cancel</Button>
        <Button variant="destructive" disabled={pending} onClick={async () => {
          if (pending) return
          setPending(true)
          setError(null)
          try { await onConfirm(); onClose() }
          catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not complete this action. Try again.') }
          finally { setPending(false) }
        }}>{pending ? 'Working…' : action}</Button>
      </div>
    </DialogContent>
  </Dialog>
}
