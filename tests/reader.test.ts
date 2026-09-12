import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ReaderUI, decorateOutline, clearOutline } from '../src/reader';
import { flattenOutline, outlineSignature } from '../src/outline';
import type { Translation } from '../src/types';

const tree = [{ title: 'Introduction', expanded: true, items: [{ title: 'Repeated' }] }, { title: 'Repeated' }];
function translation(t = tree): Translation {
  const entries = flattenOutline(t); return { title: 'Paper', outlineHash: outlineSignature(entries), entries: entries.map(e => ({ ...e, zh: `中文 ${e.id}` })), updatedAt: '2026-09-11T00:00:00Z' };
}
function dom() {
  return new JSDOM('<html><head></head><body><div class="toolbar"><div class="custom-sections"></div></div><div id="sidebarContainer"><div class="sidebar-toolbar"><div class="start"></div><div class="end"></div></div></div><div class="outline-view"><div class="item" data-id="0"><div class="title">Introduction</div></div><div class="item" data-id="1"><div class="title">Repeated</div></div><div class="item" data-id="2"><div class="title">Repeated</div></div></div></body></html>');
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(translate: any = async (_: any, entries: any) => entries.map((e: any) => ({ ...e, zh: '新译文' })), cloneIntoReader?: any) {
  const d = dom(); const doc = d.window.document;
  const rows = new Map<string, Translation>(); const listeners = new Set<() => void>();
  const alerts: string[] = []; let registered: any; let notifier: any; let showChinese = true;
  const reader = { itemID: 1, tabID: 'tab-1', _iframeWindow: d.window, _internalReader: { _state: { outline: structuredClone(tree) } } };
  const Z = { Reader: { _readers: [reader], registerEventListener: (_: any, fn: any) => { registered = fn; }, unregisterEventListener: () => { registered = null; } },
    Notifier: { registerObserver: (obj: any) => { notifier = obj; return 1; }, unregisterObserver: () => { notifier = null; } },
    Libraries: { userLibraryID: 1 }, Items: { get: (id: number) => ({ libraryID: 1, key: id === 1 ? 'ABCDEFGH' : 'OTHERKEY', isPDFAttachment: () => true, getField: () => 'Paper' }) },
    getMainWindow: () => ({ Services: { prompt: { alert: (_: any, __: any, m: string) => alerts.push(m), confirm: () => true, prompt: (_: any, __: any, ___: any, value: any) => { value.value = '手工修改'; return true; } } } }),
  };
  const storage = { get: (key: string) => rows.get(key) || null, hasConflict: () => false,
    getSettings: () => ({ showChinese }), setSettings: async (value: any) => { showChinese = value.showChinese; listeners.forEach(fn => fn()); },
    subscribe: (fn: any) => { listeners.add(fn); return () => listeners.delete(fn); },
    put: async (key: string, value: Translation) => { rows.set(key, value); listeners.forEach(fn => fn()); }, resolve: async () => {} };
  const ui = new ReaderUI(Z, storage as any, translate, cloneIntoReader);
  return { d, doc, rows, ui, reader, alerts, Z, listeners, get registered() { return registered; }, get notifier() { return notifier; } };
}

test('pseudo-element attributes preserve native text/children and pointer/key handlers', () => {
  const d = dom(); const doc = d.window.document;
  const title = doc.querySelector('.title')!; const textNode = title.firstChild; let events = 0;
  title.addEventListener('pointerdown', () => events++);
  decorateOutline(doc, tree, translation(), true);
  assert.equal(title.firstChild, textNode); assert.equal(title.childNodes.length, 1);
  assert.equal(title.textContent, 'Introduction'); assert.equal(title.getAttribute('data-bilingual-outline-zh'), '中文 0');
  assert.deepEqual([...doc.querySelectorAll('[data-bilingual-outline-path]')].map(el => el.getAttribute('data-bilingual-outline-path')), ['0', '0.0', '1']);
  title.dispatchEvent(new d.window.Event('pointerdown')); assert.equal(events, 1);
  clearOutline(doc); assert.equal(title.firstChild, textNode); assert.equal(doc.querySelector('[data-bilingual-outline-zh]'), null); d.window.close();
});

test('transient wrong title is not decorated; long Chinese stays in attribute without markup', () => {
  const d = dom(); const doc = d.window.document; const value = translation(); value.entries[0].zh = '<script>中文</script>'.repeat(100);
  decorateOutline(doc, tree, value, true);
  assert.equal(doc.querySelector('script'), null);
  doc.querySelector('.title')!.textContent = 'Another paper';
  decorateOutline(doc, tree, value, true);
  assert.equal(doc.querySelector('.title')!.hasAttribute('data-bilingual-outline-zh'), false);
  decorateOutline(doc, tree, value, false); assert.equal(doc.querySelector('[data-bilingual-outline-zh]'), null); d.window.close();
});

test('start, native toolbar rerender, right-click repair, display toggle and stop', async () => {
  const s = setup(); s.rows.set('ABCDEFGH', translation()); await s.ui.start();
  assert.equal(s.doc.querySelectorAll('#sidebarContainer .bo-controls').length, 1);
  s.registered({ reader: s.reader, doc: s.doc, append: (el: Element) => s.doc.querySelector('.custom-sections')!.append(el) });
  assert.equal(s.doc.querySelectorAll('.bo-controls').length, 1);
  s.doc.querySelector('.title')!.dispatchEvent(new s.d.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await tick();
  assert.equal(s.rows.get('ABCDEFGH')!.entries[0].zh, '手工修改');
  (s.doc.querySelectorAll('.bo-controls button')[1] as HTMLButtonElement).click(); await tick();
  assert.equal(s.doc.querySelector('[data-bilingual-outline-zh]'), null);
  s.ui.stop(); assert.equal(s.doc.querySelector('.bo-controls'), null); assert.equal(s.doc.querySelector('style'), null); assert.equal(s.listeners.size, 0); assert.equal(s.registered, null); assert.equal(s.notifier, null); s.d.window.close();
});

test('existing reader finishes loading after plugin startup; removed controls return without service calls', async () => {
  let calls = 0; let ready!: () => void;
  const s = setup(() => { calls++; });
  (s.reader as any)._initPromise = new Promise<void>(resolve => { ready = resolve; });
  const toolbar = s.doc.querySelector('#sidebarContainer')!; toolbar.remove();
  await s.ui.start(); assert.equal(s.doc.querySelector('.bo-controls'), null);
  s.doc.body.prepend(toolbar); ready(); await tick();
  assert.equal(s.doc.querySelectorAll('.bo-controls').length, 1);
  s.doc.querySelector('.bo-controls')!.remove(); await tick();
  assert.equal(s.doc.querySelectorAll('.bo-controls').length, 1); assert.equal(calls, 0);
  s.ui.stop(); await tick(); assert.equal(s.doc.querySelector('.bo-controls'), null); s.d.window.close();
});

test('no automatic service calls; duplicate manual click blocked; failure preserves cache', async () => {
  let calls = 0; let reject: any;
  const s = setup(() => { calls++; return new Promise((_, r) => { reject = r; }); }); s.rows.set('ABCDEFGH', translation()); await s.ui.start();
  assert.equal(calls, 0);
  const b = s.doc.querySelector('.bo-controls button') as HTMLButtonElement; b.click(); b.click();
  assert.equal(calls, 1); reject(new Error('服务暂不可用')); await tick();
  assert.equal(s.rows.get('ABCDEFGH')!.entries[0].zh, '中文 0'); assert.deepEqual(s.alerts, ['服务暂不可用']);
  s.ui.stop(); s.d.window.close();
});

test('changed attachment or outline during request never writes result into another PDF', async () => {
  for (const kind of ['item', 'outline', 'closed', 'stopped', 'updated']) {
    let resolve: any; const s = setup(() => new Promise(r => { resolve = r; })); await s.ui.start();
    (s.doc.querySelector('.bo-controls button') as HTMLButtonElement).click();
    if (kind === 'item') s.reader.itemID = 2;
    if (kind === 'outline') s.reader._internalReader._state.outline[0].title = 'Changed';
    if (kind === 'closed') s.notifier.notify('close', 'tab', ['tab-1']);
    if (kind === 'stopped') s.ui.stop();
    if (kind === 'updated') s.rows.set('ABCDEFGH', translation());
    resolve(translation().entries); await tick();
    assert.equal(s.rows.size, kind === 'updated' ? 1 : 0, kind);
    if (kind === 'closed') assert.equal(s.doc.querySelector('.bo-controls'), null);
    s.ui.stop(); s.d.window.close();
  }
});

test('changed outline clears cached decoration and unsupported library disables action', async () => {
  const s = setup(); s.rows.set('ABCDEFGH', translation()); await s.ui.start();
  s.reader._internalReader._state.outline[0].title = 'Changed'; s.doc.querySelector('.title')!.textContent = 'Changed'; await tick();
  assert.equal(s.doc.querySelector('[data-bilingual-outline-zh]'), null);
  assert.match((s.doc.querySelector('.bo-controls button') as HTMLButtonElement).title, /目录已变化/);
  s.Z.Libraries.userLibraryID = 2; s.doc.querySelector('.title')!.textContent = 'Changed again'; await tick();
  assert.equal((s.doc.querySelector('.bo-controls button') as HTMLButtonElement).disabled, true);
  s.ui.stop(); s.d.window.close();
});


test('observer options cross the privileged/content boundary before observe', async () => {
  const allowed = new WeakSet<object>(); let clones = 0;
  const s = setup(undefined, (value: any, target: any) => {
    assert.equal(target, s.d.window);
    const copy = JSON.parse(JSON.stringify(value)); allowed.add(copy); clones++; return copy;
  });
  const Native = s.d.window.MutationObserver;
  s.d.window.MutationObserver = class extends Native {
    observe(target: Node, options: MutationObserverInit) {
      if (!allowed.has(options)) throw new TypeError('Security wrapper denied access to privileged options');
      assert.equal(options.childList, true); assert.deepEqual(options.attributeFilter, ['class', 'data-id']);
      super.observe(target, options);
    }
  };
  await s.ui.start();
  assert.equal(clones, 1); assert.equal(s.doc.querySelectorAll('.bo-controls').length, 1);
  s.ui.stop(); s.d.window.close();
});


test('icon controls toggle all nested levels without translating or changing destinations', async () => {
  let calls = 0; const s = setup(() => { calls++; });
  const nodes: any[] = [{ title: 'Root', expanded: true, location: { pageIndex: 2 }, items: [{ title: 'Child', expanded: false, items: [{ title: 'Leaf' }] }] }];
  s.reader._internalReader._state.outline = nodes;
  (s.reader._internalReader as any)._updateState = (state: any) => Object.assign(s.reader._internalReader._state, state);
  await s.ui.start();
  const buttons = [...s.doc.querySelectorAll<HTMLButtonElement>('.bo-controls button')];
  assert.ok(buttons.every(b => b.querySelector('svg'))); assert.ok(buttons.every(b => !b.textContent));
  assert.ok(buttons.every(b => !b.title.includes('设置')));
  const expand = buttons.find(b => b.title === '展开全部目录')!;
  expand.click(); await tick();
  let updated: any = s.reader._internalReader._state.outline;
  assert.equal(updated[0].items[0].expanded, true); assert.equal(expand.title, '收起全部目录');
  assert.deepEqual(updated[0].location, { pageIndex: 2 }); assert.equal(nodes[0].items[0].expanded, false);
  expand.click(); await tick(); updated = s.reader._internalReader._state.outline;
  assert.equal(updated[0].expanded, false); assert.equal(updated[0].items[0].expanded, false);
  assert.equal(calls, 0); assert.equal(expand.title, '展开全部目录');
  s.ui.stop(); s.d.window.close();
});

test('flat outline disables expansion control', async () => {
  const s = setup(); s.reader._internalReader._state.outline = [{ title: 'Flat' }] as any;
  await s.ui.start(); const b = s.doc.querySelector<HTMLButtonElement>('[data-bo-icon="collapse"]')!;
  assert.equal(b.disabled, true); s.ui.stop(); s.d.window.close();
});


test('content array callbacks are not used: cached Chinese and expand remain usable', async () => {
  const s = setup(); s.rows.set('ABCDEFGH', translation());
  const source = s.reader._internalReader._state.outline;
  Object.defineProperty(source, 'flatMap', { value: () => { throw new Error('Security wrapper denied callback result'); } });
  Object.defineProperty(source, 'map', { value: () => { throw new Error('Security wrapper denied callback result'); } });
  (s.reader._internalReader as any)._updateState = (state: any) => Object.assign(s.reader._internalReader._state, state);
  await s.ui.start();
  assert.equal(s.doc.querySelector('.title')?.getAttribute('data-bilingual-outline-zh'), '中文 0');
  s.doc.querySelector<HTMLButtonElement>('[data-bo-icon="collapse"]')!.click(); await tick();
  assert.equal(s.reader._internalReader._state.outline[0].expanded, false);
  assert.equal(s.alerts.length, 0); s.ui.stop(); s.d.window.close();
});

test('refresh failure before network cannot leave a permanent busy flag or discard cache', async () => {
  let calls = 0; const s = setup(async (_: any, entries: any) => { calls++; return entries.map((e: any) => ({ ...e, zh: '新' })); });
  s.rows.set('ABCDEFGH', translation()); await s.ui.start();
  const original = (s.ui as any).refresh.bind(s.ui); let fail = true;
  (s.ui as any).refresh = (session: any) => {
    if (fail && session.busy) throw { message: '模拟跨窗口刷新错误' };
    original(session);
  };
  const b = s.doc.querySelector<HTMLButtonElement>('[data-bo-icon="translate"]')!;
  b.click(); await tick();
  assert.equal(calls, 0); assert.equal(b.disabled, false); assert.equal(b.getAttribute('aria-busy'), 'false');
  assert.equal(s.rows.get('ABCDEFGH')?.entries[0].zh, '中文 0');
  assert.deepEqual(s.alerts, ['模拟跨窗口刷新错误']);
  fail = false; b.click(); await tick(); assert.equal(calls, 1);
  s.ui.stop(); s.d.window.close();
});
