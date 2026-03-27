export type DmSystemMessageKind = 'call_started' | 'call_ended'

type DmSystemPayload = {
  kind: DmSystemMessageKind
  durationSeconds?: number
  missed?: boolean
}

const SYSTEM_PREFIX = '__letschat_system__:'

const SYSTEM_PREVIEW_LABELS: Record<DmSystemMessageKind, string> = {
  call_started: 'Call started',
  call_ended: 'Call ended',
}

function isDmSystemKind(value: string): value is DmSystemMessageKind {
  return value === 'call_started' || value === 'call_ended'
}

function normalizeDurationSeconds(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.round(value))
}

function normalizeMissed(value: unknown): boolean | undefined {
  if (typeof value !== 'boolean') return undefined
  return value
}

function formatDuration(durationSeconds: number): string {
  const total = Math.max(0, Math.round(durationSeconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function formatSentTime(sentAt: string): string {
  return new Date(sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function getCallDurationSeconds(startedAt: string | null | undefined): number | null {
  if (!startedAt) return null
  const startedAtMs = Date.parse(startedAt)
  if (!Number.isFinite(startedAtMs)) return null
  return Math.max(0, Math.round((Date.now() - startedAtMs) / 1000))
}

export function encodeDmSystemMessage(
  kind: DmSystemMessageKind,
  payload?: { durationSeconds?: number; missed?: boolean },
): string {
  const encoded: DmSystemPayload = { kind }
  const normalizedDuration = normalizeDurationSeconds(payload?.durationSeconds)
  if (normalizedDuration !== undefined) {
    encoded.durationSeconds = normalizedDuration
  }
  const normalizedMissed = normalizeMissed(payload?.missed)
  if (normalizedMissed !== undefined) {
    encoded.missed = normalizedMissed
  }
  return `${SYSTEM_PREFIX}${JSON.stringify(encoded)}`
}

export function parseDmSystemMessage(content: string): DmSystemPayload | null {
  if (!content.startsWith(SYSTEM_PREFIX)) return null
  const body = content.slice(SYSTEM_PREFIX.length)
  if (!body) return null

  if (body.startsWith('{')) {
    try {
      const parsed = JSON.parse(body) as { kind?: unknown; durationSeconds?: unknown; missed?: unknown }
      if (typeof parsed.kind !== 'string' || !isDmSystemKind(parsed.kind)) {
        return null
      }
      return {
        kind: parsed.kind,
        durationSeconds: normalizeDurationSeconds(parsed.durationSeconds),
        missed: normalizeMissed(parsed.missed),
      }
    } catch {
      return null
    }
  }

  if (!isDmSystemKind(body)) return null
  return { kind: body }
}

export function formatDmSystemMessageForBubble(content: string, sentAt: string): string | null {
  const parsed = parseDmSystemMessage(content)
  if (!parsed) return null

  if (parsed.kind === 'call_started') {
    return `Call started • ${formatSentTime(sentAt)}`
  }
  if (parsed.durationSeconds !== undefined) {
    return `Call ended • ${formatDuration(parsed.durationSeconds)}`
  }
  return 'Call ended'
}

export function formatDmSystemMetadata(sentAt: string): string {
  return new Date(sentAt).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDmSystemPrimaryText(args: {
  content: string
  sentAt: string
  senderLabel: string
  partnerLabel: string
  viewerIsSender: boolean
}): string | null {
  const parsed = parseDmSystemMessage(args.content)
  if (!parsed) return null

  if (parsed.kind === 'call_started') {
    return `${args.senderLabel} started a call on ${formatSentTime(args.sentAt)}`
  }

  const durationLabel = formatDuration(parsed.durationSeconds ?? 0)
  if (parsed.missed) {
    if (args.viewerIsSender) {
      return `Missed call to ${args.partnerLabel} that lasted ${durationLabel}`
    }
    return `You missed a call from ${args.senderLabel} that lasted ${durationLabel}`
  }
  return `Call ended after ${durationLabel}`
}

export function formatDmPreview(content: string): string {
  const parsed = parseDmSystemMessage(content)
  if (!parsed) return content
  if (parsed.kind === 'call_ended' && parsed.durationSeconds !== undefined) {
    return `${SYSTEM_PREVIEW_LABELS.call_ended} • ${formatDuration(parsed.durationSeconds)}`
  }
  return SYSTEM_PREVIEW_LABELS[parsed.kind]
}
