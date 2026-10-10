// Isolated real-browser media test. Run with: bun --no-env-file tests/rtc/run.ts
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { networkInterfaces, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
type FixtureConfig = { services: Record<string, { networks: string[]; image: string }>; port: number; rtc: Record<string, unknown> }
const readYaml = async (path: string) => Bun.YAML.parse(await readFile(join(root, path), 'utf8')) as FixtureConfig
const production = await readYaml('docker-compose.prod.base.yml')
const networks = production.services.livekit.networks as string[]
const network = networks.find(name => production.services['core-api'].networks.includes(name)
  && name === 'proxy')
assert(network, 'The fixture needs the shared proxy network')
assert(production.services['core-api'].networks.includes(network), 'core-api must still reach LiveKit')
for (const [file, proxy] of [['tunnel', 'cloudflared'], ['caddy', 'caddy']]) {
  assert((await readYaml(`docker-compose.prod.${file}.yml`)).services[proxy].networks.includes(network))
}

const context = process.env.RTC_DOCKER_CONTEXT ?? (process.platform === 'darwin' ? 'desktop-linux' : 'default')
const chrome = process.env.CHROME_BIN ?? (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
const address = process.env.RTC_TEST_IP ?? Object.values(networkInterfaces()).flat().find(ip => ip?.family === 'IPv4' && !ip.internal)?.address
assert(address, 'Set RTC_TEST_IP to a local IPv4 address reachable from Docker')
const port = Number(process.env.RTC_TEST_PORT ?? 17984)
const project = `lc-rtc-${randomUUID().slice(0, 8)}`
const directory = await mkdtemp(join(tmpdir(), 'letschat-rtc-'))
const secret = randomUUID()
const docker = ['docker', '--context', context]
async function command(args: string[]) {
  const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(`${args.slice(0, 4).join(' ')}: ${stderr}`)
  return stdout.trim()
}
const compose = [...docker, 'compose', '-p', project, '-f', join(directory, 'compose.json')]
const token = (room: string, identity: string, admin = false) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const payload = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: 'rtc-test', sub: identity,
    exp: Math.floor(Date.now() / 1000) + 600, video: admin ? { roomList: true } : { roomJoin: true, room, canPublish: true, canSubscribe: true } })}`
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}
const config = await readYaml('livekit/config.prod.yaml')
config.port = port
Object.assign(config.rtc, { use_external_ip: false, node_ip: address, tcp_port: port + 1, udp_port: port + 2 })
const writeConfig = () => writeFile(join(directory, 'livekit.yaml'), Bun.YAML.stringify(config))
await writeConfig()
await writeFile(join(directory, 'compose.json'), JSON.stringify({ services: { livekit: {
  image: production.services.livekit.image, networks,
  command: ['--config', '/etc/livekit.yaml'], environment: { LIVEKIT_KEYS: `rtc-test: ${secret}` },
  ports: [`127.0.0.1:${port}:${port}`, `${address}:${port + 1}:${port + 1}`, `${address}:${port + 2}:${port + 2}/udp`],
  volumes: [`${directory}/livekit.yaml:/etc/livekit.yaml:ro`],
} }, networks: Object.fromEntries(networks.map(name => [name, {}])) }))

const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'browser.ts')], target: 'browser', plugins: [{
  name: 'test-auth-and-presence', setup(builder) {
    // Only replace app authentication/presence. The call manager, SDK and
    // browser WebRTC implementation are real; presence has separate DB tests.
    builder.onResolve({ filter: /^\.\/(tauri|spacetimedb)$/ }, args => {
      if (args.importer.endsWith('/src/lib/livekit.ts')) return { path: args.path, namespace: 'rtc-test' }
    })
    builder.onLoad({ filter: /.*/, namespace: 'rtc-test' }, args => ({ loader: 'js', contents: args.path === './tauri'
      ? `export const tauriCommands={getLivekitUrl:async()=>window.rtcSignalUrl,generateLivekitToken:async(room,identity)=>(await(await fetch('/token',{method:'POST',body:JSON.stringify({room,identity})})).json()).token}`
      : 'export const reducers=new Proxy({}, {get:()=>async()=>{}})' }))
  },
}] })
assert(build.success, build.logs.join('\n'))
const bundle = await build.outputs[0].text()
const web = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const path = new URL(request.url).pathname
  if (path === '/token') { const { room, identity } = await request.json(); return Response.json({ token: token(room, identity) }) }
  if (path === '/bundle.js') return new Response(bundle, { headers: { 'Content-Type': 'text/javascript' } })
  return new Response(`<script>window.rtcSignalUrl="ws://127.0.0.1:${port}"</script><script src="/bundle.js"></script>`, { headers: { 'Content-Type': 'text/html' } })
} })
async function waitFor<T>(read: () => Promise<T>, timeout = 15000): Promise<T> {
  const deadline = Date.now() + timeout
  do { try { return await read() } catch { await Bun.sleep(100) } } while (Date.now() < deadline)
  throw new Error('Timed out waiting for the local RTC fixture')
}
let browser: ReturnType<typeof Bun.spawn> | undefined
let socket: WebSocket | undefined
try {
  await command([...compose, 'up', '-d'])
  browser = Bun.spawn([chrome, '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${directory}/chrome`,
    '--no-first-run', '--no-default-browser-check', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', 'about:blank'],
  { stdout: 'ignore', stderr: Bun.file(join(directory, 'chrome.log')) })
  const debugPort = await waitFor(async () => (await readFile(join(directory, 'chrome/DevToolsActivePort'), 'utf8')).split('\n')[0])
  const targets: { type: string; webSocketDebuggerUrl: string }[] = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
  socket = new WebSocket(targets.find(target => target.type === 'page')!.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => { socket!.onopen = () => resolve(); socket!.onerror = () => reject(new Error('Chrome debugger connection failed')) })
  let sequence = 0
  type CdpResult = { result: { value: unknown }; exceptionDetails?: unknown }
  const pending = new Map<number, { resolve: (value: CdpResult) => void; reject: (error: unknown) => void }>()
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data))
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(message.error); else request.resolve(message.result)
  }
  const cdp = (method: string, params = {}) => new Promise<CdpResult>((resolve, reject) => {
    const id = ++sequence
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)) }, 30000)
    pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value) }, reject: error => { clearTimeout(timeout); reject(error) } })
    socket!.send(JSON.stringify({ id, method, params }))
  })
  for (const forceTCP of [false, true]) {
    config.rtc.force_tcp = forceTCP
    await writeConfig()
    await command([...compose, 'restart', 'livekit'])
    await waitFor(async () => assert((await fetch(`http://127.0.0.1:${port}/`)).ok))
    // Exercise the same authenticated API route core-api uses on the shared
    // network; a media fix must not strand reconciliation/token management.
    const rooms = await command([...docker, 'run', '--rm', '--network', `${project}_${network}`, '--entrypoint', 'wget', production.services.livekit.image,
      '-qO-', '--header=Content-Type: application/json', `--header=Authorization: Bearer ${token('', 'core-api', true)}`,
      '--post-data={}', `http://livekit:${port}/twirp/livekit.RoomService/ListRooms`])
    assert.doesNotThrow(() => JSON.parse(rooms))
    await cdp('Page.navigate', { url: web.url.toString() })
    await waitFor(async () => { const result = await cdp('Runtime.evaluate', { expression: 'typeof window.rtcProbe' }); assert.equal(result.result.value, 'function') })
    const result = await cdp('Runtime.evaluate', { expression: 'window.rtcProbe()', awaitPromise: true, returnByValue: true })
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
    const probe = result.result.value as { audioBytes: number; protocol: string }
    assert(probe.audioBytes > 0)
    assert.equal(probe.protocol, forceTCP ? 'tcp' : 'udp')
    console.log(`${probe.protocol.toUpperCase()}: hidden LAN candidates, authenticated internal API, join and received audio OK (${probe.audioBytes} bytes)`)
  }
} finally {
  socket?.close()
  browser?.kill()
  if (browser) await browser.exited
  web.stop(true)
  await command([...compose, 'down', '--volumes', '--remove-orphans'])
  await rm(directory, { recursive: true, force: true })
}
