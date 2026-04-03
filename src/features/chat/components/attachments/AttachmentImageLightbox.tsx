import { useEffect, useMemo, useRef, useState, type TouchEventHandler } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, MinusIcon, PlusIcon, RotateCcwIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { downloadAttachment } from '@/lib/attachmentDownload'

type PreviewImage = {
  url: string | null
  fileName: string
  loading?: boolean
  error?: string | null
}

type AttachmentImageLightboxProps = {
  images: PreviewImage[]
  initialIndex: number | null
  onClose: () => void
}

const MIN_SCALE = 0.5
const MAX_SCALE = 4
const SCALE_STEP = 0.25

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(value.toFixed(2))))
}

function normalizeIndex(index: number, length: number): number {
  if (length <= 0) return 0
  const value = index % length
  return value < 0 ? value + length : value
}

export function AttachmentImageLightbox({ images, initialIndex, onClose }: AttachmentImageLightboxProps) {
  const [scale, setScale] = useState(1)
  const [activeIndex, setActiveIndex] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const pinchStartDistanceRef = useRef<number | null>(null)
  const pinchStartScaleRef = useRef(1)
  const open = initialIndex !== null

  useEffect(() => {
    if (!open || initialIndex === null) return
    setActiveIndex(normalizeIndex(initialIndex, images.length))
    setScale(1)
  }, [images.length, initialIndex, open])

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const key = event.key
      const code = event.code

      if (key === 'ArrowRight' || code === 'ArrowRight') {
        event.preventDefault()
        setActiveIndex((previous) => normalizeIndex(previous + 1, images.length))
        return
      }
      if (key === 'ArrowLeft' || code === 'ArrowLeft') {
        event.preventDefault()
        setActiveIndex((previous) => normalizeIndex(previous - 1, images.length))
        return
      }
      if (key === '+' || key === '=') {
        event.preventDefault()
        setScale((previous) => clampScale(previous + SCALE_STEP))
        return
      }
      if (key === '-') {
        event.preventDefault()
        setScale((previous) => clampScale(previous - SCALE_STEP))
        return
      }
      if (key === '0') {
        event.preventDefault()
        setScale(1)
      }
    }

    // Capture-phase listener avoids focus-trap handlers swallowing arrow keys.
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [images.length, open])

  const activeImage = useMemo(() => {
    if (images.length === 0) return null
    return images[normalizeIndex(activeIndex, images.length)] ?? null
  }, [activeIndex, images])

  const onNavigate = (direction: 1 | -1) => {
    setActiveIndex((previous) => normalizeIndex(previous + direction, images.length))
    setScale(1)
  }

  const onTouchStart: TouchEventHandler<HTMLDivElement> = (event) => {
    if (event.touches.length !== 2) return
    const [first, second] = event.touches
    const deltaX = second.clientX - first.clientX
    const deltaY = second.clientY - first.clientY
    pinchStartDistanceRef.current = Math.hypot(deltaX, deltaY)
    pinchStartScaleRef.current = scale
  }

  const onTouchMove: TouchEventHandler<HTMLDivElement> = (event) => {
    if (event.touches.length !== 2) return
    const startDistance = pinchStartDistanceRef.current
    if (!startDistance || startDistance <= 0) return
    const [first, second] = event.touches
    const deltaX = second.clientX - first.clientX
    const deltaY = second.clientY - first.clientY
    const nextDistance = Math.hypot(deltaX, deltaY)
    const ratio = nextDistance / startDistance
    setScale(clampScale(pinchStartScaleRef.current * ratio))
    event.preventDefault()
  }

  const onTouchEnd: TouchEventHandler<HTMLDivElement> = (event) => {
    if (event.touches.length >= 2) return
    pinchStartDistanceRef.current = null
    pinchStartScaleRef.current = scale
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="!inset-0 !top-0 !left-0 !z-[80] !h-screen !w-screen !max-w-none !translate-x-0 !translate-y-0 !rounded-none !border-0 !p-0 !sm:max-w-none bg-black"
      >
        <DialogTitle className="sr-only">Image preview</DialogTitle>

        <div
          className="group relative h-full w-full overflow-auto touch-none"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        >
          {activeImage ? (
            <div className="flex min-h-full min-w-full items-center justify-center px-6 py-16 sm:px-8">
              {activeImage.url ? (
                <img
                  src={activeImage.url}
                  alt={activeImage.fileName}
                  style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}
                  className="block max-h-[calc(100dvh-8rem)] max-w-[calc(100dvw-3rem)] select-none object-contain transition-transform duration-150 ease-out"
                  draggable={false}
                />
              ) : (
                <div className="rounded-lg border border-white/20 bg-black/55 px-4 py-3 text-sm text-white/85">
                  {activeImage.loading ? 'Loading image…' : activeImage.error ?? 'Image unavailable'}
                </div>
              )}
            </div>
          ) : null}

          {images.length > 1 ? (
            <>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/20 bg-black/55 text-white hover:bg-black/75"
                onClick={() => onNavigate(-1)}
              >
                <ChevronLeftIcon className="size-5" />
                <span className="sr-only">Previous image</span>
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/20 bg-black/55 text-white hover:bg-black/75"
                onClick={() => onNavigate(1)}
              >
                <ChevronRightIcon className="size-5" />
                <span className="sr-only">Next image</span>
              </Button>
            </>
          ) : null}

          <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3 sm:top-4 sm:px-4">
            <div className="pointer-events-auto flex w-full max-w-4xl items-center gap-1 rounded-xl border border-white/20 bg-black/65 p-1 backdrop-blur">
              <p className="min-w-0 flex-1 truncate px-2 text-sm font-medium text-white">
                {activeImage?.fileName ?? 'Image preview'}
              </p>
              {images.length > 1 ? (
                <span className="px-1 text-xs text-white/75">
                  {normalizeIndex(activeIndex, images.length) + 1}/{images.length}
                </span>
              ) : null}

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
                size="sm"
                variant="ghost"
                className="text-white hover:bg-white/15"
                disabled={!activeImage?.url || isSaving}
                onClick={async () => {
                  if (!activeImage?.url) return
                  setIsSaving(true)
                  try {
                    await downloadAttachment({
                      url: activeImage.url,
                      fileName: activeImage.fileName,
                    })
                  } finally {
                    setIsSaving(false)
                  }
                }}
              >
                <DownloadIcon className="size-4" />
                {isSaving ? 'Saving…' : 'Save'}
              </Button>

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
