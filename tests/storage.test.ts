import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Storage } from '../src/storage';
import { change, noteHTML } from '../src/sync';
const translation = (title: string) => ({ title, outlineHash: 'hash', updatedAt: new Date().toISOString(), entries: [{ id: '0', text: 'Intro', zh: title }] });
test('canonical signatures longer than 256 characters can be saved and reopened', async () => {
  const h = host(); await h.storage.init();
  const value = translation('目录'); value.outlineHash = JSON.stringify(Array.from({ length: 30 }, (_, i) => [String(i), 'Section title']));
  await h.storage.put('PDF', value); assert.equal(h.storage.get('PDF')?.outlineHash, value.outlineHash);
  await h.storage.close();
  const reopened = new Storage(h.Z, h.io, { join: (...p: string[]) => p.join('/') }, h.prefs);
  await reopened.init(); assert.equal(reopened.get('PDF')?.outlineHash, value.outlineHash); await reopened.close();
});
function host() {
  const files = new Map<string, any>(), items: any[] = [], preferences = new Map(); let actor = 0;
  const window: any = new JSDOM('').window;
  window.Services = { prompt: { confirm: () => true, alert: () => {}, select: (...args: any[]) => { args.at(-1).value = 0; return true; } } };
  class Item {
    id?: number; key = ''; libraryID = 1; parentID?: number; deleted = false; fields: any = {}; tags: any[] = []; html = '';
    constructor(public itemType: string) {}
    getField(k: string) { return this.fields[k] || ''; } setField(k: string, v: string) { this.fields[k] = v; }
    removeTag(tag: string) { this.tags = this.tags.filter(t => t.tag !== tag); }
    getTags() { return this.tags; } addTag(tag: string) { this.tags.push({ tag }); }
    getNote() { return this.html; } setNote(html: string) { this.html = html; }
    getNotes() { return items.filter(x => x.parentID === this.id).map(x => x.id); }
    async saveTx() { if (!this.id) { this.id = items.length + 1; this.key = 'KEY' + this.id; items.push(this); } return this.id; }
  }
  const Z: any = { DataDirectory: { dir: '/profile' }, Utilities: { randomString: () => 'actor' + ++actor }, Libraries: { userLibraryID: 1 }, getMainWindow: () => window, Item,
    Items: { getAll: async () => items.filter(x => !x.parentID), getAsync: async (id: number) => items.find(x => x.id === id), getByLibraryAndKeyAsync: async (_: number, key: string) => items.find(x => x.key === key) },
    Notifier: { registerObserver: () => 1, unregisterObserver: () => {} }, Sync: { Runner: { syncInProgress: false } } };
  const io = { makeDirectory: async () => {}, exists: async (p: string) => files.has(p), readJSON: async (p: string) => structuredClone(files.get(p)), writeJSON: async (p: string, v: any) => { files.set(p, structuredClone(v)); } };
  const prefs: any = { get: (k: string, fallback: any) => preferences.has(k) ? preferences.get(k) : fallback, set: (k: string, v: any) => preferences.set(k, v) };
  const storage = new Storage(Z, io, { join: (...p: string[]) => p.join('/') }, prefs);
  return { storage, Z, io, window, files, items, prefs };
}
test('local saving does not create notes until connection; shared parent/foreign notes preserved', async () => {
  const h = host(); await h.storage.init(); await h.storage.put('PDF1', translation('甲')); assert.equal(h.items.length, 0);
  const parent = new h.Z.Item('computerProgram'); parent.setField('extra', 'personal-zotero-addons-container: 1'); await parent.saveTx();
  const foreign = new h.Z.Item('note'); foreign.parentID = parent.id; foreign.setNote('Focus data'); await foreign.saveTx();
  await h.storage.connect(h.window);
  assert.equal(h.items.filter(i => i.itemType === 'computerProgram').length, 1); assert.equal(foreign.html, 'Focus data');
  assert.equal(h.items.filter(i => i.html.includes('"kind":"translations"')).length, 1);
  await h.storage.close();
});
test('whole note replacement merges different PDFs and persisted state survives restart', async () => {
  const h = host(); await h.storage.init(); await h.storage.put('PDF1', translation('甲')); await h.storage.connect(h.window);
  const note = h.items.find(i => i.html.includes('"kind":"translations"'));
  note.html = noteHTML('translations', { PDF2: change([], 'REMOTE', translation('乙')) }, 'Bilingual Outline');
  await h.storage.sync(); assert.equal(h.storage.get('PDF1')?.title, '甲'); assert.equal(h.storage.get('PDF2')?.title, '乙');
  await h.storage.close();
  const reopened = new Storage(h.Z, h.io, { join: (...p: string[]) => p.join('/') }, h.prefs); await reopened.init();
  assert.equal(reopened.get('PDF1')?.title, '甲'); assert.equal(reopened.get('PDF2')?.title, '乙'); await reopened.close();
});
test('missing connected note is not recreated and malformed note is not overwritten', async () => {
  const h = host(); await h.storage.init(); await h.storage.connect(h.window);
  const note = h.items.find(i => i.html.includes('"kind":"translations"'));
  note.html = 'broken'; await h.storage.sync(); assert.equal(note.html, 'broken'); assert.match(h.storage.status, /损坏|缺失/);
  h.items.splice(h.items.indexOf(note), 1); const count = h.items.length; await h.storage.sync(); assert.equal(h.items.length, count); assert.match(h.storage.status, /缺失/);
  await h.storage.close();
});
test('cleanup retains trashed PDF, backs up deleted PDF, restore explicitly supersedes tombstone', async () => {
  const h = host(); await h.storage.init();
  const attachment = new h.Z.Item('attachment'); await attachment.saveTx(); attachment.deleted = true;
  await h.storage.put(attachment.key, translation('保留')); await h.storage.put('MISSING', translation('清理'));
  await h.storage.cleanup(h.window); assert.equal(h.storage.get(attachment.key)?.title, '保留'); assert.equal(h.storage.get('MISSING'), null);
  assert.ok(h.files.has('/profile/bilingual-outline/cleanup-backup.json'));
  await h.storage.restore(h.window); assert.equal(h.storage.get('MISSING')?.title, '清理'); await h.storage.close();
});
test('settings/translation sync toggles operate independently and no credentials enter notes', async () => {
  const h = host(); h.prefs.set('apiKey', 'PRIVATE_TEST'); h.prefs.set('syncTranslations', false);
  await h.storage.init(); await h.storage.put('PDF', translation('本机')); await h.storage.connect(h.window);
  assert.equal(h.items.filter(i => i.html.includes('"kind":"translations"')).length, 0);
  await h.storage.setSettings({ showChinese: false });
  assert.ok(h.items.some(i => i.html.includes('showChinese'))); assert.ok(h.items.every(i => !i.html.includes('PRIVATE_TEST')));
  h.prefs.set('syncTranslations', true); await h.storage.sync(); assert.ok(h.items.some(i => i.html.includes('本机'))); await h.storage.close();
});
test('same PDF conflict blocks edits until whole-version resolution, then old note cannot revive conflict', async () => {
  const h = host(); await h.storage.init(); await h.storage.put('PDF', translation('甲')); await h.storage.connect(h.window);
  const note = h.items.find(i => i.html.includes('"kind":"translations"'));
  const remote = { PDF: change([], 'REMOTE', translation('乙')) };
  note.html = noteHTML('translations', remote, 'Remote'); await h.storage.sync();
  assert.equal(h.storage.hasConflict('PDF'), true); assert.equal(h.storage.get('PDF'), null);
  await assert.rejects(h.storage.put('PDF', translation('拒绝')), /冲突/);
  await h.storage.resolve('PDF', h.window); assert.equal(h.storage.hasConflict('PDF'), false);
  const chosen = h.storage.get('PDF')!.title;
  note.html = noteHTML('translations', remote, 'Remote'); await h.storage.sync();
  assert.equal(h.storage.hasConflict('PDF'), false); assert.equal(h.storage.get('PDF')!.title, chosen);
  await h.storage.close();
});
test('concurrent page creation is merged without duplicate records or deleting notes', async () => {
  const h = host(); await h.storage.init(); await h.storage.put('PDF1', translation('甲')); await h.storage.connect(h.window);
  const parent = h.items.find(i => i.itemType === 'computerProgram');
  const extra = new h.Z.Item('note'); extra.parentID = parent.id; extra.addTag('bilingual-outline:translations:v1');
  extra.html = noteHTML('translations', { PDF2: change([], 'REMOTE', translation('乙')) }, 'Bilingual Outline · 译文 001'); await extra.saveTx();
  await h.storage.sync(); assert.equal(h.storage.get('PDF1')?.title, '甲'); assert.equal(h.storage.get('PDF2')?.title, '乙');
  const notes = h.items.filter(i => i.html.includes('"kind":"translations"')); assert.equal(notes.length, 2);
  const lists = notes.map(n => JSON.parse(new h.window.DOMParser().parseFromString(n.html, 'text/html').querySelector('pre').textContent).records);
  assert.equal(lists.filter(r => r.PDF1).length, 1); assert.equal(lists.filter(r => r.PDF2).length, 1);
  await h.storage.close();
});
test('deleted offline data cannot revive after cleanup and unchanged local records remain on their pages', async () => {
  const h = host(); await h.storage.init(); await h.storage.put('MISSING', translation('清理')); await h.storage.connect(h.window);
  const note = h.items.find(i => i.html.includes('"kind":"translations"')); const old = note.html;
  await h.storage.cleanup(h.window); assert.equal(h.storage.get('MISSING'), null);
  note.html = old; await h.storage.sync(); assert.equal(h.storage.get('MISSING'), null); assert.ok(!note.html.includes('清理'));
  await h.storage.close();
});
test('failed atomic writes roll back memory and never leak unsaved edits into notes', async () => {
  const h = host(); await h.storage.init(); await h.storage.put('PDF', translation('已保存')); await h.storage.connect(h.window);
  const write = h.io.writeJSON; h.io.writeJSON = async (p: string, v: any) => { if (p.endsWith('/state.json')) throw new Error('disk full'); return write(p, v); };
  await assert.rejects(h.storage.put('PDF', translation('未保存')), /disk full/); assert.equal(h.storage.get('PDF')?.title, '已保存');
  await assert.rejects(h.storage.setSettings({ showChinese: false }), /disk full/); assert.equal(h.storage.getSettings().showChinese, true);
  await assert.rejects(h.storage.cleanup(h.window), /disk full/); assert.equal(h.storage.get('PDF')?.title, '已保存');
  h.io.writeJSON = write; await h.storage.sync(); assert.ok(h.items.every(i => !i.html.includes('未保存')));
  const snapshot = h.storage.get('PDF')!; snapshot.entries[0].zh = '外部篡改'; assert.equal(h.storage.get('PDF')!.entries[0].zh, '已保存');
  await h.storage.close();
});
test('corrupt imported translation with empty or duplicate entries is rejected before note mutation', async () => {
  const h = host(); await h.storage.init(); await h.storage.connect(h.window);
  const note = h.items.find(i => i.html.includes('"kind":"translations"'));
  for (const entries of [[], [{ id: '0', text: 'A', zh: '甲' }, { id: '0', text: 'B', zh: '乙' }]]) {
    note.html = noteHTML('translations', { BAD: change([], 'REMOTE', { ...translation('坏数据'), entries }) }, 'Test');
    const html = note.html; await h.storage.sync(); assert.equal(note.html, html); assert.equal(h.storage.get('BAD'), null); assert.match(h.storage.status, /无效/);
  }
  await h.storage.close();
});


test('new notes use payload identity without creating or modifying tags', async () => {
  const h = host(); await h.storage.init(); await h.storage.connect(h.window);
  const notes = h.items.filter(i => i.itemType === 'note'); assert.ok(notes.every(i => !i.tags.length));
  notes[0].addTag('user-tag'); await h.storage.sync();
  assert.deepEqual(notes[0].getTags(), [{ tag: 'user-tag' }]); await h.storage.close();
});
