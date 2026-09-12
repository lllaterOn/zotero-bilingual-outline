import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { mountPreferences } from '../src/preferences';

test('host loads script before fragment; load event mounts controls; key stays local and handlers dispose', async () => {
  const dom = new JSDOM('<html><body></body></html>', { runScripts: 'outside-only' });
  const w: any = dom.window;
  const values = new Map<string, any>([['apiKey', 'test-secret']]);
  let saves = 0, dispose = () => {};
  const storage: any = { status: '本机', getSyncInfo: () => ({ connected: true, settingsConflict: false }), getSettings: () => ({ showChinese: true }), subscribe: () => () => {}, sync: async () => { saves++; } };
  const prefs: any = { get: (k: string, fallback: any) => values.has(k) ? values.get(k) : fallback, set: (k: string, v: any) => values.set(k, v) };
  w.Zotero = { BilingualOutline: { mountPreferences: () => { dispose = mountPreferences(w, storage, prefs); } } };
  w.eval(readFileSync('addon/preferences.js', 'utf8'));
  const xml = new w.DOMParser().parseFromString(readFileSync('addon/preferences.xhtml', 'utf8'), 'application/xml');
  assert.equal(xml.querySelector('parsererror'), null);
  w.document.body.append(w.document.importNode(xml.documentElement, true));
  w.document.getElementById('bo-pane').dispatchEvent(new w.Event('load'));
  assert.equal(w.document.getElementById('bo-chinese'), null);
  const key = w.document.getElementById('bo-key');
  assert.equal(key.value, ''); assert.equal(w.document.getElementById('bo-key-editor').hidden, true); assert.ok(!w.document.body.textContent.includes('test-secret'));
  w.document.getElementById('bo-settings-sync').dispatchEvent(new w.Event('change'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(saves, 1); assert.equal(values.get('apiKey'), 'test-secret');
  w.document.getElementById('bo-change-key').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(w.document.getElementById('bo-key-editor').hidden, false);
  w.document.getElementById('bo-save-key').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(values.get('apiKey'), 'test-secret');
  assert.match(w.document.getElementById('bo-key-feedback').textContent, /请输入密钥/);
  key.value = 'replacement'; w.document.getElementById('bo-cancel-key').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(values.get('apiKey'), 'test-secret'); assert.equal(key.value, '');
  w.document.getElementById('bo-change-key').click(); await new Promise(resolve => setTimeout(resolve, 0));
  key.value = 'replacement'; w.document.getElementById('bo-save-key').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(values.get('apiKey'), 'replacement'); assert.equal(key.value, '');
  dispose(); w.document.getElementById('bo-settings-sync').dispatchEvent(new w.Event('change')); assert.equal(saves, 1);
  w.close();
});


test('failed sync preference write restores checkbox and shows error in its section', async () => {
  const w: any = new JSDOM('<html><body></body></html>').window;
  const xml = new w.DOMParser().parseFromString(readFileSync('addon/preferences.xhtml', 'utf8'), 'application/xml');
  w.document.body.append(w.document.importNode(xml.documentElement, true));
  const storage: any = { status: '本机', getSyncInfo: () => ({ connected: false, settingsConflict: true }), getSettings: () => ({ showChinese: true }), subscribe: () => () => {}, setSettings: async () => { throw new Error('写入失败'); } };
  const dispose = mountPreferences(w, storage, { get: (_: any, fallback: any) => fallback, set: () => { throw new Error('写入失败'); } });
  const box = w.document.getElementById('bo-settings-sync'); box.checked = false; box.dispatchEvent(new w.Event('change'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(box.checked, true); assert.equal(box.disabled, false);
  assert.equal(w.document.getElementById('bo-sync-feedback').textContent, '写入失败');
  assert.equal(w.document.getElementById('bo-resolve-settings').hidden, false);
  assert.ok(!w.document.getElementById('bo-cleanup').closest('details'));
  dispose(); w.close();
});
