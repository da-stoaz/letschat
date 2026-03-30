import { Dialog, DialogContent } from '@/components/ui/dialog'
import { CreateServerModal } from '../../modals/CreateServerModal'
import { CreateChannelModal } from '../../modals/CreateChannelModal'
import { InviteModal } from '../../modals/InviteModal'
import {
  KickMemberModal,
  BanMemberModal,
  TimeoutMemberModal,
  SetRoleModal,
  TransferOwnershipModal,
  BanListModal,
} from '../../modals/member-actions'
import type { ServerMemberWithUser } from '../../stores/membersStore'

export type MemberActionModal =
  | { kind: 'kick'; member: ServerMemberWithUser }
  | { kind: 'ban'; member: ServerMemberWithUser }
  | { kind: 'timeout'; member: ServerMemberWithUser }
  | { kind: 'setRole'; member: ServerMemberWithUser; newRole: 'Member' | 'Moderator' }
  | { kind: 'transferOwnership'; member: ServerMemberWithUser }
  | { kind: 'banList' }

interface LayoutModalsProps {
  showCreateServer: boolean
  showCreateChannel: boolean
  showInvite: boolean
  memberAction: MemberActionModal | null
  activeServerId: number | null
  setShowCreateServer: (open: boolean) => void
  setShowCreateChannel: (open: boolean) => void
  setShowInvite: (open: boolean) => void
  setMemberAction: (action: MemberActionModal | null) => void
}

export function LayoutModals({
  showCreateServer,
  showCreateChannel,
  showInvite,
  memberAction,
  activeServerId,
  setShowCreateServer,
  setShowCreateChannel,
  setShowInvite,
  setMemberAction,
}: LayoutModalsProps) {
  const closeMemberAction = () => setMemberAction(null)

  return (
    <>
      <Dialog open={showCreateServer} onOpenChange={setShowCreateServer}>
        <DialogContent className="max-w-md">
          <CreateServerModal onClose={() => setShowCreateServer(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={showCreateChannel && !!activeServerId} onOpenChange={setShowCreateChannel}>
        <DialogContent className="max-w-md">
          {activeServerId ? <CreateChannelModal serverId={activeServerId} onClose={() => setShowCreateChannel(false)} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={showInvite && !!activeServerId} onOpenChange={setShowInvite}>
        <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden">
          {activeServerId ? <InviteModal serverId={activeServerId} onClose={() => setShowInvite(false)} /> : null}
        </DialogContent>
      </Dialog>

      {/* Member action modals */}
      <Dialog open={memberAction?.kind === 'kick'} onOpenChange={(open) => !open && closeMemberAction()}>
        <DialogContent className="max-w-md">
          {memberAction?.kind === 'kick' && activeServerId ? (
            <KickMemberModal serverId={activeServerId} member={memberAction.member} onClose={closeMemberAction} />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={memberAction?.kind === 'ban'} onOpenChange={(open) => !open && closeMemberAction()}>
        <DialogContent className="max-w-md">
          {memberAction?.kind === 'ban' && activeServerId ? (
            <BanMemberModal serverId={activeServerId} member={memberAction.member} onClose={closeMemberAction} />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={memberAction?.kind === 'timeout'} onOpenChange={(open) => !open && closeMemberAction()}>
        <DialogContent className="max-w-md">
          {memberAction?.kind === 'timeout' && activeServerId ? (
            <TimeoutMemberModal serverId={activeServerId} member={memberAction.member} onClose={closeMemberAction} />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={memberAction?.kind === 'setRole'} onOpenChange={(open) => !open && closeMemberAction()}>
        <DialogContent className="max-w-md">
          {memberAction?.kind === 'setRole' && activeServerId ? (
            <SetRoleModal
              serverId={activeServerId}
              member={memberAction.member}
              newRole={memberAction.newRole}
              onClose={closeMemberAction}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={memberAction?.kind === 'transferOwnership'} onOpenChange={(open) => !open && closeMemberAction()}>
        <DialogContent className="max-w-md">
          {memberAction?.kind === 'transferOwnership' && activeServerId ? (
            <TransferOwnershipModal
              serverId={activeServerId}
              member={memberAction.member}
              onClose={closeMemberAction}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={memberAction?.kind === 'banList'} onOpenChange={(open) => !open && closeMemberAction()}>
        <DialogContent className="max-w-md">
          {memberAction?.kind === 'banList' && activeServerId ? (
            <BanListModal serverId={activeServerId} onClose={closeMemberAction} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
