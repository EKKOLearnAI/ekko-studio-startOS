import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { configuration, main, processIdentity, serviceEnvironment } from '../app/control.mjs'

test('requires explicit safe fnOS target and data paths', () => {
  for (const env of [{}, { TRIM_APPDEST: '/', TRIM_PKGVAR: '/var/test' },
    { TRIM_APPDEST: '/target', TRIM_PKGVAR: 'relative' },
    { TRIM_APPDEST: '/target', TRIM_PKGVAR: '/state', TRIM_SERVICE_PORT: '22' }]) {
    assert.throws(() => configuration(env))
  }
})
test('data and managed runtimes use fnOS persistent state and private Node', () => {
  const config = configuration({ TRIM_APPDEST: '/target', TRIM_PKGVAR: '/state' })
  const env = serviceEnvironment(config, { wizard_admin_password: 'test-only', TRIM_API_TOKEN: 'test-only', AUTH_TOKEN: 'test-only' })
  assert.equal(env.HERMES_WEB_UI_HOME, '/state/studio')
  assert.equal(env.HOME, '/state/home')
  assert.equal(env.HERMES_AGENT_NODE, '/target/node/bin/node')
  assert.equal(env.HERMES_WEB_UI_MCP_BIN, '/target/webui/bin/ekko-studio-mcp.mjs')
  for (const key of ['wizard_admin_password', 'TRIM_API_TOKEN', 'AUTH_TOKEN', 'HERMES_BIN']) assert.equal(env[key], undefined)
})
test('PID files cannot identify arbitrary or unrelated processes as the server', () => {
  for (const pid of [-1, 0, 1, '123', process.pid]) assert.equal(processIdentity(pid, '/not/the/server.js'), null)
})
test('root service operation is rejected before touching the filesystem', { skip: process.getuid() !== 0 }, async () => {
  await assert.rejects(main('start', { state: '/not-used' }), /non-root/)
})

test('FPK manifest and security runtime pins remain consistent', () => {
  const c = JSON.parse(readFileSync(new URL('../package-config.json', import.meta.url)))
  const manifest = readFileSync(new URL('../manifest', import.meta.url), 'utf8')
  assert.ok(manifest.includes(`version=${c.version}\n`))
  assert.equal(c.nodeVersion, '24.22.1')
  assert.deepEqual(Object.keys(c.nodeChecksums).sort(), ['arm64', 'x64'])
  for (const hash of Object.values(c.nodeChecksums)) assert.match(hash, /^[0-9a-f]{64}$/)
})
