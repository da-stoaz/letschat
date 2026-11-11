import { lt, valid } from 'semver'
import { version } from '../../package.json'
import type { WellKnown } from './discovery'

export const CLIENT_VERSION = version
export const SUPPORTED_CLIENT_PROTOCOLS: readonly number[] = [1]
export type CompatibilityResult = { status: 'compatible' | 'incompatible' | 'unknown'; message: string }

export function evaluateCompatibility(doc: WellKnown, clientVersion = CLIENT_VERSION): CompatibilityResult {
  const protocol = doc.clientProtocol
  const protocolValid = typeof protocol === 'number' && Number.isSafeInteger(protocol) && protocol > 0
  const minimum = typeof doc.minClient === 'string' ? valid(doc.minClient) : null
  const client = valid(clientVersion)
  if (protocolValid && !SUPPORTED_CLIENT_PROTOCOLS.includes(protocol)) {
    return { status: 'incompatible', message: 'This server uses a protocol this app does not support.' }
  }
  if (minimum && client && lt(client, minimum)) {
    return { status: 'incompatible', message: `This server requires LetsChat ${minimum} or newer.` }
  }
  if (!protocolValid || !minimum || !client) {
    return { status: 'unknown', message: 'This server does not provide complete compatibility information. You can try connecting, but some features may not work.' }
  }
  return { status: 'compatible', message: 'This app supports the server’s declared protocol.' }
}
