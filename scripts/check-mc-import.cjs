// Проверка групп версий, фильтра NeoForge и разбора mrpack без GUI.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { classifyMcVersion } = require('../dist/shared/mcVersionGroups');
const { neoforgeMatchesMinecraft, listLoaderVersions } = require('../dist/main/loaderVersions');
const { inspectLocalModpack } = require('../dist/main/importModpack');

const samples = [
  ['1.21.4', 'release', 'release'],
  ['24w14a', 'snapshot', 'snapshot'],
  ['b1.7.3', 'old_beta', 'old_beta'],
  ['a1.2.6', 'old_alpha', 'old_alpha'],
  ['rd-132211', 'old_alpha', 'ancient'],
  ['c0.30_01c', 'old_alpha', 'ancient'],
  ['inf-20100618', 'old_alpha', 'ancient'],
];

let failed = 0;
for (const [id, type, expect] of samples) {
  const got = classifyMcVersion(id, type);
  if (got !== expect) {
    failed++;
    console.error(`classify ${id}: ${got} != ${expect}`);
  }
}
if (neoforgeMatchesMinecraft('21.1.172', '1.21.1') !== true) {
  failed++;
  console.error('neoforge 21.1.172 should match 1.21.1');
}
if (neoforgeMatchesMinecraft('21.10.1', '1.21.1') !== false) {
  failed++;
  console.error('neoforge 21.10.1 must not match 1.21.1');
}
if (neoforgeMatchesMinecraft('21.1.80-beta', '1.21.1') !== true) {
  failed++;
  console.error('neoforge beta should match 1.21.1');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uclient-mrpack-'));
const pack = path.join(tmp, 'pack');
fs.mkdirSync(path.join(pack, 'overrides', 'saves', 'TestWorld'), { recursive: true });
fs.mkdirSync(path.join(pack, 'overrides', 'mods'), { recursive: true });
fs.writeFileSync(path.join(pack, 'overrides', 'saves', 'TestWorld', 'level.dat'), 'x');
fs.writeFileSync(path.join(pack, 'overrides', 'mods', 'example.jar'), 'jar');
fs.writeFileSync(path.join(pack, 'modrinth.index.json'), JSON.stringify({
  formatVersion: 1,
  name: 'Check Pack',
  dependencies: { minecraft: '1.20.1', 'fabric-loader': '0.15.11' },
  files: [],
}));
const zipPath = path.join(tmp, 'check.mrpack');
const zipTmp = path.join(tmp, 'check.zip');
execFileSync('tar', ['-a', '-c', '-f', zipTmp, '-C', pack, '.'], { stdio: 'ignore' });
fs.copyFileSync(zipTmp, zipPath);
const inspect = inspectLocalModpack(zipPath);
if (inspect.format !== 'modrinth' || inspect.gameVersion !== '1.20.1' || inspect.loader !== 'fabric') {
  failed++;
  console.error('mrpack inspect failed', inspect);
}
if (!inspect.counts || !inspect.counts.worlds) {
  failed++;
  console.error('mrpack world was not detected', inspect.counts);
} else {
  console.log('mrpack', inspect.format, inspect.name, inspect.gameVersion, inspect.loader, 'worlds', inspect.counts.worlds);
}

(async () => {
  try {
    const neo = await listLoaderVersions('neoforge', '1.21.1');
    console.log('neoforge 1.21.1', neo.versions?.length || 0, neo.error || neo.unavailable || 'ok', neo.versions?.[0] || '');
    if (!neo.versions?.length) failed++;
    if ((neo.versions || []).some((v) => String(v).startsWith('21.10'))) {
      failed++;
      console.error('1.21.1 list leaked 21.10');
    }
    const neo1201 = await listLoaderVersions('neoforge', '1.20.1');
    const prefixed = (neo1201.versions || []).filter((v) => String(v).startsWith('1.20.1-47.1.'));
    console.log('neoforge 1.20.1', neo1201.versions?.length || 0, 'prefixed', prefixed.length, 'first', neo1201.versions?.[0] || '');
    if (prefixed.length < 40) {
      failed++;
      console.error('1.20.1 NeoForge list is incomplete');
    }
    const sample = prefixed[0];
    if (sample) {
      const jar = `https://maven.neoforged.net/releases/net/neoforged/forge/${sample}/forge-${sample}-installer.jar`;
      const head = await fetch(jar, { method: 'HEAD', headers: { 'User-Agent': 'Undefined-Client' } });
      console.log('installer', sample, head.status, head.headers.get('content-length') || '');
      if (!head.ok) failed++;
    }
  } catch (err) {
    console.error('neoforge fetch', err instanceof Error ? err.message : err);
    failed++;
  }
  if (failed) {
    console.error('checks failed', failed);
    process.exit(1);
  }
  console.log('checks ok');
})();
