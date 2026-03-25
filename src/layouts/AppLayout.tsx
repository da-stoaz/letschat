import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { useServersStore } from '../stores/serversStore'
import { useChannelsStore } from '../stores/channelsStore'
import { useUiStore } from '../stores/uiStore'
import { reducers } from '../lib/spacetimedb'

export function AppLayout() {
  const navigate = useNavigate()
  const params = useParams()
  const servers = useServersStore((s) => s.servers)
  const channelsByServer = useChannelsStore((s) => s.channelsByServer)
  const activeServerId = Number(params.serverId ?? 0) || null
  const setActiveChannelId = useUiStore((s) => s.setActiveChannelId)

  const activeChannels = activeServerId ? channelsByServer[activeServerId] ?? [] : []
  const textChannels = activeChannels.filter((c) => c.kind === 'Text')
  const voiceChannels = activeChannels.filter((c) => c.kind === 'Voice')

  return (
    <main className="app-grid">
      <aside className="server-rail">
        <Link className="server-pill" to="/app">
          L
        </Link>
        {servers.map((server) => (
          <NavLink className="server-pill" key={server.id} to={`/app/${server.id}`}>
            {server.name.slice(0, 2).toUpperCase()}
          </NavLink>
        ))}
        <button className="server-pill" onClick={() => reducers.createServer('New Server')}>
          +
        </button>
      </aside>

      <aside className="sidebar">
        {activeServerId ? (
          <>
            <header className="sidebar-header">Server {activeServerId}</header>
            <section>
              <h4>Text Channels</h4>
              {textChannels.map((channel) => (
                <button
                  key={channel.id}
                  className="channel-row"
                  onClick={() => {
                    setActiveChannelId(channel.id)
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
                  className="channel-row"
                  onClick={() => {
                    setActiveChannelId(channel.id)
                    navigate(`/app/${activeServerId}/${channel.id}`)
                  }}
                >
                  🔊 {channel.name}
                </button>
              ))}
            </section>
          </>
        ) : (
          <>
            <header className="sidebar-header">Direct Messages</header>
            <button className="channel-row" onClick={() => navigate('/app/dm/friends')}>
              Friends
            </button>
          </>
        )}
      </aside>

      <section className="main-pane">
        <Outlet />
      </section>
    </main>
  )
}
