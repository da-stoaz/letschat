#!/usr/bin/env bun
// Runs core-api with all the discovery URLs rewritten from `localhost` to the
// host's first non-internal IPv4. This lets the desktop client on another
// device (LAN VM, phone, second machine) reach the host's services AND have
// the `/.well-known/letschat.json` discovery response advertise the same IP
// so the client doesn't fall back to `localhost`.

import os from 'node:os'
import { spawn } from 'node:child_process'

const lanIp = Object.values(os.networkInterfaces())
  .flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal)?.address

if (!lanIp) {
  console.error('No non-internal IPv4 interface found. Are you on a network?')
  process.exit(1)
}

const authPort = Number(process.env.AUTH_PORT ?? 8787)
const adminPort = Number(process.env.ADMIN_PORT ?? 8788)
const spacetimePort = Number(process.env.SPACETIMEDB_PORT ?? 4300)
const livekitPort = Number(process.env.LIVEKIT_PORT ?? 7880)
const minioPort = Number(process.env.MINIO_PORT ?? 4390)

const env: NodeJS.ProcessEnv = {
  ...process.env,
  ASPNETCORE_ENVIRONMENT: 'Development',

  // Bind the public API to all interfaces; admin stays loopback.
  AUTH_BIND: `0.0.0.0:${authPort}`,
  ADMIN_BIND: `127.0.0.1:${adminPort}`,

  // URLs that the client receives and dials directly. All must point at the
  // LAN IP so a remote client doesn't try to hit its own loopback.
  DISCOVERY_AUTH_URL: `http://${lanIp}:${authPort}`,
  DISCOVERY_SPACETIMEDB_URI: `ws://${lanIp}:${spacetimePort}`,
  DISCOVERY_LIVEKIT_URL: `ws://${lanIp}:${livekitPort}`,
  // Baked into MinIO presigned upload/download URLs. core-api still talks
  // to MinIO over the internal endpoint (which stays localhost).
  MINIO_PUBLIC_ENDPOINT: `http://${lanIp}:${minioPort}`,
}

console.log()
console.log(`  LAN IP : ${lanIp}`)
console.log(`  Public : http://${lanIp}:${authPort}`)
console.log(`  Admin  : http://127.0.0.1:${adminPort}/admin  (loopback-only)`)
console.log(`  Discov : http://${lanIp}:${authPort}/.well-known/letschat.json`)
console.log()

const child = spawn(
  'dotnet',
  ['run', '--project', 'core-api/src/CoreApi/CoreApi.csproj'],
  { stdio: 'inherit', env },
)
child.on('exit', (code) => process.exit(code ?? 0))
