import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogInIcon, UserRoundPlusIcon } from 'lucide-react'
import {
  getCurrentSessionToken,
  loginWithPassword,
  reducers,
  rotateIdentityForRegistration,
  spacetimedbClient,
} from '../lib/spacetimedb'
import { authServiceRegister } from '../lib/authService'
import { useSelfStore } from '../stores/selfStore'
import { useConnectionStore } from '../stores/connectionStore'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function AuthPage() {
  const navigate = useNavigate()
  const user = useSelfStore((s) => s.user)
  const setUser = useSelfStore((s) => s.setUser)
  const connectionStatus = useConnectionStore((s) => s.status)
  const identity = useConnectionStore((s) => s.identity)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
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
          <CardDescription>Sign in with your persisted account credentials.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(value) => setMode(value as 'login' | 'register')} className="mb-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Log In</TabsTrigger>
              <TabsTrigger value="register">Register</TabsTrigger>
            </TabsList>
          </Tabs>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault()
              setError(null)
              try {
                const normalizedUsername = username.trim().toLowerCase()
                if (password.length < 8) {
                  throw new Error('Password must be at least 8 characters.')
                }

                if (mode === 'register') {
                  if (displayName.trim().length < 1) {
                    throw new Error('Display name is required.')
                  }
                  if (password !== confirmPassword) {
                    throw new Error('Passwords do not match.')
                  }

                  const registerOnce = async (): Promise<string | null> => {
                    await rotateIdentityForRegistration()
                    await reducers.registerUser(normalizedUsername, displayName.trim())
                    const sessionToken = getCurrentSessionToken()
                    const sessionIdentity = useConnectionStore.getState().identity
                    if (!sessionToken || !sessionIdentity) {
                      throw new Error('Could not obtain active Spacetime session for registration.')
                    }
                    await authServiceRegister({
                      username: normalizedUsername,
                      displayName: displayName.trim(),
                      password,
                      spacetimeToken: sessionToken,
                      spacetimeIdentity: sessionIdentity,
                    })
                    return sessionIdentity
                  }

                  let registeredIdentity: string | null = null
                  try {
                    registeredIdentity = await registerOnce()
                  } catch (registerError) {
                    const message = registerError instanceof Error ? registerError.message : String(registerError)
                    if (!message.includes('user already registered for this identity')) {
                      throw registerError
                    }
                    registeredIdentity = await registerOnce()
                  }

                  let currentIdentity = registeredIdentity ?? useConnectionStore.getState().identity ?? identity
                  if (!currentIdentity) {
                    await spacetimedbClient.connect()
                    currentIdentity = useConnectionStore.getState().identity
                  }

                  if (currentIdentity) {
                    setUser({
                      identity: currentIdentity,
                      username: normalizedUsername,
                      displayName: displayName.trim(),
                      avatarUrl: null,
                      createdAt: new Date().toISOString(),
                    })
                  } else {
                    throw new Error('Registration succeeded but session identity is missing. Please retry.')
                  }
                } else {
                  await loginWithPassword(normalizedUsername, password)
                }

                navigate('/app', { replace: true })
              } catch (e) {
                const message = e instanceof Error ? e.message : 'Authentication failed.'
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
            {mode === 'register' ? (
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
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="auth-password">Password</Label>
              <Input
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
                placeholder="Password"
              />
            </div>
            {mode === 'register' ? (
              <div className="space-y-2">
                <Label htmlFor="auth-password-confirm">Confirm Password</Label>
                <Input
                  id="auth-password-confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={8}
                  required
                  placeholder="Confirm password"
                />
              </div>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex items-center justify-end gap-2">
              <Button type="submit" className="min-w-36">
                {mode === 'register' ? <UserRoundPlusIcon className="size-4" /> : <LogInIcon className="size-4" />}
                {mode === 'register' ? 'Create Account' : 'Log In'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  )
}
