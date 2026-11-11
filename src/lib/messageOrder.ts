/** Server timestamps are UTC ISO strings with up to six fractional digits. */
export function messageTimestampMicros(iso: string): bigint {
  const subMillis = iso.match(/\.\d{3}(\d{1,3})Z$/)?.[1] ?? ''
  return BigInt(Date.parse(iso)) * 1000n + BigInt(subMillis.padEnd(3, '0'))
}

/** Match the module's (sent_at, id) order in subscriptions and history pages. */
export function compareMessages(a: { sentAt: string; id: number }, b: { sentAt: string; id: number }): number {
  const left = messageTimestampMicros(a.sentAt)
  const right = messageTimestampMicros(b.sentAt)
  return left < right ? -1 : left > right ? 1 : a.id - b.id
}
