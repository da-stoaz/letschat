import { expect, it } from 'vitest'
import { captureReadingPosition, restoreReadingPosition } from './readingPosition'

it('keeps the same message at the same visual offset after content and viewport changes', () => {
  let messageTop = 130
  const message = { dataset: { messageId: '42' }, getBoundingClientRect: () => ({ top: messageTop, bottom: messageTop + 30 }) }
  const element = {
    scrollTop: 200, scrollHeight: 1500,
    getBoundingClientRect: () => ({ top: 100 }),
    querySelectorAll: () => [message],
  } as unknown as HTMLElement
  const saved = captureReadingPosition(element, 100, 100, false)
  expect(saved.anchorOffset).toBe(30)
  messageTop += 400
  restoreReadingPosition(element, saved)
  expect(element.scrollTop).toBe(600)
  restoreReadingPosition(element, { ...saved, followBottom: true })
  expect(element.scrollTop).toBe(1500)
})
