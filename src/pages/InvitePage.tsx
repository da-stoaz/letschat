import { useParams } from 'react-router-dom'
import { reducers } from '../lib/spacetimedb'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TicketIcon } from 'lucide-react'

export function InvitePage() {
  const { token = '' } = useParams()

  return (
    <section className="grid min-h-screen place-items-center bg-[radial-gradient(1200px_800px_at_10%_-20%,theme(colors.blue.500/25),transparent),radial-gradient(900px_700px_at_100%_0%,theme(colors.cyan.500/20),transparent)] p-4">
      <Card className="w-full max-w-md border-border/70 bg-card/90 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TicketIcon className="size-5 text-primary" />
            Server Invite
          </CardTitle>
          <CardDescription>Join via the invite token below.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <pre className="overflow-x-auto rounded-md border border-border/70 bg-muted/40 p-3 text-xs text-muted-foreground">
            {token}
          </pre>
          <Button onClick={() => reducers.useInvite(token)}>Join Server</Button>
        </CardContent>
      </Card>
    </section>
  )
}
