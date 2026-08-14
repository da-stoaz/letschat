import { BellIcon, ServerIcon, ShieldCheckIcon, UserRoundIcon } from 'lucide-react'
import { AccountTab } from './AccountTab'
import { SecurityTab } from './SecurityTab'
import { ConnectionTab } from './ConnectionTab'
import { NotificationsTab } from './NotificationsTab'
import { useConnectionStore } from '../../stores/connectionStore'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function SettingsPanel() {
  const identity = useConnectionStore((s) => s.identity)

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account, secure access, inspect the server connection, and control notifications.
        </p>
      </header>

      <Tabs defaultValue="account" className="space-y-3">
        <TabsList className="w-full">
          <TabsTrigger value="account" className="flex-1 min-w-0">
            <UserRoundIcon className="size-3.5" />
            Account
          </TabsTrigger>
          <TabsTrigger value="security" className="flex-1 min-w-0">
            <ShieldCheckIcon className="size-3.5" />
            Security
          </TabsTrigger>
          <TabsTrigger value="connection" className="flex-1 min-w-0">
            <ServerIcon className="size-3.5" />
            Connection
          </TabsTrigger>
          <TabsTrigger value="notifications" className="flex-1 min-w-0">
            <BellIcon className="size-3.5" />
            Notifications
          </TabsTrigger>
        </TabsList>

        <TabsContent value="account">
          <AccountTab />
        </TabsContent>

        <TabsContent value="security">
          <SecurityTab />
        </TabsContent>

        <TabsContent value="connection">
          <div className="space-y-3">
            {/* ConnectionTab is shared with the setup/auth screen, where no
                identity exists yet — so the identity row lives here, not in it. */}
            <ConnectionTab />
            {identity ? (
              <div className="space-y-1 rounded-lg border border-border/70 bg-muted/20 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Your identity</p>
                <p className="break-all font-mono text-xs text-muted-foreground">{identity}</p>
              </div>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="notifications">
          <NotificationsTab />
        </TabsContent>
      </Tabs>
    </section>
  )
}
