// Run before importing stores, including in a production build with strict CSP.
const memory = new Map<string, string>()
Object.defineProperty(window, 'localStorage', { value: {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, String(value)),
  removeItem: (key: string) => memory.delete(key),
} })
export {}
