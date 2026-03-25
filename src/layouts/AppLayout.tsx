import { useState } from 'react'
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom'
import { useServersStore } from '../stores/serversStore'
import { useChannelsStore } from '../stores/channelsStore'
import { useUiStore } from '../stores/uiStore'
import { CreateServerModal } from '../modals/CreateServerModal'
import { EditServerModal } from '../modals/EditServerModal'
import { CreateChannelModal } from '../modals/CreateChannelModal'
import { useServerRole } from '../hooks/useServerRole'
import { canManageChannels, canRenameServer } from '../lib/permissions'

export function AppLayout() {
  const navigate = useNavigate()
  const params = useParams()
  const [showCreateServer, setShowCreateServer] = useState(false)
  const [showEditServer, setShowEditServer] = useState(false)
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const servers = useServersStore((s) => s.servers)
  const channelsByServer = useChannelsStore((s) => s.channelsByServer)
  const activeServerId = Number(params.serverId ?? 0) || null
  const activeChannelId = Number(params.channelId ?? 0) || null
  const setActiveChannelId = useUiStore((s) => s.setActiveChannelId)
  const clearUnread = useUiStore((s) => s.clearUnread)
  const role = useServerRole(activeServerId)

  const activeChannels = activeServerId ? channelsByServer[activeServerId] ?? [] : []
  const textChannels = activeChannels.filter((c) => c.kind === 'Text')
  const voiceChannels = activeChannels.filter((c) => c.kind === 'Voice')
  const activeServer = servers.find((server) => server.id === activeServerId) ?? null

  const openServer = (serverId: number) => {
    setActionError(null)
    const channels = channelsByServer[serverId] ?? []
    const preferred = channels.find((channel) => channel.kind === 'Text') ?? channels[0]

    if (preferred) {
      setActiveChannelId(preferred.id)
      clearUnread(preferred.id)
      navigate(`/app/${serverId}/${preferred.id}`)
      return
    }

    navigate(`/app/${serverId}`)
  }

  return (
    <>
      <main className="app-grid">
        <aside className="server-rail">
          <Link className="server-pill" to="/app">
            L
          </Link>
          {servers.map((server) => (
            <button
              className={`server-pill ${activeServerId === server.id ? 'active' : ''}`}
              key={server.id}
              onClick={() => openServer(server.id)}
              title={server.name}
            >
              {server.name.slice(0, 2).toUpperCase()}
            </button>
          ))}
          <button className="server-pill" onClick={() => setShowCreateServer(true)} title="Create server">
            +
          </button>
        </aside>

        <aside className="sidebar">
          {activeServerId ? (
            <>
              <header className="sidebar-header">{activeServer?.name ?? `Server ${activeServerId}`}</header>
              <div className="sidebar-actions">
                <button
                  className="ghost"
                  disabled={!role || !canRenameServer(role)}
                  onClick={() => setShowEditServer(true)}
                >
                  Rename
                </button>
                <button
                  className="ghost"
                  disabled={!role || !canManageChannels(role)}
                  onClick={() => setShowCreateChannel(true)}
                >
                  + Channel
                </button>
              </div>
              <section>
                <h4>Text Channels</h4>
                {textChannels.map((channel) => (
                  <button
                    key={channel.id}
                    className={`channel-row ${activeChannelId === channel.id ? 'active' : ''}`}
                    onClick={() => {
                      setActiveChannelId(channel.id)
                      clearUnread(channel.id)
                      navigate(`/app/${activeServerId}/${channel.id}`)
                    }}
                  >
                    # {channel.name}
                  </button>
                ))}
              </section>
              <section>
                <h4>Voice Channels</h4>
                {voiceChannels.map((channel) => (
                  <button
                    key={channel.id}
                    className={`channel-row ${activeChannelId === channel.id ? 'active' : ''}`}
                    onClick={() => {
                      setActiveChannelId(channel.id)
                      clearUnread(channel.id)
                      navigate(`/app/${activeServerId}/${channel.id}`)
                    }}
                  >
                    🔊 {channel.name}
                  </button>
                ))}
              </section>
              {activeChannels.length === 0 ? (
                <div className="hint-card">
                  <p>This server has no channels yet.</p>
                  <button onClick={() => setShowCreateChannel(true)}>Create channel</button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <header className="sidebar-header">Direct Messages</header>
              <button className="channel-row active" onClick={() => navigate('/app/dm/friends')}>
                Friends
              </button>
            </>
          )}
          {actionError ? <p className="error-text">{actionError}</p> : null}
        </aside>

        <section className="main-pane">
          <Outlet />
        </section>
      </main>

      {showCreateServer ? (
        <div className="modal-backdrop" onClick={() => setShowCreateServer(false)}>
          <div className="modal-shell" onClick={(event) => event.stopPropagation()}>
            <CreateServerModal onClose={() => setShowCreateServer(false)} />
          </div>
        </div>
      ) : null}

      {showEditServer && activeServer ? (
        <div className="modal-backdrop" onClick={() => setShowEditServer(false)}>
          <div className="modal-shell" onClick={(event) => event.stopPropagation()}>
            <EditServerModal
              serverId={activeServer.id}
              currentName={activeServer.name}
              onClose={() => setShowEditServer(false)}
            />
          </div>
        </div>
      ) : null}

      {showCreateChannel && activeServerId ? (
        <div className="modal-backdrop" onClick={() => setShowCreateChannel(false)}>
          <div className="modal-shell" onClick={(event) => event.stopPropagation()}>
            <CreateChannelModal serverId={activeServerId} onClose={() => setShowCreateChannel(false)} />
          </div>
        </div>
      ) : null}
    </>
  )
}
