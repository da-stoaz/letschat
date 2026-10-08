export type ReadingPosition = {
  historyLimit: number
  messageCount: number
  scrollTop: number
  followBottom: boolean
  anchorId?: string
  anchorOffset?: number
}

export const readingPositions = new Map<string, ReadingPosition>()

export function captureReadingPosition(element: HTMLElement, historyLimit: number, messageCount: number, followBottom: boolean): ReadingPosition {
  const top = element.getBoundingClientRect().top
  const anchor = Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]'))
    .find(message => message.getBoundingClientRect().bottom > top)
  return {
    historyLimit, messageCount, scrollTop: element.scrollTop, followBottom,
    anchorId: anchor?.dataset.messageId,
    anchorOffset: anchor ? anchor.getBoundingClientRect().top - top : undefined,
  }
}

export function restoreReadingPosition(element: HTMLElement, position: ReadingPosition) {
  if (position.followBottom) {
    element.scrollTop = element.scrollHeight
    return
  }
  const anchor = Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]'))
    .find(message => message.dataset.messageId === position.anchorId)
  element.scrollTop = anchor && position.anchorOffset !== undefined
    ? element.scrollTop + anchor.getBoundingClientRect().top - element.getBoundingClientRect().top - position.anchorOffset
    : position.scrollTop
}
