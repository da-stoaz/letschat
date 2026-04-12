import { PlusIcon, Trash2Icon } from 'lucide-react'
import type { Channel } from '../../types/domain'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ChannelRow } from './ChannelRow'
import { sectionLabel } from './helpers'
import type { ChannelGroup } from './types'

type ChannelsTabProps = {
  sortedChannels: Channel[]
  channelGroups: ChannelGroup[]
  canManageServerChannels: boolean
  reorderingChannelId: number | null
  onOpenCreateChannelDialog: (section: string | null) => void
  onDeleteChannelGroup: (group: ChannelGroup) => void
  onMoveChannel: (channelId: number, direction: -1 | 1) => void
  onDeleteChannel: (channel: Channel) => void
  onManageChannel: (channel: Channel) => void
}

export function ChannelsTab({
  sortedChannels,
  channelGroups,
  canManageServerChannels,
  reorderingChannelId,
  onOpenCreateChannelDialog,
  onDeleteChannelGroup,
  onMoveChannel,
  onDeleteChannel,
  onManageChannel,
}: ChannelsTabProps) {
  return (
    <Card className="flex h-full min-h-0 flex-col border-border/70 bg-background/40">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Channels</CardTitle>
          <CardDescription>Manage channels, sections, and ordering with explicit controls.</CardDescription>
        </div>
        {canManageServerChannels ? (
          <Button type="button" size="sm" onClick={() => onOpenCreateChannelDialog(null)}>
            <PlusIcon className="size-4" />
            Create Channel
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 pt-0">
        <ScrollArea className="h-full pr-2">
          {sortedChannels.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No channels found.</p>
          ) : (
            <div className="space-y-3">
              {channelGroups.map((group) => (
                <div key={group.key} className="rounded-lg border border-border/70 bg-muted/15">
                  <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{sectionLabel(group.section)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{group.channels.length}</Badge>
                      {canManageServerChannels ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          onClick={() => onOpenCreateChannelDialog(group.section)}
                          aria-label={`Create channel in ${sectionLabel(group.section)}`}
                          title={`Create channel in ${sectionLabel(group.section)}`}
                        >
                          <PlusIcon className="size-3.5" />
                        </Button>
                      ) : null}
                      {canManageServerChannels ? (
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon-sm"
                          onClick={() => onDeleteChannelGroup(group)}
                          aria-label="Delete entire section"
                          title="Delete section and all channels"
                        >
                          <Trash2Icon className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[60px]">Order</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Access</TableHead>
                        <TableHead className="w-[210px] text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.channels.map((channel, index) => (
                        <ChannelRow
                          key={channel.id}
                          channel={channel}
                          orderLabel={index + 1}
                          canMoveUp={index > 0}
                          canMoveDown={index < group.channels.length - 1}
                          canManageServerChannels={canManageServerChannels}
                          isReordering={reorderingChannelId !== null}
                          onMoveChannel={onMoveChannel}
                          onDeleteChannel={onDeleteChannel}
                          onManageChannel={onManageChannel}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
