/** Only invitation routes can currently request a post-sign-in destination. */
export function authReturnPath(search: string): string {
  const path = new URLSearchParams(search).get('redirect')
  return path && /^\/invite\/[A-Za-z0-9_-]+$/.test(path) ? path : '/app'
}
