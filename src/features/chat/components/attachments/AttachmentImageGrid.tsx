import { ImageIcon, Loader2Icon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AttachmentImageGridItem = {
  storageKey: string
  fileName: string
  url: string | null
  loading: boolean
  error: string | null
}

type AttachmentImageGridProps = {
  items: AttachmentImageGridItem[]
  onOpen: (index: number) => void
  onRetry: (storageKey: string) => void
}

function tileClassName(total: number, index: number): string {
  const isOddLast = total > 2 && total % 2 === 1 && index === total - 1
  return cn(
    'group relative overflow-hidden rounded-md border border-border/60 bg-background/60',
    total === 2 ? 'aspect-[4/3]' : 'aspect-square',
    isOddLast && 'col-span-2 aspect-[16/9]',
  )
}

export function AttachmentImageGrid({ items, onOpen, onRetry }: AttachmentImageGridProps) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-1.5">
      <div className="mb-1 flex items-center justify-between px-1">
        <p className="text-xs font-medium text-muted-foreground">{items.length} images</p>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {items.map((item, index) => (
          <button
            key={item.storageKey}
            type="button"
            className={tileClassName(items.length, index)}
            onClick={() => onOpen(index)}
          >
            {item.url ? (
              <img
                src={item.url}
                alt={item.fileName}
                className="h-full w-full object-cover transition-transform duration-150 group-hover:scale-[1.015]"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center">
                {item.loading ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : <ImageIcon className="size-4 text-muted-foreground" />}
                <p className="line-clamp-2 text-xs text-muted-foreground">{item.loading ? 'Loading image…' : item.error ?? 'Image unavailable'}</p>
                {item.error ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onRetry(item.storageKey)
                    }}
                    className="rounded border border-border/70 px-2 py-0.5 text-[11px] text-foreground"
                  >
                    Retry
                  </button>
                ) : null}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
