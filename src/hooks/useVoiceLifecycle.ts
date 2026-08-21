import { useEffect } from 'react'
import { reducers } from '../lib/spacetimedb'
import { useConnectionStore } from '../stores/connectionStore'
import { useDmVoiceSessionStore } from '../stores/dmVoiceSessionStore'
import { useVoiceSessionStore } from '../stores/voiceSessionStore'

// Voice presence lifecycle — the whole client side of it.
//
// Presence rows are owned by the SERVER, scoped to the SpacetimeDB connection
// that created them: the module's `client_disconnected` reducer sweeps a dying
// connection's rows, so ghost rows cannot exist. The client therefore does NO
// presence reconciliation — this hook replaced `useVoiceStateReconciler`,
// whose compare-local-session-against-replicated-rows policies could disagree
// with each other across lag and flap join/leave forever.
//
// What's left are two deterministic, event-driven handlers. Neither reads
// replicated data to decide a write, which is the property that makes an
// oscillation impossible:
//
//  1. The LiveKit room died  → leave once, clear the session.
//  2. SpacetimeDB reconnected → the new connection owns no rows, so re-assert
//     the call the user is still in, once. (A module republish or a dropped
//     socket lands here.)

export function useVoiceLifecycle(): void {
  const connectionStatus = useConnectionStore((s) => s.status)
  const room = useVoiceSessionStore((s) => s.room)
  const dmRoom = useDmVoiceSessionStore((s) => s.room)

  useEffect(() => {
    if (!room) return
    const onDisconnected = () => {
      const store = useVoiceSessionStore.getState()
      if (store.room !== room) return
      const channelId = store.joinedChannelId
      store.setRoom(null)
      store.setJoinedChannelId(null)
      if (channelId !== null) {
        void reducers.leaveVoiceChannel(channelId).catch(() => undefined)
      }
    }
    room.on('disconnected', onDisconnected)
    return () => {
      room.off('disconnected', onDisconnected)
    }
  }, [room])

  useEffect(() => {
    if (!dmRoom) return
    const onDisconnected = () => {
      const store = useDmVoiceSessionStore.getState()
      if (store.room !== dmRoom) return
      const partnerIdentity = store.joinedPartnerIdentity
      store.reset()
      if (partnerIdentity !== null) {
        void reducers.leaveDmVoice(partnerIdentity).catch(() => undefined)
      }
    }
    dmRoom.on('disconnected', onDisconnected)
    return () => {
      dmRoom.off('disconnected', onDisconnected)
    }
  }, [dmRoom])

  useEffect(() => {
    if (connectionStatus !== 'connected') return
    // Deliberately read through getState(): this must fire on connection
    // transitions only, never because session state changed.
    const voice = useVoiceSessionStore.getState()
    if (voice.room !== null && voice.joinedChannelId !== null) {
      void reducers.joinVoiceChannel(voice.joinedChannelId).catch(() => undefined)
    }
    const dm = useDmVoiceSessionStore.getState()
    if (dm.room !== null && dm.joinedPartnerIdentity !== null) {
      void reducers.joinDmVoice(dm.joinedPartnerIdentity).catch(() => undefined)
    }
  }, [connectionStatus])
}
