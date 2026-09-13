import { describe, expect, it } from 'vitest'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordLengthError } from './authService'

// Mirrors core-api's Validation.ValidatePassword: the same bounds, so the form
// can say "too long" before the round trip instead of after it.
describe('passwordLengthError', () => {
  it('accepts the whole allowed range, inclusive', () => {
    expect(passwordLengthError('p'.repeat(PASSWORD_MIN_LENGTH))).toBeNull()
    expect(passwordLengthError('p'.repeat(PASSWORD_MAX_LENGTH))).toBeNull()
  })

  it('names the bound that was crossed', () => {
    expect(passwordLengthError('p'.repeat(PASSWORD_MIN_LENGTH - 1))).toMatch(/at least 8/)
    expect(passwordLengthError('p'.repeat(PASSWORD_MAX_LENGTH + 1))).toMatch(/at most 128/)
  })
})
