import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const pkg = JSON.parse(readFileSync('package.json'));
const manifest = JSON.parse(readFileSync('addon/manifest.json'));
const lock = JSON.parse(readFileSync('package-lock.json'));
assert.equal(pkg.version, manifest.version);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[''].version, pkg.version);
assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
const feed = JSON.parse(readFileSync('updates.json'));
const entries = feed.addons[manifest.applications.zotero.id].updates;
assert.ok(Array.isArray(entries));
const versions = new Set();
for (const entry of entries) {
  assert.ok(!versions.has(entry.version)); versions.add(entry.version);
  assert.equal(entry.update_link, `https://github.com/lllaterOn/zotero-bilingual-outline/releases/download/v${entry.version}/zotero-bilingual-outline-${entry.version}.xpi`);
  assert.match(entry.update_hash, /^sha256:[a-f0-9]{64}$/);
  assert.ok(entry.applications.zotero.strict_min_version);
  assert.ok(entry.applications.zotero.strict_max_version);
}
const names = execFileSync('git', ['ls-files', '-z'], {encoding:'utf8'}).split('\0').filter(Boolean);
assert.ok(names.length, 'Stage the clean repository before verification');
for (const name of names) {
  assert.ok(!/^(node_modules|dist|\.build|\.cache|inputs)\/|^addon\/runtime\.js$|(^|\/)\.env(?:\.|$)|\.log$|\.local\.json$/.test(name), `Unwanted file: ${name}`);
  const text = readFileSync(name, 'utf8');
  assert.ok(!/\bsk-[A-Za-z0-9_-]{20,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text), `Possible secret: ${name}`);
  assert.ok(!/[A-Za-z]:[\\/](?:Users|Program Files)[\\/]/.test(text), `Machine path: ${name}`);
}
console.log('Repository files, versions and update feed verified');
