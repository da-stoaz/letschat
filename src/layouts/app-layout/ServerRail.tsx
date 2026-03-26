import { MessageCircleIcon, PlusIcon, SettingsIcon, Volume2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import stealthChatLogo from '../../../src-tauri/icons/stealthchat-nobg.png'
import { serverInitials } from './helpers'
import type { Server } from '../../types/domain'

interface ServerRailProps {
  servers: Server[]
  activeServerId: number | null
  onOpenHome: () => void
  onOpenServer: (serverId: number) => void
  onOpenDm: () => void
  onOpenCreateServer: () => void
  onOpenSettings: () => void
  hasUnreadInServer: (serverId: number) => boolean
  hasVoiceActivityInServer: (serverId: number) => boolean
}

export function ServerRail({
  servers,
  activeServerId,
  onOpenHome,
  onOpenServer,
  onOpenDm,
  onOpenCreateServer,
  onOpenSettings,
  hasUnreadInServer,
  hasVoiceActivityInServer,
}: ServerRailProps) {
  return (
    <Card className="border-border/60 bg-card/80 backdrop-blur">
      <CardContent className="flex h-full flex-col items-center gap-2 p-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="secondary" size="icon" className="relative mt-1 h-11 w-11 rounded-2xl" />
            }
            onClick={onOpenHome}
          >
            <img src={stealthChatLogo} alt="StealthChat" className="h-7 w-7 object-contain" />
          </TooltipTrigger>
          <TooltipContent>Home</TooltipContent>
        </Tooltip>

        <Separator className="my-1" />

        <ScrollArea className="w-full flex-1 px-1">
          <div className="flex flex-col items-center gap-2 py-1">
            {servers.map((server) => (
              <Tooltip key={server.id}>
                <TooltipTrigger
                  render={
                    <Button
                      variant={activeServerId === server.id ? 'default' : 'ghost'}
                      size="icon"
                      className="relative h-11 w-11 rounded-2xl"
                      onClick={() => onOpenServer(server.id)}
                    />
                  }
                >
                  <Avatar className="h-8 w-8 rounded-xl">
                    <AvatarFallback className="rounded-xl bg-primary/10 text-xs">{serverInitials(server.name)}</AvatarFallback>
                  </Avatar>
                  {hasUnreadInServer(server.id) ? <span className="absolute right-1 top-1 size-2 rounded-full bg-cyan-400" /> : null}
                  {hasVoiceActivityInServer(server.id) ? (
                    <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-emerald-500 text-emerald-950 shadow-md">
                      <Volume2Icon className="size-2.5" />
                    </span>
                  ) : null}
                </TooltipTrigger>
                <TooltipContent side="right">{server.name}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </ScrollArea>

        <Separator className="my-1" />

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={activeServerId ? 'ghost' : 'secondary'}
                size="icon"
                className="h-10 w-10 rounded-xl"
                onClick={onOpenDm}
              />
            }
          >
            <MessageCircleIcon className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="right">Direct Messages</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl" onClick={onOpenCreateServer} />
            }
          >
            <PlusIcon className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="right">Create Server</TooltipContent>
        </Tooltip>

        <div className="flex-1" />

        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon" className="mb-1 h-10 w-10 rounded-xl" onClick={onOpenSettings} />
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
