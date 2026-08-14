import { BellIcon, ServerIcon, ShieldCheckIcon, UserRoundIcon } from 'lucide-react'
import { AccountTab } from './AccountTab'
import { SecurityTab } from './SecurityTab'
import { ConnectionTab } from './ConnectionTab'
import { NotificationsTab } from './NotificationsTab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function SettingsPanel() {
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
          <ConnectionTab />
        </TabsContent>

        <TabsContent value="notifications">
          <NotificationsTab />
        </TabsContent>
      </Tabs>
    </section>
  )
}
