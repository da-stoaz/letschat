import { ArrowDownIcon, ArrowUpIcon, HashIcon, MegaphoneIcon, Settings2Icon, Trash2Icon, Volume2Icon } from 'lucide-react'
import type { Channel } from '../../types/domain'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TableCell, TableRow } from '@/components/ui/table'

type ChannelRowProps = {
  channel: Channel
  orderLabel: number
  canMoveUp: boolean
  canMoveDown: boolean
  canManageServerChannels: boolean
  isReordering: boolean
  onMoveChannel: (channelId: number, direction: -1 | 1) => void
  onDeleteChannel: (channel: Channel) => void
  onManageChannel: (channel: Channel) => void
}

export function ChannelRow({
  channel,
  orderLabel,
  canMoveUp,
  canMoveDown,
  canManageServerChannels,
  isReordering,
  onMoveChannel,
  onDeleteChannel,
  onManageChannel,
}: ChannelRowProps) {
  const KindIcon =
    channel.kind === 'Voice' ? Volume2Icon
    : channel.kind === 'Announcement' ? MegaphoneIcon
    : HashIcon

  return (
    <TableRow>
      <TableCell>
        <span className="text-xs text-muted-foreground">{orderLabel}</span>
      </TableCell>
      <TableCell className="font-medium">
        <span className="inline-flex items-center gap-2">
          <KindIcon className="size-4 opacity-70" />
          {channel.name}
          <Badge variant="outline" className="text-[10px]">
            {channel.kind}
          </Badge>
        </span>
      </TableCell>
      <TableCell>
        <Badge variant={channel.moderatorOnly ? 'secondary' : 'outline'}>
          {channel.moderatorOnly ? 'Moderators only' : 'Everyone'}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        {canManageServerChannels ? (
          <div className="inline-flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => onMoveChannel(channel.id, -1)}
              disabled={!canMoveUp || isReordering}
              aria-label="Move channel up"
              title="Move up"
            >
              <ArrowUpIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => onMoveChannel(channel.id, 1)}
              disabled={!canMoveDown || isReordering}
              aria-label="Move channel down"
              title="Move down"
            >
              <ArrowDownIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="icon-sm"
              onClick={() => onDeleteChannel(channel)}
              disabled={isReordering}
              aria-label="Delete channel"
              title="Delete channel"
            >
              <Trash2Icon className="size-3.5" />
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onManageChannel(channel)} disabled={isReordering}>
              <Settings2Icon className="size-4" />
              Manage
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Read only</span>
        )}
      </TableCell>
    </TableRow>
  )
}
