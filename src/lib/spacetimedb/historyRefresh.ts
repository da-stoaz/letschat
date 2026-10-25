import type { DbConnection } from '../../generated'
import { useMessagesStore } from '../../stores/messagesStore'
import { useDmStore } from '../../stores/dmStore'
import { mapDirectMessage, mapMessage, sameIdentity, toReducerIdentity } from './mappers'

const BATCH_SIZE = 200
const REFRESH_INTERVAL_MS = 5_000

/** Owned by one connection. Stopping it also invalidates in-flight responses. */
export function startHistoryRefresh(conn: DbConnection): () => void {
  const me = conn.identity?.toHexString() ?? ''
  if (!me) return () => {}
  let stopped = false
  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const current = () => !stopped && conn.isActive

  // ponytail: revalidate cached IDs instead of keeping a durable mutation feed.
  // Cost scales with loaded history; add scope revisions if this becomes costly.
  async function refresh() {
    if (running || !current()) return
    running = true
    clearTimeout(timer)
    try {
      for (const [key, cached] of Object.entries(useMessagesStore.getState().olderByChannel)) {
        const channelId = Number(key)
        for (let offset = 0; offset < cached.length && current(); offset += BATCH_SIZE) {
          const requested = cached.slice(offset, offset + BATCH_SIZE)
          const rows = await conn.procedures.refreshChannelMessages({
            channelId: BigInt(channelId), messageIds: requested.map(row => BigInt(row.id)),
          })
          if (!current()) return
          const live = [...conn.db.my_channel_messages.iter()].filter(row => row.channelId === BigInt(channelId)).map(mapMessage)
          useMessagesStore.getState().refreshOlderMessages(channelId, requested, rows.map(mapMessage), live)
        }
      }
      for (const [partner, cached] of Object.entries(useDmStore.getState().olderByConversation)) {
        for (let offset = 0; offset < cached.length && current(); offset += BATCH_SIZE) {
          const requested = cached.slice(offset, offset + BATCH_SIZE)
          const rows = await conn.procedures.refreshDirectMessages({
            partner: toReducerIdentity(partner), messageIds: requested.map(row => BigInt(row.id)),
          })
          if (!current()) return
          const live = [...conn.db.my_direct_messages.iter()].map(mapDirectMessage)
            .filter(row => (sameIdentity(row.senderIdentity, partner) && sameIdentity(row.recipientIdentity, me))
              || (sameIdentity(row.recipientIdentity, partner) && sameIdentity(row.senderIdentity, me)))
          useDmStore.getState().refreshOlderMessages(partner, requested, rows.map(mapDirectMessage), live)
        }
      }
    } catch (error) {
      // Released protocol-1 modules lack these additive procedures. Keep their
      // existing history behavior until upgrade/reconnect; don't retry endlessly.
      if (String(error) === 'No such procedure') stopped = true
      // Transport failures retain the cache and retry on the next cycle. The
      // connection heartbeat handles dead sockets and starts a fresh worker.
    } finally {
      running = false
      if (current()) timer = setTimeout(() => { void refresh() }, REFRESH_INTERVAL_MS)
    }
  }

  const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
  void refresh()
  return () => {
    stopped = true
    clearTimeout(timer)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
  }
}
