import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { isAbsolute, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

export function configuration(env = process.env) {
  for (const key of ['TRIM_APPDEST', 'TRIM_PKGVAR']) {
    if (!env[key] || !isAbsolute(env[key]) || resolve(env[key]) === '/') throw new Error(`Missing or unsafe ${key}`)
  }
  const port = Number(env.TRIM_SERVICE_PORT || 8648)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid service port')
  const target = resolve(env.TRIM_APPDEST)
  const state = resolve(env.TRIM_PKGVAR)
  return { target, state, port, node: join(target, 'node/bin/node'),
    server: join(target, 'webui/dist/server/index.js'), webui: join(target, 'webui'),
    pid: join(state, 'server.json'), ready: join(state, 'credentials-initialized'),
    pending: join(state, 'bootstrap-password') }
}

export function serviceEnvironment(config, inherited = process.env) {
  const env = { ...inherited }
  // The installation password and NAS API token are not runtime inputs.
  delete env.wizard_admin_password
  delete env.TRIM_API_TOKEN
  delete env.AUTH_TOKEN
  return { ...env, NODE_ENV: 'production', HOME: join(config.state, 'home'),
    HERMES_HOME: join(config.state, 'home/.hermes'),
    HERMES_WEB_UI_HOME: join(config.state, 'studio'), HERMES_WEBUI_STATE_DIR: join(config.state, 'studio'),
    WORKSPACE_BASE: join(config.state, 'workspaces'), TMPDIR: join(config.state, 'tmp'),
    XDG_CACHE_HOME: join(config.state, 'cache'), NPM_CONFIG_PREFIX: join(config.state, 'npm'),
    HERMES_WEB_UI_MCP_BIN: join(config.webui, 'bin/ekko-studio-mcp.mjs'),
    HERMES_AGENT_NODE: config.node, HERMES_WEB_UI_DISABLE_UPDATE_CHECK: '1',
    HERMES_WEB_UI_DISABLE_GATEWAY_AUTOSTART: '1', HERMES_LAN_DISCOVERY_ENABLED: 'false',
    STUDIO_P2P_ENABLED: '0', BIND_HOST: '0.0.0.0', PORT: String(config.port),
    PATH: `${join(config.state, 'npm/bin')}:${join(config.target, 'node/bin')}:/usr/local/bin:/usr/bin:/bin` }
}

function directories(config) {
  for (const name of ['', 'home', 'studio', 'workspaces', 'tmp', 'cache', 'npm']) {
    const path = join(config.state, name)
    mkdirSync(path, { recursive: true, mode: 0o700 })
    chmodSync(path, 0o700)
  }
}

export function processIdentity(pid, server, uid = process.getuid()) {
  if (!Number.isInteger(pid) || pid <= 1) return null
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    if (Number(status.match(/^Uid:\s+(\d+)/m)?.[1]) !== uid) return null
    const args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')
    if (!args.includes(server)) return null
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    if (fields[0] === 'Z') return null
    return { pid, started: fields[19] }
  } catch { return null }
}

function running(config) {
  try {
    const saved = JSON.parse(readFileSync(config.pid, 'utf8'))
    const actual = processIdentity(saved.pid, config.server)
    return actual && actual.started === saved.started ? actual : null
  } catch { return null }
}

async function stop(config) {
  const identity = running(config)
  if (identity) {
    // The server is a session leader. Signal only its verified process group.
    process.kill(-identity.pid, 'SIGTERM')
    for (let attempt = 0; attempt < 100 && running(config); attempt++) await delay(100)
    if (running(config)) process.kill(-identity.pid, 'SIGKILL')
  }
  rmSync(config.pid, { force: true })
}

async function freePort() {
  const probe = createServer()
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve) })
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  return port
}

