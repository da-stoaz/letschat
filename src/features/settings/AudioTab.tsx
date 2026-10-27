import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NoiseFilterSettings } from '../voice/components/NoiseFilterSettings'
import { MasterVolumeControl } from '../voice/components/CallVolumeMixer'

export function AudioTab() {
  return <div className="space-y-4">
    <Card className="border-border/70 bg-muted/20">
      <CardHeader>
        <CardTitle className="text-base">Call playback</CardTitle>
        <CardDescription>Adjust voice and stream audio together. Use Volume in a call to adjust individual people.</CardDescription>
      </CardHeader>
      <CardContent className="max-w-lg"><MasterVolumeControl /></CardContent>
    </Card>
    <Card className="border-border/70 bg-muted/20">
    <CardHeader>
      <CardTitle className="text-base">Microphone audio</CardTitle>
      <CardDescription>Choose how your microphone sounds in calls. Both filters run on your device and process audio at 48 kHz.</CardDescription>
    </CardHeader>
    <CardContent className="max-w-lg"><NoiseFilterSettings /></CardContent>
  </Card></div>
}
