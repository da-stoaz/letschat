import { useServerConfigStore, type ServerConfig } from '../stores/serverConfigStore'
import { initializeSpacetime } from '../lib/spacetimedb'
import { DiscoverTab } from './setup/DiscoverTab'
import { JoinLinkTab } from './setup/JoinLinkTab'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GlobeIcon, QrCodeIcon } from 'lucide-react'

export function SetupPage() {
  const setConfig = useServerConfigStore((s) => s.setConfig)

  const handleConnect = async (cfg: ServerConfig) => {
    setConfig(cfg)
    await initializeSpacetime()
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(1200px_800px_at_10%_-20%,theme(colors.blue.500/20),transparent),radial-gradient(900px_700px_at_100%_0%,theme(colors.cyan.500/15),transparent)] p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">LetsChat</h1>
          <p className="text-sm text-muted-foreground">Connect to your server to get started.</p>
        </div>

        <Card className="border-border/70 bg-card/90 backdrop-blur">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Connect to a server</CardTitle>
            <CardDescription className="text-xs">
              LetsChat is self-hosted — every friend group runs their own instance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="url">
              <TabsList className="w-full">
                <TabsTrigger value="url" className="flex-1">
                  <GlobeIcon className="size-3.5 mr-1.5" />
                  Server URL
                </TabsTrigger>
                <TabsTrigger value="link" className="flex-1">
                  <QrCodeIcon className="size-3.5 mr-1.5" />
                  Join Link
                </TabsTrigger>
              </TabsList>

              <TabsContent value="url">
                <DiscoverTab onConnect={handleConnect} />
              </TabsContent>

              <TabsContent value="link">
                <JoinLinkTab onConnect={handleConnect} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
