import { Timestamp } from 'spacetimedb'
import { callProcedure } from './connection'
import { mapDirectMessage, mapMessage, toReducerIdentity, type DbRow } from './mappers'
import { useMessagesStore } from '../../stores/messagesStore'
import { useDmStore } from '../../stores/dmStore'
import type { Identity, u64 } from '../../types/domain'

/**
 * Paging over the history the subscription views do not carry.
 *
 * `my_channel_messages` / `my_direct_messages` deliver only the newest
 * `RECENT_MESSAGE_WINDOW` rows per channel and per conversation, so scrolling
 * past that edge asks the module for the next page instead of the client
 * holding everything from connect (BUG_ANALYSIS C3).
 */

/** Rows per request. Under the module's own `MAX_PAGE`, which clamps anyway. */
const PAGE_SIZE = 100

// In-flight guards, keyed by channel id / partner identity. Transient by
// design: a rejected call clears its key, so the next scroll retries.
const channelRequests = new Set<u64>()
const dmRequests = new Set<Identity>()

function beforeTimestamp(sentAt: string): Timestamp {
  return Timestamp.fromDate(new Date(sentAt))
}

/**
 * Fetch the page of channel history directly older than what is loaded.
 *
 * A no-op while a request for that channel is in flight, once the module has
 * reported the channel exhausted, or before the subscription has delivered
 * anything to page back from.
 */
export async function loadOlderChannelMessages(channelId: u64): Promise<void> {
  if (channelRequests.has(channelId)) return

  const store = useMessagesStore.getState()
  if (store.historyExhausted[channelId]) return
  const oldest = (store.messagesByChannel[channelId] ?? [])[0]
  if (!oldest) return

  channelRequests.add(channelId)
  try {
    const rows = await callProcedure<DbRow[]>('loadOlderChannelMessages', {
      channelId: BigInt(channelId),
      before: beforeTimestamp(oldest.sentAt),
      limit: PAGE_SIZE,
    })
    // A short page means the module had nothing more to give.
    useMessagesStore.getState().prependOlderMessages(channelId, rows.map(mapMessage), rows.length < PAGE_SIZE)
  } finally {
    channelRequests.delete(channelId)
  }
}

/** The DM equivalent of {@link loadOlderChannelMessages}, per conversation. */
export async function loadOlderDirectMessages(partner: Identity): Promise<void> {
  if (dmRequests.has(partner)) return

  const store = useDmStore.getState()
  if (store.historyExhausted[partner]) return
  const oldest = (store.conversations[partner] ?? [])[0]
  if (!oldest) return

  dmRequests.add(partner)
  try {
    const rows = await callProcedure<DbRow[]>('loadOlderDirectMessages', {
      partner: toReducerIdentity(partner),
      before: beforeTimestamp(oldest.sentAt),
      limit: PAGE_SIZE,
    })
    useDmStore
      .getState()
      .prependOlderMessages(partner, rows.map(mapDirectMessage), rows.length < PAGE_SIZE)
  } finally {
    dmRequests.delete(partner)
  }
}
