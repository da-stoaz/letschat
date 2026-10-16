import { useServerConfigStore } from '@/stores/serverConfigStore'

export const CONFIRMATION_COOLDOWN_MS = 60_000
export const INITIAL_CONFIRMATION_COOLDOWN_MS = 30_000

export function confirmationCooldownKey(username: string) {
  return `letschat.confirmation:${useServerConfigStore.getState().config?.authServiceUrl}:${username.trim().toLowerCase()}`
}

export function readConfirmationCooldown(username: string): number {
  return Number(localStorage.getItem(confirmationCooldownKey(username))) || 0
}

export function readCorrectionCooldown(username: string): number {
  return Number(localStorage.getItem(`${confirmationCooldownKey(username)}:shared`)) || 0
}

export function startConfirmationCooldown(username: string, initial = false): number {
  const until = Date.now() + (initial ? INITIAL_CONFIRMATION_COOLDOWN_MS : CONFIRMATION_COOLDOWN_MS)
  localStorage.setItem(`${confirmationCooldownKey(username)}:shared`, String(initial ? 0 : until))
  localStorage.setItem(confirmationCooldownKey(username), String(until))
  return until
}
