import { AccountTab } from './AccountTab'
import { ConnectionTab } from './ConnectionTab'
import { NotificationsTab } from './NotificationsTab'
import { AudioTab } from './AudioTab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function SettingsPanel() {
  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      </header>

      <Tabs defaultValue="account" className="space-y-3">
        <TabsList className="w-full flex-wrap">
          <TabsTrigger value="account" className="flex-1">Account</TabsTrigger>
          <TabsTrigger value="connection" className="flex-1">Connection</TabsTrigger>
          <TabsTrigger value="notifications" className="flex-1">Notifications</TabsTrigger>
          <TabsTrigger value="audio" className="flex-1">Audio</TabsTrigger>
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
        <TabsContent value="audio">
          <AudioTab />
        </TabsContent>
      </Tabs>
    </section>
  )
}
