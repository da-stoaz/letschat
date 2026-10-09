import { useEffect, useMemo, useState } from 'react'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, MinusIcon, PlusIcon, RotateCcwIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { downloadAttachment } from '@/lib/attachmentDownload'
import { useReducedMotion } from '@/hooks/useReducedMotion'

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

function normalizeIndex(index: number, length: number): number {
  if (length <= 0) return 0
  const value = index % length
  return value < 0 ? value + length : value
}

export function AttachmentImageLightbox({ images, initialIndex, onClose }: AttachmentImageLightboxProps) {
  const reducedMotion = useReducedMotion()
  const animationTime = reducedMotion ? 0 : 200
  const [activeIndex, setActiveIndex] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [zoomScale, setZoomScale] = useState(1)
  const open = initialIndex !== null

  // Adjust-state-during-render (react.dev "You Might Not Need an Effect"):
  // when the lightbox opens on a new image, reset position and zoom before
  // paint instead of one frame late in an effect.
  const [lastInitialIndex, setLastInitialIndex] = useState(initialIndex)
  if (initialIndex !== lastInitialIndex) {
    setLastInitialIndex(initialIndex)
    if (initialIndex !== null) {
      setActiveIndex(normalizeIndex(initialIndex, images.length))
      setZoomScale(1)
    }
  }

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === 'ArrowRight' || event.code === 'ArrowRight') {
        event.preventDefault()
        setActiveIndex((previous) => normalizeIndex(previous + 1, images.length))
        return
      }
      if (event.key === 'ArrowLeft' || event.code === 'ArrowLeft') {
        event.preventDefault()
        setActiveIndex((previous) => normalizeIndex(previous - 1, images.length))
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [images.length, open])

  const activeImage = useMemo(() => {
    if (images.length === 0) return null
    return images[normalizeIndex(activeIndex, images.length)] ?? null
  }, [activeIndex, images])

  const onNavigate = (direction: 1 | -1) => {
    setActiveIndex((previous) => normalizeIndex(previous + direction, images.length))
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="attachment-lightbox !inset-0 !top-[var(--app-top,0px)] !left-0 !z-[80] !h-[var(--app-height,100dvh)] !w-screen !max-w-none !translate-x-0 !translate-y-0 !rounded-none !border-0 !pt-[env(safe-area-inset-top)] !pr-[env(safe-area-inset-right)] !pb-[env(safe-area-inset-bottom)] !pl-[env(safe-area-inset-left)] !sm:max-w-none bg-black"
      >
        <DialogTitle className="sr-only">Image preview</DialogTitle>

        <TransformWrapper
          key={activeImage?.url ?? `image-${activeIndex}`}
          minScale={MIN_SCALE}
          maxScale={MAX_SCALE}
          initialScale={1}
          centerOnInit
          limitToBounds
          centerZoomedOut
          smooth={!reducedMotion}
          zoomAnimation={{ disabled: reducedMotion }}
          autoAlignment={{ animationTime, velocityAlignmentTime: animationTime }}
          velocityAnimation={{ disabled: reducedMotion }}
          doubleClick={{ disabled: true }}
          wheel={{ step: 0.2 }}
          pinch={{ step: 5 }}
          panning={{ velocityDisabled: true }}
          onTransform={(_ref, next) => {
            setZoomScale(next.scale)
          }}
        >
          {({ zoomIn, zoomOut, resetTransform }) => (
            <div className="group relative h-full w-full overflow-auto">
              {activeImage ? (
                <div className="flex min-h-full min-w-full items-center justify-center px-6 py-24 sm:px-8 sm:py-16">
                  {activeImage.url ? (
                    <TransformComponent
                      wrapperStyle={{
                        width: 'calc(100dvw - 3rem)',
                        height: 'max(100px, calc(var(--app-height, 100dvh) - 12rem))',
                      }}
                      contentStyle={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <img
                        src={activeImage.url}
                        alt={activeImage.fileName}
                        className="block h-full w-full select-none object-contain"
                        draggable={false}
                      />
                    </TransformComponent>
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
                <div className="pointer-events-auto flex w-full max-w-4xl flex-wrap items-center gap-1 rounded-xl border border-white/20 bg-black/65 p-1 backdrop-blur">
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
                    className="text-white hover:bg-white/15 sm:order-last"
                    onClick={onClose}
                  >
                    <XIcon className="size-5" />
                    <span className="sr-only">Close preview</span>
                  </Button>
                  <div className="flex w-full items-center justify-center gap-1 sm:w-auto">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="text-white hover:bg-white/15"
                    onClick={() => zoomOut(undefined, animationTime)}
                    disabled={zoomScale <= MIN_SCALE}
                  >
                    <MinusIcon className="size-4" />
                    <span className="sr-only">Zoom out</span>
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="min-w-16 text-white hover:bg-white/15"
                    onClick={() => resetTransform(animationTime)}
                  >
                    <RotateCcwIcon className="size-4" />
                    Fit
                  </Button>

                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="text-white hover:bg-white/15"
                    onClick={() => zoomIn(undefined, animationTime)}
                    disabled={zoomScale >= MAX_SCALE}
                  >
                    <PlusIcon className="size-4" />
                    <span className="sr-only">Zoom in</span>
                  </Button>

                  <div className="hidden px-2 text-xs font-medium text-white/80 sm:block">{Math.round(zoomScale * 100)}%</div>

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
                      } catch {
                        // The shared download helper reports failures; keep the preview open.
                      } finally {
                        setIsSaving(false)
                      }
                    }}
                  >
                    <DownloadIcon className="size-4" />
                    {isSaving ? 'Saving…' : 'Save'}
                  </Button>
                  </div>


                </div>
              </div>
            </div>
          )}
        </TransformWrapper>
      </DialogContent>
    </Dialog>
  )
}
