import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NoiseFilterSettings } from '../voice/components/NoiseFilterSettings'

export function AudioTab() {
  return <Card className="border-border/70 bg-muted/20">
    <CardHeader>
      <CardTitle className="text-base">Microphone audio</CardTitle>
      <CardDescription>Choose how your microphone sounds in calls. Both filters run on your device and process audio at 48 kHz.</CardDescription>
    </CardHeader>
    <CardContent className="max-w-lg"><NoiseFilterSettings /></CardContent>
  </Card>
}
