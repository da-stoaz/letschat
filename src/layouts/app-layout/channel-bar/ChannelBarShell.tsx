import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export function ChannelBarShell({
  header,
  children,
}: {
  header: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="flex h-full min-h-0 min-w-0 flex-col border-border/60 bg-card/80 backdrop-blur max-md:hidden py-0 gap-0">
      <CardHeader className="shrink-0 space-y-3 py-3">{header}</CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-hidden p-3">{children}</CardContent>
    </Card>
  )
}
