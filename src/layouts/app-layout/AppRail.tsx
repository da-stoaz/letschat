import { MessageCircleIcon, PlusIcon, SettingsIcon, Volume2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import stealthChatLogo from '../../../src-tauri/icons/stealthchat-nobg.png'
import { normalizeIdentity, serverInitials, userInitials } from './helpers'
import type { Server } from '../../types/domain'

interface QuickDmContact {
  identity: string
  label: string
  avatarUrl: string | null
}

export interface AppRailProps {
  servers: Server[]
  activeServerId: number | null
  activeDmIdentity: string | null
  quickDmContacts: QuickDmContact[]
  onOpenHome: () => void
  onOpenServer: (serverId: number) => void
  onOpenDmHome: () => void
  onOpenDmCompose: () => void
  onOpenDmContact: (identity: string) => void
  onOpenCreateServer: () => void
  onOpenSettings: () => void
  isSettingsActive: boolean
  hasUnreadInServer: (serverId: number) => boolean
  countUnreadInServer: (serverId: number) => number
  countUnreadInDm: () => number
  dmUnreadByIdentity: Record<string, number>
  hasVoiceActivityInServer: (serverId: number) => boolean
  dmCallActiveByIdentity: Record<string, boolean>
}

function formatUnreadCount(value: number): string {
  if (value > 99) return '99+'
  return String(Math.max(0, value))
}

export function AppRail({
  servers,
  activeServerId,
  activeDmIdentity,
  quickDmContacts,
  onOpenHome,
  onOpenServer,
  onOpenDmHome,
  onOpenDmCompose,
  onOpenDmContact,
  onOpenCreateServer,
  onOpenSettings,
  isSettingsActive,
  hasUnreadInServer,
  countUnreadInServer,
  countUnreadInDm,
  dmUnreadByIdentity,
  hasVoiceActivityInServer,
  dmCallActiveByIdentity,
}: AppRailProps) {
  const dmUnreadTotal = countUnreadInDm()
  const dmHomeActive = !isSettingsActive && !activeServerId && !activeDmIdentity

  return (
    <Card className="flex h-full min-h-0 flex-col border-border/60 bg-card/80 backdrop-blur">
      <CardContent className="flex min-h-0 flex-1 flex-col items-center gap-1 p-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="secondary" size="icon" className="relative mt-0.5 h-9 w-9 rounded-lg" />
            }
            onClick={onOpenHome}
          >
            <img src={stealthChatLogo} alt="StealthChat" className="h-6 w-6 object-contain" />
          </TooltipTrigger>
          <TooltipContent>Home</TooltipContent>
        </Tooltip>

        <Separator className="my-0.5" />

        <ScrollArea className="w-full min-h-0 flex-1 px-0.5">
          <div className="flex flex-col items-center gap-2 py-1">
            {servers.map((server) => {
              const serverUnread = countUnreadInServer(server.id)
              return (
                <Tooltip key={server.id}>
                  <TooltipTrigger
                    render={
                      <Button
                        variant={activeServerId === server.id ? 'secondary' : 'ghost'}
                        size="icon"
                        className={`relative h-9 w-9 rounded-lg ${activeServerId === server.id ? 'ring-1 ring-primary/70' : ''}`}
                        onClick={() => onOpenServer(server.id)}
                      />
                    }
                  >
                    <Avatar className="h-7 w-7 rounded-md">
                      <AvatarFallback className="rounded-xl bg-primary/10 text-xs">{serverInitials(server.name)}</AvatarFallback>
                    </Avatar>
                    {hasUnreadInServer(server.id) ? (
                      <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[9px] font-semibold leading-4 text-cyan-950 shadow-md">
                        {formatUnreadCount(serverUnread)}
                      </span>
                    ) : null}
                    {hasVoiceActivityInServer(server.id) ? (
                      <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-emerald-500 text-emerald-950 shadow-md">
                        <Volume2Icon className="size-2.5" />
                      </span>
                    ) : null}
                  </TooltipTrigger>
                  <TooltipContent side="right">{server.name}</TooltipContent>
                </Tooltip>
              )
            })}

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg border border-dashed border-border/70" onClick={onOpenCreateServer} />
                }
              >
                <PlusIcon className="size-4" />
              </TooltipTrigger>
              <TooltipContent side="right">Create Server</TooltipContent>
            </Tooltip>
          </div>
        </ScrollArea>

        <Separator className="my-0.5" />

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={dmHomeActive ? 'secondary' : 'ghost'}
                size="icon"
                className={`relative h-8 w-8 rounded-md ${dmHomeActive ? 'ring-1 ring-primary/70' : ''}`}
                onClick={onOpenDmHome}
              />
            }
          >
            <MessageCircleIcon className="size-4" />
            {dmUnreadTotal > 0 ? (
              <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[9px] font-semibold leading-4 text-cyan-950 shadow-md">
                {formatUnreadCount(dmUnreadTotal)}
              </span>
            ) : null}
          </TooltipTrigger>
          <TooltipContent side="right">DM Home</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="relative h-8 w-8 rounded-md"
                onClick={onOpenDmCompose}
              />
            }
          >
            <MessageCircleIcon className="size-4" />
            <span className="absolute -right-0.5 -top-0.5 grid size-3 place-items-center rounded-full bg-primary text-[10px] leading-none text-primary-foreground">+</span>
          </TooltipTrigger>
          <TooltipContent side="right">Compose DM</TooltipContent>
        </Tooltip>

        {quickDmContacts.length > 0 ? (
          <div className="flex flex-col items-center gap-1 py-1">
            {quickDmContacts.map((contact) => {
              const unread = dmUnreadByIdentity[normalizeIdentity(contact.identity)] ?? 0
              return (
                <Tooltip key={contact.identity}>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`relative h-8 w-8 rounded-md ${activeDmIdentity === contact.identity ? 'ring-1 ring-primary/70' : ''}`}
                        onClick={() => onOpenDmContact(contact.identity)}
                      />
                    }
                  >
                    <Avatar size="sm" className="rounded-lg">
                      {contact.avatarUrl ? <AvatarImage src={contact.avatarUrl} alt={contact.label} /> : null}
                      <AvatarFallback className="rounded-lg bg-primary/10 text-[10px]">{userInitials(contact.label)}</AvatarFallback>
                    </Avatar>
                    {unread > 0 ? (
                      <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[9px] font-semibold leading-4 text-cyan-950 shadow-md">
                        {formatUnreadCount(unread)}
                      </span>
                    ) : null}
                    {dmCallActiveByIdentity[contact.identity] ? (
                      <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-emerald-500 text-emerald-950 shadow-md">
                        <Volume2Icon className="size-2.5" />
                      </span>
                    ) : null}
                  </TooltipTrigger>
                  <TooltipContent side="right">{contact.label}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        ) : null}

        <div className="mt-auto" />

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={isSettingsActive ? 'secondary' : 'ghost'}
                size="icon"
                className={`mb-0.5 h-9 w-9 rounded-lg ${isSettingsActive ? 'ring-1 ring-primary/70' : ''}`}
                onClick={onOpenSettings}
              />
            }
          >
            <SettingsIcon className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
      </CardContent>
    </Card>
  )
}
