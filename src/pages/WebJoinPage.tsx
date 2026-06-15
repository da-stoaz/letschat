import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useServerConfigStore, parseJoinLink } from '../stores/serverConfigStore'
import { initializeSpacetime } from '../lib/spacetimedb'
import { SplashScreen } from '../components/SplashScreen'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/**
 * Browser equivalent of the desktop `letschat://join?…` deep link. A shared
 * invite link of the form `https://app.<domain>/join?s=…&a=…&l=…&d=…` lands
 * here; we parse the embedded {@link ServerConfig} with the same
 * {@link parseJoinLink} the desktop flow uses, connect, and route into the app.
 */
export function WebJoinPage() {
  const navigate = useNavigate()
  const setConfig = useServerConfigStore((s) => s.setConfig)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    void (async () => {
      const cfg = parseJoinLink(window.location.href)
      if (!cfg) {
        setError('This join link is missing connection details.')
        return
      }
      try {
        setConfig(cfg)
        await initializeSpacetime()
        navigate('/', { replace: true })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to connect to the server.')
      }
    })()
  }, [navigate, setConfig])

  if (error) {
    return (
      <main className="grid min-h-screen place-items-center p-4">
        <Card className="w-full max-w-md border-border/70 bg-card/90 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-base">Couldn't join the server</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button onClick={() => navigate('/setup', { replace: true })}>Choose a server manually</Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  return <SplashScreen />
}
