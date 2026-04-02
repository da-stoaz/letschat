import type { ChatMessageAttachment } from '../../types/attachments'

const ATTACHMENT_MARKER_PREFIX = '[[LC_ATTACHMENTS_V1:'
const ATTACHMENT_MARKER_SUFFIX = ']]'
const ATTACHMENT_MARKER_REGEX = /\[\[LC_ATTACHMENTS_V1:([A-Za-z0-9_-]+)\]\]\s*$/
const MESSAGE_MAX_LENGTH = 4000

type AttachmentPayloadV1 = {
  v: 1
  attachments: ChatMessageAttachment[]
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function normalizeAttachment(entry: Partial<ChatMessageAttachment>): ChatMessageAttachment | null {
  const storageKey = (entry.storageKey ?? '').trim()
  const fileName = (entry.fileName ?? '').trim()
  const fileSize = Number(entry.fileSize ?? 0)
  const mimeType = (entry.mimeType ?? '').trim().toLowerCase()

  if (!storageKey.startsWith('uploads/')) return null
  if (!fileName) return null
  if (!Number.isFinite(fileSize) || fileSize <= 0) return null
  if (!mimeType) return null

  return { storageKey, fileName, fileSize, mimeType }
}

function encodeAttachmentPayload(attachments: ChatMessageAttachment[]): string {
  const normalized = attachments
    .map((entry) => normalizeAttachment(entry))
    .filter((entry): entry is ChatMessageAttachment => entry !== null)
  const payload: AttachmentPayloadV1 = {
    v: 1,
    attachments: normalized,
  }
  const encoded = encodeBase64Url(JSON.stringify(payload))
  return `${ATTACHMENT_MARKER_PREFIX}${encoded}${ATTACHMENT_MARKER_SUFFIX}`
}

export function parseMessageAttachments(content: string): {
  text: string
  attachments: ChatMessageAttachment[]
} {
  const match = content.match(ATTACHMENT_MARKER_REGEX)
  if (!match) {
    return { text: content, attachments: [] }
  }

  try {
    const encodedPayload = match[1]
    const decodedPayload = decodeBase64Url(encodedPayload)
    const parsed = JSON.parse(decodedPayload) as Partial<AttachmentPayloadV1>
    if (parsed.v !== 1 || !Array.isArray(parsed.attachments)) {
      return { text: content, attachments: [] }
    }

    const attachments = parsed.attachments
      .map((entry) => normalizeAttachment(entry))
      .filter((entry): entry is ChatMessageAttachment => entry !== null)
    const markerStart = content.lastIndexOf(ATTACHMENT_MARKER_PREFIX)
    const messageText = markerStart >= 0 ? content.slice(0, markerStart).trimEnd() : content
    return { text: messageText, attachments }
  } catch {
    return { text: content, attachments: [] }
  }
}

export function composeMessageWithAttachments(text: string, attachments: ChatMessageAttachment[]): string {
  const normalizedText = text.trim()
  const sanitizedAttachments = attachments
    .map((entry) => normalizeAttachment(entry))
    .filter((entry): entry is ChatMessageAttachment => entry !== null)

  if (sanitizedAttachments.length === 0) {
    if (!normalizedText) {
      throw new Error('Message cannot be empty.')
    }
    if (normalizedText.length > MESSAGE_MAX_LENGTH) {
      throw new Error(`Message exceeds ${MESSAGE_MAX_LENGTH} characters.`)
    }
    return normalizedText
  }

  const attachmentMarker = encodeAttachmentPayload(sanitizedAttachments)
  const content = normalizedText ? `${normalizedText}\n\n${attachmentMarker}` : attachmentMarker

  if (content.length > MESSAGE_MAX_LENGTH) {
    throw new Error('Message is too long after adding attachment metadata. Try fewer files or shorter file names.')
  }

  return content
}
