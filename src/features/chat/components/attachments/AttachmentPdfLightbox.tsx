import { useEffect, useState } from 'react'
import { Loader2Icon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

type PreviewPdf = {
  url: string
  fileName: string
}

type AttachmentPdfLightboxProps = {
  pdf: PreviewPdf | null
  onClose: () => void
}

export function AttachmentPdfLightbox({ pdf, onClose }: AttachmentPdfLightboxProps) {
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!pdf) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pdf, onClose])

  return (
    <Dialog open={pdf !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="attachment-lightbox !inset-0 !top-[var(--app-top,0px)] !left-0 !z-[80] !h-[var(--app-height,100dvh)] !w-screen !max-w-none !translate-x-0 !translate-y-0 !rounded-none !border-0 !pt-[env(safe-area-inset-top)] !pr-[env(safe-area-inset-right)] !pb-[env(safe-area-inset-bottom)] !pl-[env(safe-area-inset-left)] !sm:max-w-none bg-background"
      >
        <DialogTitle className="sr-only">PDF preview</DialogTitle>

        <div className="flex h-full min-h-0 w-full flex-col bg-background">
          <div className="z-20 flex shrink-0 items-center gap-2 border-b border-border/70 bg-background/95 px-3 py-2 backdrop-blur-sm sm:px-4">
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{pdf?.fileName ?? 'PDF preview'}</p>
            <Button type="button" size="icon-sm" variant="ghost" onClick={onClose}>
              <XIcon className="size-5" />
              <span className="sr-only">Close preview</span>
            </Button>
          </div>

          <div className="min-h-0 w-full flex-1">
            {pdf ? (
              <div className="relative h-full w-full">
                {isLoading ? (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70">
                    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background/95 px-3 py-2 text-sm text-muted-foreground">
                      <Loader2Icon className="size-4 animate-spin" />
                      Loading PDF preview...
                    </div>
                  </div>
                ) : null}

                <iframe
                  key={pdf.url}
                  title={pdf.fileName}
                  src={pdf.url}
                  className="h-full w-full border-0"
                  onLoad={() => setIsLoading(false)}
                />
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