async function bootstrap(config) {
  if (existsSync(config.ready)) return
  if (!existsSync(config.pending)) throw new Error('Set an administrator password in the installation wizard before starting')
  const password = readFileSync(config.pending, 'utf8')
  if (password.length < 12 || password.length > 256) throw new Error('Administrator password must contain 12–256 characters')
  const env = serviceEnvironment(config)
  execFileSync(config.node, [join(config.webui, 'bin/hermes-web-ui.mjs'), 'reset-default-login'], {
    env, cwd: config.webui, stdio: 'ignore', timeout: 30000,
  })
  const port = await freePort()
  const child = spawn(config.node, [config.server], {
    env: { ...env, BIND_HOST: '127.0.0.1', PORT: String(port) }, cwd: config.webui, stdio: 'ignore',
  })
  const exited = once(child, 'exit')
  const base = `http://127.0.0.1:${port}`
  const post = (path, body, token) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  })
  try {
    let ready = false
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error('Private credential setup exited')
      try { ready = (await fetch(base + '/api/auth/status', { signal: AbortSignal.timeout(500) })).ok } catch {}
      if (ready) break
      await delay(500)
    }
    if (!ready || child.exitCode !== null) throw new Error('Private credential setup timed out')
    const first = await post('/api/auth/login', { username: 'admin', password: '123456' })
    if (!first.ok) throw new Error('Upstream credential initialization failed')
    const { token } = await first.json()
    const changed = await post('/api/auth/change-password', { currentPassword: '123456', newPassword: password }, token)
    if (!changed.ok || !(await changed.json()).success) throw new Error('Upstream password change failed')
    const login = await post('/api/auth/login', { username: 'admin', password })
    if (!login.ok || (await post('/api/auth/login', { username: 'admin', password: '123456' })).status !== 401) {
      throw new Error('Administrator password verification failed')
    }
    writeFileSync(config.ready, 'Initialized through the upstream authenticated API.\n', { mode: 0o600 })
    rmSync(config.pending)
  } finally {
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000)
    try { await exited } finally { clearTimeout(timer) }
  }
}

export async function main(action, config = configuration()) {
  if (process.getuid() === 0) throw new Error('Ekko Studio must run as the dedicated non-root package user')
  if (action === 'status') return running(config) ? 0 : 3
  if (action === 'stop') { await stop(config); return 0 }
  directories(config)
  if (action === 'install') {
    if (!existsSync(config.ready)) {
      const password = process.env.wizard_admin_password || ''
      if (password.length < 12 || password.length > 256) throw new Error('Administrator password must contain 12–256 characters')
      writeFileSync(config.pending, password, { mode: 0o600 })
      await bootstrap(config)
    }
    return 0
  }
  if (action !== 'start') throw new Error('Unsupported service operation')
  if (running(config)) return 0
  await bootstrap(config)
  const logfile = join(config.state, 'server.log')
  if (existsSync(logfile) && statSync(logfile).size > 10 * 1024 * 1024) renameSync(logfile, logfile + '.1')
  const log = openSync(logfile, 'a', 0o600)
  const child = spawn(config.node, [config.server], {
    detached: true, cwd: config.webui, env: serviceEnvironment(config), stdio: ['ignore', log, log],
  })
  closeSync(log)
  await once(child, 'spawn')
  child.unref()
  try {
    let identity
    for (let attempt = 0; attempt < 50 && !identity; attempt++) {
      identity = processIdentity(child.pid, config.server)
      if (!identity) await delay(20)
    }
    if (!identity) throw new Error('Server process did not initialize')
    writeFileSync(config.pid, JSON.stringify(identity), { mode: 0o600 })
    for (let attempt = 0; attempt < 120; attempt++) {
      if (!running(config)) throw new Error('Server exited; see the application server.log')
      try {
        if ((await fetch(`http://127.0.0.1:${config.port}/api/auth/status`, { signal: AbortSignal.timeout(500) })).ok) return 0
      } catch {}
      await delay(500)
    }
    throw new Error('Server startup timed out; see the application server.log')
  } catch (error) { await stop(config); throw error }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(process.argv[2]) }
  catch (error) {
    const message = String(error.message)
    if (process.env.TRIM_TEMP_LOGFILE) {
      try { writeFileSync(process.env.TRIM_TEMP_LOGFILE, message + '\n', { mode: 0o600 }) } catch {}
    }
    console.error(message)
    process.exitCode = 1
  }
}
