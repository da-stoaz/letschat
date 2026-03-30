import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { reducers } from '../lib/spacetimedb'
import { useServersStore } from '../stores/serversStore'
import { useConnectionStore } from '../stores/connectionStore'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ServerIcon, CheckIcon, XIcon, LoaderCircleIcon } from 'lucide-react'

export function InvitePage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'idle' | 'joining' | 'joined' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const selfIdentity = useConnectionStore((s) => s.identity)
  const isAuthenticated = Boolean(selfIdentity)

  const handleJoin = async () => {
    setStatus('joining')
    setErrorMsg(null)
    try {
      await reducers.useInvite(token)
      setStatus('joined')

      // Wait a moment for the sync to propagate, then redirect
      setTimeout(() => {
        const servers = useServersStore.getState().servers
        // Find the server we just joined (last added)
        if (servers.length > 0) {
          const latest = servers[servers.length - 1]
          navigate(`/app/${latest.id}`)
        } else {
          navigate('/app')
        }
      }, 800)
    } catch (e) {
      setStatus('error')
      setErrorMsg(e instanceof Error ? e.message : 'Failed to join server.')
    }
  }

  return (
    <section className="grid min-h-screen place-items-center bg-[radial-gradient(1200px_800px_at_10%_-20%,--theme(--color-blue-500/25),transparent),radial-gradient(900px_700px_at_100%_0%,--theme(--color-cyan-500/20),transparent)] p-4">
      <div className="w-full max-w-md space-y-4">
        <Card className="border-border/70 bg-card/90 backdrop-blur-sm">
          <CardHeader className="text-center pb-3">
            <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
              <ServerIcon className="size-7 text-primary" />
            </div>
            <CardTitle className="text-xl">You've been invited!</CardTitle>
            <CardDescription>
              You have an invite to join a server on LetsChat.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-center space-y-1">
              <p className="text-xs text-muted-foreground">Invite token</p>
              <code className="text-sm font-mono text-primary">{token}</code>
            </div>

            {status === 'joined' && (
              <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/20 p-3 text-green-600 dark:text-green-400 text-sm">
                <CheckIcon className="size-4 shrink-0" />
                Joined! Redirecting…
              </div>
            )}

            {status === 'error' && errorMsg && (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-destructive text-sm">
                <XIcon className="size-4 shrink-0" />
                {errorMsg}
              </div>
            )}
          </CardContent>

          <CardFooter className="flex flex-col gap-2">
            {!isAuthenticated ? (
              <>
                <p className="text-sm text-muted-foreground text-center mb-1">
                  You need to be signed in to join a server.
                </p>
                <Button className="w-full" onClick={() => navigate(`/auth?redirect=/invite/${token}`)}>
                  Sign in to join
                </Button>
              </>
            ) : status === 'joined' ? (
              <Button className="w-full" variant="secondary" onClick={() => navigate('/app')}>
                Go to app
              </Button>
            ) : (
              <Button
                className="w-full"
                disabled={status === 'joining'}
                onClick={handleJoin}
              >
                {status === 'joining' ? (
                  <>
                    <LoaderCircleIcon className="size-4 animate-spin" />
                    Joining…
                  </>
                ) : (
                  <>
                    <CheckIcon className="size-4" />
                    Accept Invite
                  </>
                )}
              </Button>
            )}
            <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => navigate('/app')}>
              <XIcon className="size-4" />
              Decline
            </Button>
          </CardFooter>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          By accepting, you agree to abide by the server rules.
        </p>
      </div>
    </section>
  )
}
