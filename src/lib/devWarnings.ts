const warnedKeys = new Set<string>()

export function warnOnce(key: string, message: string): void {
  if (!import.meta.env.DEV) return
  if (warnedKeys.has(key)) return
  warnedKeys.add(key)
  console.warn(message)
}

