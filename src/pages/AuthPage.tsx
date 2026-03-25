import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogInIcon, UserRoundPlusIcon } from 'lucide-react'
import { reducers, spacetimedbClient } from '../lib/spacetimedb'
import { useSelfStore } from '../stores/selfStore'
import { useConnectionStore } from '../stores/connectionStore'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function AuthPage() {
  const navigate = useNavigate()
  const user = useSelfStore((s) => s.user)
  const connectionStatus = useConnectionStore((s) => s.status)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (user) navigate('/app', { replace: true })
  }, [navigate, user])

  useEffect(() => {
    if (connectionStatus !== 'disconnected') return
    void spacetimedbClient.connect()
  }, [connectionStatus])

  return (
    <section className="grid min-h-screen place-items-center bg-[radial-gradient(1200px_800px_at_10%_-20%,theme(colors.blue.500/25),transparent),radial-gradient(900px_700px_at_100%_0%,theme(colors.cyan.500/20),transparent)] p-4">
      <Card className="w-full max-w-md border-border/70 bg-card/90 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-2xl">LetsChat</CardTitle>
          <CardDescription>Create your local profile and start chatting.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault()
              setError(null)
              try {
                await reducers.registerUser(username.trim(), displayName.trim())
                navigate('/app', { replace: true })
              } catch (e) {
                const message = e instanceof Error ? e.message : 'Could not register user.'
                setError(message)
              }
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="auth-username">Username</Label>
              <Input
                id="auth-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                minLength={2}
                maxLength={32}
                required
                placeholder="username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="auth-display-name">Display Name</Label>
              <Input
                id="auth-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                placeholder="Display Name"
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex items-center justify-end gap-2">
              <Button type="submit" className="min-w-36">
                <UserRoundPlusIcon className="size-4" />
                Continue
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate('/app', { replace: true })}>
                <LogInIcon className="size-4" />
                Open App
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  )
}
