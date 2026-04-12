import { BanListModal, BanMemberModal, KickMemberModal, SetRoleModal, TimeoutMemberModal, TransferOwnershipModal } from '../../modals/member-actions'
import { CreateChannelModal } from '../../modals/CreateChannelModal'
import { DeleteServerModal } from '../../modals/DeleteServerModal'
import { EditChannelModal } from '../../modals/EditChannelModal'
import { EditServerModal } from '../../modals/EditServerModal'
import type { Channel, Server } from '../../types/domain'
import { sectionLabel } from './helpers'
import type { MemberActionModal, PendingDeleteAction } from './types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type ServerManageDialogsProps = {
  server: Server
  showEditServer: boolean
  setShowEditServer: (open: boolean) => void
  showDeleteServer: boolean
  setShowDeleteServer: (open: boolean) => void
  showCreateChannel: boolean
  setShowCreateChannel: (open: boolean) => void
  createChannelInitialSection: string | null
  setCreateChannelInitialSection: (section: string | null) => void
  createChannelDialogSeed: number
  editingChannel: Channel | null
  setEditingChannel: (channel: Channel | null) => void
  memberAction: MemberActionModal | null
  onCloseMemberAction: () => void
  pendingDeleteAction: PendingDeleteAction | null
  setPendingDeleteAction: (action: PendingDeleteAction | null) => void
  deleteSubmitting: boolean
  onConfirmDeleteAction: () => void
  onServerDeleted: () => void
}

export function ServerManageDialogs({
  server,
  showEditServer,
  setShowEditServer,
  showDeleteServer,
  setShowDeleteServer,
  showCreateChannel,
  setShowCreateChannel,
  createChannelInitialSection,
  setCreateChannelInitialSection,
  createChannelDialogSeed,
  editingChannel,
  setEditingChannel,
  memberAction,
  onCloseMemberAction,
  pendingDeleteAction,
  setPendingDeleteAction,
  deleteSubmitting,
  onConfirmDeleteAction,
  onServerDeleted,
}: ServerManageDialogsProps) {
  return (
    <>
      <Dialog open={showEditServer} onOpenChange={setShowEditServer}>
        <DialogContent className="max-w-md">
          <EditServerModal
            serverId={server.id}
            currentName={server.name}
            currentIconUrl={server.iconUrl}
            onClose={() => setShowEditServer(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteServer} onOpenChange={setShowDeleteServer}>
        <DialogContent className="max-w-md">
          <DeleteServerModal
            serverId={server.id}
            serverName={server.name}
            onClose={() => setShowDeleteServer(false)}
            onDeleted={onServerDeleted}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={showCreateChannel}
        onOpenChange={(open) => {
          setShowCreateChannel(open)
          if (!open) {
            setCreateChannelInitialSection(null)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <CreateChannelModal
            key={`${createChannelDialogSeed}:${createChannelInitialSection ?? '__none__'}`}
            serverId={server.id}
            initialSection={createChannelInitialSection}
            onClose={() => setShowCreateChannel(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={editingChannel !== null} onOpenChange={(open) => !open && setEditingChannel(null)}>
        <DialogContent className="max-w-md">
          {editingChannel ? (
            <EditChannelModal
              channelId={editingChannel.id}
              currentName={editingChannel.name}
              currentModeratorOnly={editingChannel.moderatorOnly}
              currentSection={editingChannel.section}
              onClose={() => setEditingChannel(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={memberAction?.kind === 'kick'} onOpenChange={(open) => !open && onCloseMemberAction()}>
        <DialogContent className="max-w-md">
          {memberAction?.kind === 'kick' ? (
            <KickMemberModal serverId={server.id} member={memberAction.member} onClose={onCloseMemberAction} />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={memberAction?.kind === 'ban'} onOpenChange={(open) => !open && onCloseMemberAction()}>
        <DialogContent className="max-w-md">
          {memberAction?.kind === 'ban' ? (
            <BanMemberModal serverId={server.id} member={memberAction.member} onClose={onCloseMemberAction} />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={memberAction?.kind === 'timeout'} onOpenChange={(open) => !open && onCloseMemberAction()}>
        <DialogContent className="max-w-md">
          {memberAction?.kind === 'timeout' ? (
            <TimeoutMemberModal serverId={server.id} member={memberAction.member} onClose={onCloseMemberAction} />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={memberAction?.kind === 'setRole'} onOpenChange={(open) => !open && onCloseMemberAction()}>
        <DialogContent className="max-w-md">
          {memberAction?.kind === 'setRole' ? (
            <SetRoleModal
              serverId={server.id}
              member={memberAction.member}
              newRole={memberAction.newRole}
              onClose={onCloseMemberAction}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={memberAction?.kind === 'transferOwnership'} onOpenChange={(open) => !open && onCloseMemberAction()}>
        <DialogContent className="max-w-md">
          {memberAction?.kind === 'transferOwnership' ? (
            <TransferOwnershipModal
              serverId={server.id}
              member={memberAction.member}
              onClose={onCloseMemberAction}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={memberAction?.kind === 'banList'} onOpenChange={(open) => !open && onCloseMemberAction()}>
        <DialogContent className="max-w-md">
          {memberAction?.kind === 'banList' ? (
            <BanListModal serverId={server.id} onClose={onCloseMemberAction} />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDeleteAction !== null}
        onOpenChange={(open) => {
          if (!open && !deleteSubmitting) setPendingDeleteAction(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingDeleteAction?.kind === 'channel'
                ? `Delete channel "${pendingDeleteAction.channel.name}"?`
                : pendingDeleteAction?.kind === 'section'
                  ? `Delete section "${sectionLabel(pendingDeleteAction.group.section)}"?`
                  : 'Delete item?'}
            </DialogTitle>
            <DialogDescription>
              {pendingDeleteAction?.kind === 'channel'
                ? 'This will permanently remove the channel and its messages.'
                : pendingDeleteAction?.kind === 'section'
                  ? `This will delete all ${pendingDeleteAction.group.channels.length} channels in this section and their messages.`
                  : 'This action cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingDeleteAction(null)}
              disabled={deleteSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirmDeleteAction}
              disabled={deleteSubmitting}
            >
              {deleteSubmitting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
