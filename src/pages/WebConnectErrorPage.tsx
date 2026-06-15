import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LoaderCircleIcon } from 'lucide-react'
import { useState } from 'react'

/**
 * Shown when a hosted-web build can't reach its own instance (discovery failed).
 * The web client is single-tenant and locked to this deployment, so — unlike the
 * desktop Setup screen — it offers only a retry, never a "pick a server" picker.
 */
export function WebConnectErrorPage() {
  const [retrying, setRetrying] = useState(false)

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-md border-border/70 bg-card/90 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-base">Can't reach the server</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            LetsChat couldn't connect to this instance. It may be temporarily down — please try
            again in a moment.
          </p>
          <Button
            onClick={() => {
              setRetrying(true)
              window.location.reload()
            }}
            disabled={retrying}
          >
            {retrying && <LoaderCircleIcon className="size-3.5 animate-spin" />}
            {retrying ? 'Retrying…' : 'Retry'}
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
