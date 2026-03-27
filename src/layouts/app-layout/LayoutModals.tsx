import { Dialog, DialogContent } from '@/components/ui/dialog'
import { CreateServerModal } from '../../modals/CreateServerModal'
import { EditServerModal } from '../../modals/EditServerModal'
import { CreateChannelModal } from '../../modals/CreateChannelModal'
import { InviteModal } from '../../modals/InviteModal'
import type { Server } from '../../types/domain'

interface LayoutModalsProps {
  showCreateServer: boolean
  showEditServer: boolean
  showCreateChannel: boolean
  showInvite: boolean
  activeServerId: number | null
  activeServer: Server | null
  setShowCreateServer: (open: boolean) => void
  setShowEditServer: (open: boolean) => void
  setShowCreateChannel: (open: boolean) => void
  setShowInvite: (open: boolean) => void
}

export function LayoutModals({
  showCreateServer,
  showEditServer,
  showCreateChannel,
  showInvite,
  activeServerId,
  activeServer,
  setShowCreateServer,
  setShowEditServer,
  setShowCreateChannel,
  setShowInvite,
}: LayoutModalsProps) {
  return (
    <>
      <Dialog open={showCreateServer} onOpenChange={setShowCreateServer}>
        <DialogContent className="max-w-md">
          <CreateServerModal onClose={() => setShowCreateServer(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={showEditServer && !!activeServer} onOpenChange={setShowEditServer}>
        <DialogContent className="max-w-md">
          {activeServer ? (
            <EditServerModal
              serverId={activeServer.id}
              currentName={activeServer.name}
              onClose={() => setShowEditServer(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={showCreateChannel && !!activeServerId} onOpenChange={setShowCreateChannel}>
        <DialogContent className="max-w-md">
          {activeServerId ? <CreateChannelModal serverId={activeServerId} onClose={() => setShowCreateChannel(false)} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={showInvite && !!activeServerId} onOpenChange={setShowInvite}>
        <DialogContent className="max-w-md">
          {activeServerId ? <InviteModal serverId={activeServerId} onClose={() => setShowInvite(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
