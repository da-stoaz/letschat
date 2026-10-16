import type { KeyboardEvent } from 'react'

// A held key is one action, including when an error response has already
// re-enabled the submit button. Normal presses and IME composition still work.
export function preventRepeatedSubmit(event: KeyboardEvent) {
  if (event.repeat && event.key === 'Enter' && !event.nativeEvent.isComposing) {
    event.preventDefault()
    event.stopPropagation()
  }
}
