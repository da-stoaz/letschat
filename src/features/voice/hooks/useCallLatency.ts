import { useEffect, useState } from 'react'
import { ConnectionQuality, ConnectionState, type Room } from 'livekit-client'

const LATENCY_POLL_INTERVAL_MS = 2_000

export type CallLatency = {
  /** Round-trip time to the media server in milliseconds, or null if unknown. */
  rttMs: number | null
  /** Server-computed qualitative connection quality. */
  quality: ConnectionQuality
}

/**
 * The WebRTC peer-connection plumbing LiveKit exposes on `room.engine` is not
 * part of the public typings, so we reach into it defensively. Any shape change
 * in a future SDK simply degrades to "no RTT" rather than throwing.
 */
type StatsCapableTransport = {
  getStats?: () => Promise<RTCStatsReport>
}

type EngineLike = {
  pcManager?: {
    publisher?: StatsCapableTransport
    subscriber?: StatsCapableTransport
  }
}

type RoomWithEngine = Room & { engine?: EngineLike }

function readCandidatePairRtt(report: RTCStatsReport): number | null {
  let rttSeconds: number | null = null
  report.forEach((stat) => {
    if (stat.type !== 'candidate-pair') return
    const candidatePair = stat as RTCStats & {
      nominated?: boolean
      selected?: boolean
      state?: string
      currentRoundTripTime?: number
    }
    const isActive = candidatePair.nominated || candidatePair.selected || candidatePair.state === 'succeeded'
    if (!isActive) return
    if (typeof candidatePair.currentRoundTripTime !== 'number') return
    rttSeconds = candidatePair.currentRoundTripTime
  })
  return rttSeconds === null ? null : Math.round((rttSeconds as number) * 1000)
}

async function measureRoomRtt(room: RoomWithEngine): Promise<number | null> {
  if (room.state !== ConnectionState.Connected) return null
  const transports = [room.engine?.pcManager?.subscriber, room.engine?.pcManager?.publisher]
  for (const transport of transports) {
    if (typeof transport?.getStats !== 'function') continue
    try {
      const report = await transport.getStats()
      const rtt = readCandidatePairRtt(report)
      if (rtt !== null) return rtt
    } catch {
      // Try the next transport; fall through to null.
    }
  }
  return null
}

/**
 * Tracks live call latency (RTT to the media server) and connection quality for
 * a LiveKit room. Returns null RTT when no call is active or stats are
 * unavailable in the current runtime.
 */
export function useCallLatency(room: Room | null): CallLatency {
  const [rttMs, setRttMs] = useState<number | null>(null)
  const [quality, setQuality] = useState<ConnectionQuality>(ConnectionQuality.Unknown)

  useEffect(() => {
    let cancelled = false

    if (!room) {
      // Defer the reset out of the synchronous effect body.
      queueMicrotask(() => {
        if (cancelled) return
        setRttMs(null)
        setQuality(ConnectionQuality.Unknown)
      })
      return () => {
        cancelled = true
      }
    }

    queueMicrotask(() => {
      if (!cancelled) setQuality(room.localParticipant.connectionQuality)
    })

    const onQualityChanged = (nextQuality: ConnectionQuality) => {
      if (!cancelled) setQuality(nextQuality)
    }
    room.localParticipant.on('connectionQualityChanged', onQualityChanged)

    const poll = async () => {
      const rtt = await measureRoomRtt(room as RoomWithEngine)
      if (!cancelled) setRttMs(rtt)
    }

    void poll()
    const interval = setInterval(() => void poll(), LATENCY_POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
      room.localParticipant.off('connectionQualityChanged', onQualityChanged)
    }
  }, [room])

  return { rttMs, quality }
}
