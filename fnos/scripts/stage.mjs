import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [source, node, output, arch] = process.argv.slice(2)
const config = JSON.parse(readFileSync(join(root, 'package-config.json'), 'utf8'))
if (!['x64', 'arm64'].includes(arch) || !output || existsSync(output)) throw new Error('Use a new output directory and supported architecture')
if (JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version !== config.sourceVersion) throw new Error('Unexpected upstream version')
mkdirSync(output, { recursive: true })
for (const name of ['app', 'cmd', 'config', 'wizard', 'ICON.PNG', 'ICON_256.PNG']) {
  cpSync(join(root, name), join(output, name), { recursive: true })
}
cpSync(existsSync(join(root, 'LICENSE')) ? join(root, 'LICENSE') : join(root, '../LICENSE'), join(output, 'app/LICENSE'))
writeFileSync(join(output, 'manifest'), readFileSync(join(root, 'manifest'), 'utf8').replace('@PLATFORM@', arch === 'x64' ? 'x86' : 'arm'))
for (const name of ['install_init', 'upgrade_callback', 'uninstall_callback', 'config_init', 'config_callback']) {
  writeFileSync(join(output, 'cmd', name), '#!/bin/bash\nexit 0\n')
}
for (const name of readdirSync(join(output, 'cmd'))) chmodSync(join(output, 'cmd', name), 0o755)
cpSync(node, join(output, 'app/node'), { recursive: true, verbatimSymlinks: true })
const webui = join(output, 'app/webui')
mkdirSync(webui)
for (const name of ['package.json', 'package-lock.json', 'bin', 'dist', 'node_modules']) {
  cpSync(join(source, name), join(webui, name), { recursive: true, verbatimSymlinks: true })
}
for (const [directory, keep, prefix] of [
  ['node_modules/node-pty/prebuilds', `linux-${arch}`, ''],
  ['node_modules/agent-browser/bin', `agent-browser-linux-${arch}`, 'agent-browser-'],
]) {
  const path = join(webui, directory)
  if (!existsSync(path)) continue
  for (const name of readdirSync(path)) {
    if (name.startsWith(prefix) && name !== keep) rmSync(join(path, name), { recursive: true, force: true })
  }
}
writeFileSync(join(output, 'build-provenance.json'), JSON.stringify({
  ...config, architecture: arch, distributor: 'EKKOLearnAI', sourceRepository: 'EKKOLearnAI/ekko-studio',
  wrapperRepository: 'EKKOLearnAI/ekko-studio-startOS', fnosDeviceTested: false,
}, null, 2) + '\n')
