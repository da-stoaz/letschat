import { BellIcon, ServerIcon, UserRoundIcon } from 'lucide-react'
import { AccountTab } from './AccountTab'
import { ConnectionTab } from './ConnectionTab'
import { NotificationsTab } from './NotificationsTab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function SettingsPanel() {
  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      </header>

      <Tabs defaultValue="account" className="space-y-3">
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="account" className="flex-none">
            <UserRoundIcon className="size-3.5" />
            Account
          </TabsTrigger>
          <TabsTrigger value="connection" className="flex-none">
            <ServerIcon className="size-3.5" />
            Connection
          </TabsTrigger>
          <TabsTrigger value="notifications" className="flex-none">
            <BellIcon className="size-3.5" />
            Notifications
          </TabsTrigger>
        </TabsList>

        <TabsContent value="account" keepMounted>
          <AccountTab />
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
