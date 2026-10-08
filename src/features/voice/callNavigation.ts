export function callReturnPath(requested: unknown, fallback: string): string {
  return typeof requested === 'string' && requested.startsWith('/app/') && !/^\/app\/call\/?(?:[?#]|$)/.test(requested)
    ? requested : fallback
}
