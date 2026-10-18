import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [input, destination, tool] = process.argv.slice(2)
const stage = resolve(input), output = resolve(destination), fnpack = resolve(tool)
const scripts = dirname(fileURLToPath(import.meta.url))
execFileSync(process.execPath, [join(scripts, 'verify.mjs'), stage], { stdio: 'inherit' })
const report = JSON.parse(readFileSync(join(stage, 'verification.json'), 'utf8'))
mkdirSync(output, { recursive: true })
execFileSync(fnpack, ['build'], { cwd: stage, stdio: 'inherit' })
const name = `ekko-studio_${report.version}_${report.platform}.fpk`
const artifact = join(output, name)
assert.ok(!existsSync(artifact), 'Refuse to overwrite an existing package')
copyFileSync(join(stage, 'ekko-studio.fpk'), artifact, constants.COPYFILE_EXCL)
const listing = execFileSync('tar', ['-tf', artifact], { encoding: 'utf8' }).trim().split('\n')
assert.ok(listing.every(path => !path.startsWith('/') && !path.split('/').includes('..')))
const inspection = mkdtempSync(join(tmpdir(), 'ekko-fpk-inspect-'))
try {
  execFileSync('tar', ['-xf', artifact, '-C', inspection])
  assert.equal(readFileSync(join(inspection, 'manifest'), 'utf8'), readFileSync(join(stage, 'manifest'), 'utf8'))
  assert.equal(readFileSync(join(inspection, 'config/privilege'), 'utf8'), readFileSync(join(stage, 'config/privilege'), 'utf8'))
  assert.equal(readFileSync(join(inspection, 'cmd/main'), 'utf8'), readFileSync(join(stage, 'cmd/main'), 'utf8'))
  const payload = ['app.tgz', 'app.tar.gz', 'app.tar.xz'].find(name => existsSync(join(inspection, name)))
  assert.ok(payload, 'Expected the fnpack application archive')
  const members = execFileSync('tar', ['-tf', join(inspection, payload)], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\n')
  assert.ok(members.some(name => name.replace(/^\.\//, '') === 'control.mjs'))
  assert.ok(members.some(name => name.replace(/^\.\//, '') === 'node/bin/node'))
  assert.ok(members.some(name => name.replace(/^\.\//, '') === 'webui/dist/server/index.js'))
  assert.ok(members.every(name => !name.startsWith('/') && !name.split('/').includes('..')))
} finally { rmSync(inspection, { recursive: true, force: true }) }
const sha256 = createHash('sha256').update(readFileSync(artifact)).digest('hex')
writeFileSync(artifact + '.sha256', `${sha256}  ${name}\n`)
writeFileSync(artifact + '.verification.json', JSON.stringify({
  ...report, sha256, wrapperCommit: readFileSync(join(stage, 'wrapper-commit.txt'), 'utf8').trim(),
  provenance: JSON.parse(readFileSync(join(stage, 'build-provenance.json'), 'utf8')),
}, null, 2) + '\n')
copyFileSync(join(stage, 'build-provenance.json'), artifact + '.provenance.json')
console.log(`Verified ${name}: ${sha256}`)
