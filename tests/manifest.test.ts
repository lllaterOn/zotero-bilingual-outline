import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Zotero install requires id, update_url and strict_max_version; update address uses HTTPS', () => {
  const manifest = JSON.parse(readFileSync('addon/manifest.json', 'utf8'));
  // Zotero 10.0.2 modules/Extension.sys.mjs parseManifest() rejects absent fields.
  function validate(m: any) {
    for (const field of ['id', 'update_url', 'strict_max_version']) {
      assert.ok(m.applications?.zotero?.[field], `applications.zotero.${field} not provided`);
    }
  }
  validate(manifest);
  const broken = structuredClone(manifest);
  delete broken.applications.zotero.update_url;
  assert.throws(() => validate(broken), /update_url not provided/);
  const app = manifest.applications.zotero;
  const url = new URL(app.update_url);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.href, 'https://raw.githubusercontent.com/lllaterOn/zotero-bilingual-outline/main/updates.json');
  // The host's providesUpdatesSecurely getter rejects the previous data URL.
  const secure = (updateURL: string) => !updateURL || updateURL.startsWith('https:');
  assert.equal(secure(app.update_url), true);
  assert.equal(secure('data:application/json;base64,e30='), false);
});
