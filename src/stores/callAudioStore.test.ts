import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})

import { callTrackVolume, participantVolume, useCallAudioStore, volumePercent } from './callAudioStore'

beforeEach(() => useCallAudioStore.setState({ masterVolume: 100, participantVolumes: {} }))

describe('listener call volume', () => {
  it('mixes master, per-person voice and stream levels independently; deafen preserves them', () => {
    const { setMasterVolume, setParticipantVolume } = useCallAudioStore.getState()
    setMasterVolume(50)
    setParticipantVolume(' ALICE ', 'voice', 40)
    setParticipantVolume('alice', 'screen', 20)
    const preferences = useCallAudioStore.getState()
    expect(callTrackVolume(preferences, 'Alice', 'voice', false)).toBe(0.2)
    expect(callTrackVolume(preferences, 'Alice', 'screen', false)).toBe(0.1)
    expect(callTrackVolume(preferences, 'bob', 'voice', false)).toBe(0.5)
    expect(callTrackVolume(preferences, 'alice', 'voice', true)).toBe(0)
    setParticipantVolume('alice', 'voice', 60)
    expect(callTrackVolume(useCallAudioStore.getState(), 'alice', 'voice', true)).toBe(0)
    expect(callTrackVolume(useCallAudioStore.getState(), 'alice', 'voice', false)).toBe(0.3)
    setMasterVolume(0)
    expect(callTrackVolume(useCallAudioStore.getState(), 'alice', 'screen', false)).toBe(0)
  })

  it('restores levels from device storage including a locally muted participant', async () => {
    useCallAudioStore.getState().setMasterVolume(75)
    useCallAudioStore.getState().setParticipantVolume('alice', 'voice', 0)
    useCallAudioStore.getState().setParticipantVolume('alice', 'screen', 35)
    const saved = localStorage.getItem('letschat.call-audio')!
    useCallAudioStore.setState({ masterVolume: 100, participantVolumes: {} })
    localStorage.setItem('letschat.call-audio', saved)
    await useCallAudioStore.persist.rehydrate()
    const preferences = useCallAudioStore.getState()
    expect(preferences.masterVolume).toBe(75)
    expect(participantVolume(preferences, 'ALICE', 'voice')).toBe(0)
    expect(participantVolume(preferences, 'alice', 'screen')).toBe(35)
  })

  it('bounds inputs and drops default overrides without clearing the other source', () => {
    expect([-20, 150, NaN, Infinity, undefined].map(volumePercent)).toEqual([0, 100, 100, 100, 100])
    const { setMasterVolume, setParticipantVolume } = useCallAudioStore.getState()
    setMasterVolume(NaN)
    setParticipantVolume('alice', 'voice', -1)
    setParticipantVolume('alice', 'screen', 25)
    expect(participantVolume(useCallAudioStore.getState(), 'alice', 'voice')).toBe(0)
    setParticipantVolume('alice', 'voice', 101)
    expect(useCallAudioStore.getState().participantVolumes).toEqual({ alice: { screen: 25 } })
    setParticipantVolume('alice', 'screen', 100)
    expect(useCallAudioStore.getState().participantVolumes).toEqual({})
  })
})
