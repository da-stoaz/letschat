import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { MinusIcon, PlusIcon, RotateCcwIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

type PreviewImage = {
  url: string
  fileName: string
}

type AttachmentImageLightboxProps = {
  image: PreviewImage | null
  onClose: () => void
}

const MIN_SCALE = 0.5
const MAX_SCALE = 4
const SCALE_STEP = 0.25

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(value.toFixed(2))))
}

export function AttachmentImageLightbox({ image, onClose }: AttachmentImageLightboxProps) {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    if (!image) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        setScale((previous) => clampScale(previous + SCALE_STEP))
        return
      }
      if (event.key === '-') {
        event.preventDefault()
        setScale((previous) => clampScale(previous - SCALE_STEP))
        return
      }
      if (event.key === '0') {
        event.preventDefault()
        setScale(1)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [image])

  const imageStyle = useMemo<CSSProperties>(() => {
    if (scale === 1) return {}
    return {
      width: `${Math.round(scale * 100)}%`,
      maxWidth: 'none',
      height: 'auto',
    }
  }, [scale])

  return (
    <Dialog open={image !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="!inset-0 !top-0 !left-0 !z-[80] !h-screen !w-screen !max-w-none !translate-x-0 !translate-y-0 !rounded-none !border-0 !p-0 !sm:max-w-none bg-black"
      >
        <DialogTitle className="sr-only">Image preview</DialogTitle>

        <div className="group relative h-full w-full overflow-auto">
          {image ? (
            <div className="flex min-h-full min-w-full items-center justify-center">
              <img
                src={image.url}
                alt={image.fileName}
                style={imageStyle}
                className="block max-h-screen max-w-screen select-none object-contain"
                draggable={false}
              />
            </div>
          ) : null}

          <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3 sm:top-4 sm:px-4">
            <div className="pointer-events-auto flex w-full max-w-4xl items-center gap-1 rounded-xl border border-white/20 bg-black/65 p-1 backdrop-blur">
              <p className="min-w-0 flex-1 truncate px-2 text-sm font-medium text-white">{image?.fileName}</p>

              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="text-white hover:bg-white/15"
                onClick={() => setScale((previous) => clampScale(previous - SCALE_STEP))}
                disabled={scale <= MIN_SCALE}
              >
                <MinusIcon className="size-4" />
                <span className="sr-only">Zoom out</span>
              </Button>

              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="min-w-16 text-white hover:bg-white/15"
                onClick={() => setScale(1)}
              >
                <RotateCcwIcon className="size-4" />
                Fit
              </Button>

              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="text-white hover:bg-white/15"
                onClick={() => setScale((previous) => clampScale(previous + SCALE_STEP))}
                disabled={scale >= MAX_SCALE}
              >
                <PlusIcon className="size-4" />
                <span className="sr-only">Zoom in</span>
              </Button>

              <div className="px-2 text-xs font-medium text-white/80">{Math.round(scale * 100)}%</div>

              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="text-white hover:bg-white/15"
                onClick={onClose}
              >
                <XIcon className="size-5" />
                <span className="sr-only">Close preview</span>
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
