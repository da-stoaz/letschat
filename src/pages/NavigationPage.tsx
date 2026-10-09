import type { ReactNode } from 'react'
import { Link, Navigate, NavLink, useLocation, useOutletContext } from 'react-router-dom'
import { CompassIcon, MoreHorizontalIcon, PlusIcon, SettingsIcon, ArrowLeftIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-mobile'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { serverInitials } from '../layouts/app-layout/helpers'
import type { Server } from '../types/domain'
import { useServersStore } from '../stores/serversStore'
import { desktopListPath } from '../layouts/app-layout/navigation'

export interface NavigationContext {
  channelBar: ReactNode
  servers: Server[]
  countUnreadInServer: (id: number) => number
  onCreateSpace: () => void
  onCompose: () => void
}

function SpacesList({ servers, countUnreadInServer }: Pick<NavigationContext, 'servers' | 'countUnreadInServer'>) {
  return <div className="app-scrollbar h-full overflow-y-auto p-3">
    <h1 className="sr-only">Spaces</h1>
    {servers.length ? servers.map(server => {
      const unread = countUnreadInServer(server.id)
      return <Link key={server.id} to={`/app/${server.id}/channels`} className="flex min-h-14 items-center gap-3 rounded-lg p-3 hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">
        <Avatar className="size-10 rounded-lg"><AvatarImage src={server.iconUrl ?? undefined} alt="" /><AvatarFallback className="rounded-lg">{serverInitials(server.name)}</AvatarFallback></Avatar>
        <span className="min-w-0 flex-1 truncate font-medium">{server.name}</span>
        {unread > 0 ? <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground" aria-label={`${unread} unread messages`}>{unread > 99 ? '99+' : unread}</span> : null}
      </Link>
    }) : <div className="space-y-3 p-3"><p className="text-sm text-muted-foreground">No spaces yet</p><Button render={<Link to="/app/discover" />}>Discover spaces</Button></div>}
  </div>
}

export function NavigationPage() {
  const { channelBar, servers, countUnreadInServer, onCreateSpace, onCompose } = useOutletContext<NavigationContext>()
  const isMobile = useIsMobile()
  const activeServerId = useServersStore(s => s.activeServerId)
  const { pathname: routePath } = useLocation()
  const pathname = routePath.replace(/\/+$/, '')
  const spaces = pathname === '/app/spaces'
  const messages = pathname === '/app/messages'
  const conversations = spaces || messages
  if (!isMobile) {
    return <Navigate to={desktopListPath(pathname, servers.map(server => server.id), activeServerId)} replace />
  }
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="min-h-0 flex-1">
        {spaces ? <SpacesList servers={servers} countUnreadInServer={countUnreadInServer} /> : channelBar}
      </div>
      <footer className="flex shrink-0 items-center gap-2 border-t px-3 py-2 md:order-first md:border-t-0 md:border-b">
        {!conversations ? <Link to="/app/spaces" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm focus-visible:outline-2 focus-visible:outline-primary"><ArrowLeftIcon className="size-4" />Spaces</Link> : (
          <nav aria-label="Conversations" className="flex min-w-0 flex-1 gap-1">
            <NavLink to="/app/spaces" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium aria-[current=page]:bg-muted">Spaces</NavLink>
            <NavLink to="/app/messages" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium aria-[current=page]:bg-muted">Messages</NavLink>
          </nav>
        )}
        {conversations ? <Button variant="ghost" size="icon" aria-label={spaces ? 'Create space' : 'New message'} onClick={spaces ? onCreateSpace : onCompose}><PlusIcon className="size-5" /></Button> : null}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="ml-auto" aria-label="Navigation actions" />}><MoreHorizontalIcon className="size-5" /></DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? 'top' : 'bottom'} align="end" className="w-44">
            <DropdownMenuItem render={<Link to="/app/settings" />}><SettingsIcon />Settings</DropdownMenuItem>
            <DropdownMenuItem render={<Link to="/app/discover" />}><CompassIcon />Discover spaces</DropdownMenuItem>
            {!conversations ? <DropdownMenuItem render={<Link to="/app/messages" />}>Messages</DropdownMenuItem> : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </footer>
    </section>
  )
}
