import { afterEach, expect, it, vi } from 'vitest'
import { isTextAttachment } from './attachmentUtils'
import { loadTextPreview, TEXT_PREVIEW_BYTES } from './textPreview'

afterEach(() => vi.unstubAllGlobals())

it('recognizes text and HTML even with generic upload MIME types, but not archives', () => {
  expect(isTextAttachment('text/plain; charset=utf-8', 'README')).toBe(true)
  expect(isTextAttachment('application/octet-stream', 'README.TXT')).toBe(true)
  expect(isTextAttachment('application/octet-stream', 'index.html')).toBe(true)
  expect(isTextAttachment('application/json', 'data')).toBe(true)
  expect(isTextAttachment('application/zip', 'website.zip')).toBe(false)
  expect(isTextAttachment('application/octet-stream', 'program.exe')).toBe(false)
})

it('reads HTML as literal text and preserves UTF-8 across chunks', async () => {
  const bytes = new TextEncoder().encode('<script>alert("€")</script>')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
      controller.close()
    },
  }))))
  await expect(loadTextPreview('/file', new AbortController().signal)).resolves.toEqual({ text: '<script>alert("€")</script>', truncated: false })
})

it('bounds the preview and cancels the remaining download without trusting metadata', async () => {
  const cancel = vi.fn()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(TEXT_PREVIEW_BYTES + 1).fill(65)) },
    cancel,
  }))))
  const result = await loadTextPreview('/file', new AbortController().signal)
  expect(result.text).toHaveLength(TEXT_PREVIEW_BYTES)
  expect(result.truncated).toBe(true)
  expect(cancel).toHaveBeenCalledOnce()
})

it('reports HTTP errors and passes cancellation to fetch', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 403 }))
  vi.stubGlobal('fetch', fetchMock)
  const signal = new AbortController().signal
  await expect(loadTextPreview('/file', signal)).rejects.toThrow('403')
  expect(fetchMock).toHaveBeenCalledWith('/file', { signal })
})
