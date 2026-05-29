import os from 'node:os'

const port = process.argv[2] ?? ''
const ip = Object.values(os.networkInterfaces())
  .flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal)?.address

const suffix = port ? `:${port}` : ''
console.log(`\n  LAN: http://${ip ?? '<no-lan-ip>'}${suffix}\n`)