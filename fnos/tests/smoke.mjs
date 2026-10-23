import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

assert.notEqual(process.getuid(), 0, 'Smoke test must execute as the package user')
const payload = resolve(process.argv[2])
const state = mkdtempSync(join(tmpdir(), 'ekko-fnos-smoke-'))
const password = randomBytes(24).toString('hex')
const env = { ...process.env, TRIM_APPDEST: join(payload, 'app'), TRIM_PKGVAR: state,
  TRIM_SERVICE_PORT: '18648', wizard_admin_password: password }
const control = join(payload, 'cmd/main')
const run = (action, overrides = {}) => execFileSync('bash', [control, action], {
  env: { ...env, ...overrides }, timeout: 150000, encoding: 'utf8',
})
const status = () => spawnSync('bash', [control, 'status'], { env }).status
const base = 'http://127.0.0.1:18648'
// Lifecycle commands synchronously stop/restart the server. Do not reuse an old
// keep-alive socket while this test's event loop is blocked by those commands.
const request = (path, options = {}) => fetch(base + path, {
  ...options, signal: AbortSignal.timeout(10000), headers: { ...options.headers, Connection: 'close' },
})
const post = (path, body, token) => request(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
})
const login = async value => {
  const response = await post('/api/auth/login', { username: 'admin', password: value })
  assert.equal(response.status, 200)
  return (await response.json()).token
}
try {
  assert.equal(status(), 3)
  assert.notEqual(spawnSync('bash', [control, 'start'], { env }).status, 0, 'Unconfigured service must not expose default credentials')
  run('install')
  assert.equal(existsSync(join(state, 'bootstrap-password')), false)
  assert.equal(statSync(join(state, 'credentials-initialized')).mode & 0o777, 0o600)
  run('start')
  assert.equal(status(), 0)
  const firstPid = JSON.parse(readFileSync(join(state, 'server.json'), 'utf8'))
  run('start')
  assert.equal(JSON.parse(readFileSync(join(state, 'server.json'), 'utf8')).pid, firstPid.pid)
  const proc = readFileSync(`/proc/${firstPid.pid}/status`, 'utf8')
  assert.equal(Number(proc.match(/^Uid:\s+(\d+)/m)[1]), process.getuid())
  let token = await login(password)
  assert.equal((await post('/api/auth/login', { username: 'admin', password: '123456' })).status, 401)
  assert.equal((await request('/api/studio/files/read?path=probe.txt')).status, 401)
  const api = (path, options = {}) => request(path, {
    ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  assert.equal((await api('/api/studio/files/write', {
    method: 'PUT', body: JSON.stringify({ path: 'fnos-probe.txt', content: 'retained' }),
  })).status, 200)
  assert.ok([400, 403].includes((await api('/api/studio/files/read?path=..%2F..%2Fetc%2Fpasswd')).status), 'Traversal must be rejected')
  const runtime = await api('/api/hermes/runtime-versions?remote=false')
  assert.equal(runtime.status, 200)
  assert.equal(JSON.stringify(await runtime.json()).includes('managed-runtime'), false)
  const socket = await request('/socket.io/?EIO=4&transport=polling')
  assert.equal(socket.status, 200)
  assert.ok((await socket.text()).startsWith('0'))
  assert.equal((await request('/')).status, 200)
  run('stop')
  assert.equal(status(), 3)
  // An unrelated live PID must neither count as our server nor be signalled.
  writeFileSync(join(state, 'server.json'), JSON.stringify({ pid: process.pid, started: 'fake' }))
  assert.equal(status(), 3)
  run('stop')
  run('install', { wizard_admin_password: randomBytes(24).toString('hex') })
  run('start')
  token = await login(password)
  const file = await api('/api/studio/files/read?path=fnos-probe.txt')
  assert.equal((await file.json()).content, 'retained')
  assert.equal(existsSync(join(state, 'bootstrap-password')), false)
  console.log(JSON.stringify({ architecture: process.arch, uid: process.getuid(), nonRoot: true,
    login: true, defaultPasswordRejected: true, unauthenticatedApiRejected: true,
    traversalRejected: true, socketTransport: true, runtimeInitiallyAbsent: true,
    restartPersistence: true, reconfigurePreservesPassword: true, fnosDeviceTested: false }))
} finally {
  try { run('stop') } finally { rmSync(state, { recursive: true, force: true }) }
}
