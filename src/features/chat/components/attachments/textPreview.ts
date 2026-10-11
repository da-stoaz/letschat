export const TEXT_PREVIEW_BYTES = 1024 * 1024

export async function loadTextPreview(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Could not load text preview (${response.status}).`)
  if (!response.body) throw new Error('Could not read this file.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return { text: text + decoder.decode(), truncated: false }
      const remaining = TEXT_PREVIEW_BYTES - bytes
      text += decoder.decode(value.subarray(0, remaining), { stream: true })
      bytes += value.byteLength
      if (bytes > TEXT_PREVIEW_BYTES) return { text, truncated: true }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
