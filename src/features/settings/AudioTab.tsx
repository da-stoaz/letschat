import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NoiseFilterSettings } from '../voice/components/NoiseFilterSettings'
import { MasterVolumeControl } from '../voice/components/CallVolumeMixer'

export function AudioTab() {
  return <div className="space-y-4">
    <Card className="border-border/70 bg-muted/20">
      <CardHeader>
        <CardTitle className="text-base">Call playback</CardTitle>
      </CardHeader>
      <CardContent className="max-w-lg"><MasterVolumeControl /></CardContent>
    </Card>
    <Card className="border-border/70 bg-muted/20">
    <CardHeader>
      <CardTitle className="text-base">Microphone audio</CardTitle>
    </CardHeader>
    <CardContent className="max-w-lg"><NoiseFilterSettings /></CardContent>
  </Card></div>
}
