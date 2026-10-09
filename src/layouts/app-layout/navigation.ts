export function appHomePath(compact: boolean, serverIds: number[], activeServerId: number | null): string {
  if (compact) return serverIds.length ? '/app/spaces' : '/app/messages'
  if (!serverIds.length) return '/app/dm/friends'
  return `/app/${activeServerId !== null && serverIds.includes(activeServerId) ? activeServerId : serverIds[0]}`
}

/** Compact lists are route aliases on desktop, including after a window resize. */
export function desktopListPath(pathname: string, serverIds: number[], activeServerId: number | null): string {
  if (pathname === '/app/messages') return '/app/dm/friends'
  const channels = pathname.match(/^\/app\/(\d+)\/channels$/)
  return channels ? `/app/${channels[1]}` : appHomePath(false, serverIds, activeServerId)
}

export function parentListPath(pathname: string): string {
  const server = pathname.match(/^\/app\/(\d+)(?:\/([^/]+))?/)
  if (server) return server[2] === 'channels' ? '/app/spaces' : `/app/${server[1]}/channels`
  return pathname.startsWith('/app/dm/') ? '/app/messages' : '/app/spaces'
}

export function paneWidths(width: number, sidebar: number, members: number, fullPane: boolean) {
  const channelWidth = fullPane ? 0 : Math.min(sidebar, Math.max(220, width - 48 - 32 - 420))
  return { channelWidth, membersInline: width >= 768 && width - 48 - 40 - channelWidth - members >= 420 }
}
