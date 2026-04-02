import { SettingsPanel } from '../features/settings/SettingsPanel'
import { Card, CardContent } from '@/components/ui/card'

export function SettingsPage() {
  return (
    <Card className="h-full border-border/70 bg-card/70">
      <CardContent className="h-full overflow-auto p-4">
        <SettingsPanel />
      </CardContent>
    </Card>
  )
}
