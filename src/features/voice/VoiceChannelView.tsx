import { useEffect, useState } from 'react'
import { joinLiveKitVoice, leaveLiveKitVoice } from '../../lib/livekit'
import { reducers } from '../../lib/spacetimedb'
import { useVoiceStore } from '../../stores/voiceStore'
import type { u64 } from '../../types/domain'
import type { Room } from 'livekit-client'
import { useUiStore } from '../../stores/uiStore'

export function VoiceChannelView({ channelId }: { channelId: u64 | null }) {
  const participants = useVoiceStore((s) => (channelId ? s.participantsByChannel[channelId] ?? [] : []))
  const [room, setRoom] = useState<Room | null>(null)
  const setActiveChannelId = useUiStore((s) => s.setActiveChannelId)
  const clearUnread = useUiStore((s) => s.clearUnread)

  useEffect(() => {
    if (channelId === null) return
    const ui = useUiStore.getState()
    if (ui.activeChannelId !== channelId) {
      setActiveChannelId(channelId)
    }
    if ((ui.unreadByChannel[channelId] ?? 0) > 0) {
      clearUnread(channelId)
    }
  }, [channelId, clearUnread, setActiveChannelId])

  if (channelId === null) {
    return <div className="pane-empty">Select a voice channel</div>
  }

  const joined = room !== null

  return (
    <section className="pane">
      <header className="pane-header">
        <div>
          <strong>Voice Channel {channelId}</strong>
          <small> {participants.length}/15 participants</small>
        </div>
      </header>

      <div className="voice-grid">
        {participants.map((p) => (
          <div className="voice-tile" key={p.userIdentity}>
            <strong>{p.userIdentity.slice(0, 8)}</strong>
            <small>
              {p.muted ? 'Muted ' : ''}
              {p.deafened ? 'Deafened ' : ''}
              {p.sharingScreen ? 'Screen ' : ''}
              {p.sharingCamera ? 'Camera' : ''}
            </small>
          </div>
        ))}
      </div>

      <div className="voice-controls">
        {!joined ? (
          <button
            onClick={async () => {
              const r = await joinLiveKitVoice(channelId)
              setRoom(r)
            }}
          >
            Join Voice
          </button>
        ) : (
          <>
            <button onClick={() => reducers.updateVoiceState(channelId, true, false, false, false)}>Mute</button>
            <button onClick={() => reducers.updateVoiceState(channelId, false, true, false, false)}>Deafen</button>
            <button onClick={() => reducers.updateVoiceState(channelId, false, false, false, true)}>Camera</button>
            <button onClick={() => reducers.updateVoiceState(channelId, false, false, true, false)}>Screen</button>
            <button
              className="danger"
              onClick={async () => {
                await leaveLiveKitVoice(channelId, room)
                setRoom(null)
              }}
            >
              Leave
            </button>
          </>
        )}
      </div>
    </section>
  )
}
