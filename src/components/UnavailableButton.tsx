import { useId, type ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * A control this device can't use at all: no camera, or a runtime without the
 * API. Plain `disabled` means "not right now" (still connecting) and fades the
 * control. This one keeps full contrast with a dashed outline, stays focusable
 * and gives the reason on hover, on focus and to screen readers.
 */
export function UnavailableButton({ reason, className, ...props }: Omit<ComponentProps<typeof Button>, 'disabled' | 'onClick'> & { reason: string }) {
  const id = useId()
  return <>
    <Tooltip>
      <TooltipTrigger render={<Button {...props} disabled focusableWhenDisabled aria-describedby={id} className={cn(
        'cursor-not-allowed border-dashed border-border bg-transparent text-muted-foreground hover:bg-transparent hover:text-muted-foreground dark:bg-transparent dark:hover:bg-transparent',
        className,
      )} />} />
      <TooltipContent className="max-w-60">{reason}</TooltipContent>
    </Tooltip>
    <span id={id} hidden>{reason}</span>
  </>
}
