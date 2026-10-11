import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { loadTextPreview } from './textPreview'

export function AttachmentTextPreview({ file, onClose }: {
  file: { url: string; fileName: string }
  onClose: () => void
}) {
  const [result, setResult] = useState<{ text: string; truncated: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void loadTextPreview(file.url, controller.signal).then(
      value => { if (!controller.signal.aborted) setResult(value) },
      reason => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load text preview.')
      },
    )
    return () => controller.abort()
  }, [file.url, attempt])

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="flex h-[80dvh] min-h-0 flex-col sm:max-w-4xl">
        <DialogTitle className="shrink-0 truncate pr-8">{file.fileName}</DialogTitle>
        {error ? (
          <div className="space-y-2">
            <p role="alert" className="text-destructive">{error}</p>
            <Button variant="outline" onClick={() => { setError(null); setAttempt(value => value + 1) }}>Retry</Button>
          </div>
        ) : result ? (
          <>
            {result.truncated ? <p className="text-muted-foreground">Showing the first 1 MiB. Save the file to read the rest.</p> : null}
            <pre tabIndex={0} aria-label="File contents" className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 font-mono text-sm select-text">{result.text || 'This file is empty.'}</pre>
          </>
        ) : <p role="status" className="text-muted-foreground">Loading text preview…</p>}
      </DialogContent>
    </Dialog>
  )
}
