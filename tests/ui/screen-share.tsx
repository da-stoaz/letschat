import './noise-filter-storage'
import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Room } from 'livekit-client'
import { ScreenShareMenu } from '../../src/features/voice/components/ScreenShareMenu'
import { screenShareOptions } from '../../src/lib/screenShare'
import { useMediaDeviceStore } from '../../src/stores/mediaDeviceStore'
import '../../src/index.css'

document.documentElement.classList.add('dark')
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export function Fixture() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState('Ready. Synthetic screen only; no microphone, real screen capture, or backend.')
  const quality = useMediaDeviceStore(s => s.screenShareQuality)
  const output = useRef<HTMLVideoElement>(null)

  async function run() {
    setRunning(true)
    setResult('Starting a synthetic LiveKit screen track and local WebRTC connection…')
    const options = screenShareOptions(quality, false)
    const { width, height, frameRate } = options.capture.resolution!
    const fps = Number(frameRate)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')!
    let animation = 0
    let frame = 0
    const draw = () => {
      context.fillStyle = '#101827'
      context.fillRect(0, 0, width, height)
      context.fillStyle = '#55ddaa'
      context.fillRect((frame * 15) % width, height / 3, width / 8, height / 3)
      context.font = `${height / 12}px sans-serif`
      context.fillText(`Frame ${frame++}`, 30, height / 6)
      animation = requestAnimationFrame(draw)
    }
    draw()
    const stream = canvas.captureStream(fps)
    const send = new RTCPeerConnection({ iceServers: [] })
    const receive = new RTCPeerConnection({ iceServers: [] })
    const originalCapture = navigator.mediaDevices.getDisplayMedia
    let track: MediaStreamTrack | undefined
    try {
      let captured: DisplayMediaStreamOptions | undefined
      navigator.mediaDevices.getDisplayMedia = async constraints => { captured = constraints; return stream }
      const [local] = await new Room().localParticipant.createScreenTracks(options.capture)
      navigator.mediaDevices.getDisplayMedia = originalCapture
      track = local.mediaStreamTrack
      if ((captured?.video as MediaTrackConstraints).frameRate !== fps) throw new Error('SDK capture FPS did not match the selection.')
      send.onicecandidate = event => { if (event.candidate) void receive.addIceCandidate(event.candidate) }
      receive.onicecandidate = event => { if (event.candidate) void send.addIceCandidate(event.candidate) }
      receive.ontrack = event => { if (output.current) { output.current.srcObject = new MediaStream([event.track]); void output.current.play() } }
      const transceiver = send.addTransceiver(track, { direction: 'sendonly', sendEncodings: [options.publish.screenShareEncoding!] })
      const codecs = RTCRtpSender.getCapabilities('video')!.codecs.filter(codec => codec.mimeType.toLowerCase() === 'video/vp8')
      transceiver.setCodecPreferences(codecs)
      await send.setLocalDescription(await send.createOffer())
      await receive.setRemoteDescription(send.localDescription!)
      await receive.setLocalDescription(await receive.createAnswer())
      await send.setRemoteDescription(receive.localDescription!)
      const deadline = Date.now() + 15_000
      while (send.connectionState !== 'connected') {
        if (Date.now() > deadline) throw new Error('Local WebRTC connection timed out.')
        await delay(50)
      }
      const parameters = transceiver.sender.getParameters()
      parameters.degradationPreference = options.publish.degradationPreference
      await transceiver.sender.setParameters(parameters)
      await delay(2_000)
      const sample = async () => {
        const reports = await receive.getStats()
        return Array.from(reports.values()).find(report => report.type === 'inbound-rtp' && report.kind === 'video')
      }
      const before = await sample()
      const sourceBefore = frame
      if (!before) throw new Error('No received video stats.')
      await delay(4_000)
      const after = await sample()
      const measured = (after.framesDecoded - before.framesDecoded) * 1000 / (after.timestamp - before.timestamp)
      if (measured < fps * 0.65) {
        const outgoing = Array.from((await send.getStats()).values()).find(report => report.type === 'outbound-rtp' && report.kind === 'video')
        throw new Error(`Received ${after.frameWidth} × ${after.frameHeight} at ${measured.toFixed(1)} FPS; requested ${fps}. Source draw rate ${((frame - sourceBefore) / 4).toFixed(1)} FPS. Encoder limitation: ${outgoing?.qualityLimitationReason}.`)
      }
      setResult(`PASS: ${quality}, received ${after.frameWidth} × ${after.frameHeight} at ${measured.toFixed(1)} FPS. Capture and encoder target ${fps} FPS.`)
    } catch (error) { setResult(`FAIL: ${error instanceof Error ? error.message : String(error)}`) }
    finally {
      navigator.mediaDevices.getDisplayMedia = originalCapture
      cancelAnimationFrame(animation)
      track?.stop()
      stream.getTracks().forEach(track => track.stop())
      send.close()
      receive.close()
      setRunning(false)
    }
  }
  return <main className="mx-auto max-w-3xl space-y-4 p-6">
    <h1 className="text-xl font-semibold">Screen sharing verification</h1>
    <div className="flex items-center gap-3"><span>Selected: {quality}</span><ScreenShareMenu size="default" showLabel sharing={false} disabled={running} onToggle={run} /></div>
    <p role="status">{result}</p>
    <video ref={output} muted autoPlay playsInline className="aspect-video w-full rounded border bg-black" />
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
