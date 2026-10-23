import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readdirSync, readSync, realpathSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const root = resolve(process.argv[2])
const metadata = Object.fromEntries(readFileSync(join(root, 'manifest'), 'utf8').trim().split('\n').map(line => {
  const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]
}))
assert.equal(metadata.appname, 'ekko-studio')
assert.match(metadata.version, /^\d+\.\d+\.\d+-\d+$/)
assert.ok(['x86', 'arm'].includes(metadata.platform))
assert.equal(metadata.distributor, 'EKKOLearnAI')
assert.equal(metadata.maintainer, 'EKKOLearnAI')
assert.equal(metadata.distributor_url, 'https://github.com/EKKOLearnAI/ekko-studio-startOS')
assert.equal(metadata.service_port, '8648')
const privilege = JSON.parse(readFileSync(join(root, 'config/privilege'), 'utf8'))
assert.equal(privilege.defaults['run-as'], 'package')
assert.equal(privilege.username, 'ekko-studio')
assert.equal(privilege.groupname, 'ekko-studio')
const entry = JSON.parse(readFileSync(join(root, 'app/ui/config'), 'utf8'))['.url'][metadata.desktop_applaunchname]
assert.equal(entry.port, metadata.service_port)
assert.equal(entry.type, 'url')
for (const path of ['app/control.mjs', 'app/node/bin/node', 'app/webui/dist/server/index.js', 'wizard/install']) {
  assert.ok(existsSync(join(root, path)), path)
}
for (const name of readdirSync(join(root, 'cmd'))) {
  const path = join(root, 'cmd', name)
  assert.equal(lstatSync(path).mode & 0o777, 0o755)
  execFileSync('bash', ['-n', path])
}
let elfFiles = 0
const expectedMachine = metadata.platform === 'x86' ? 62 : 183
function visit(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name)
    if (item.isSymbolicLink()) {
      const target = relative(root, realpathSync(path))
      assert.ok(target !== '..' && !target.startsWith(`..${sep}`), `External symlink: ${path}`)
    } else if (item.isDirectory()) {
      assert.ok(!['.venv', 'hermes-agent'].includes(item.name), `Bundled Hermes source/environment: ${path}`)
      visit(path)
    } else if (item.isFile()) {
      const header = Buffer.alloc(20), fd = openSync(path, 'r')
      try { readSync(fd, header, 0, 20, 0) } finally { closeSync(fd) }
      if (!header.subarray(0, 4).equals(Buffer.from([0x7f, 69, 76, 70]))) continue
      assert.equal(header.readUInt16LE(18), expectedMachine, `Wrong ELF architecture: ${path}`)
      const versions = execFileSync('readelf', ['--version-info', path], { encoding: 'utf8' })
      for (const match of versions.matchAll(/\bGLIBC_(\d+)\.(\d+)\b/g)) {
        assert.ok(Number(match[1]) < 2 || (Number(match[1]) === 2 && Number(match[2]) <= 35), `Newer than glibc 2.35: ${path}`)
      }
      elfFiles++
    }
  }
}
visit(join(root, 'app'))
assert.ok(elfFiles > 0)
const report = { package: metadata.appname, version: metadata.version, platform: metadata.platform,
  distributor: metadata.distributor, elfFiles, privilege: 'package', fnosDeviceTested: false }
writeFileSync(join(root, 'verification.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
