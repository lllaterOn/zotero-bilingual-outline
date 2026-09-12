import type { Storage } from './storage';
import type { Prefs } from './types';

export function mountPreferences(window: any, storage: Storage, prefs: Prefs): () => void {
  const doc = window.document, root = doc.getElementById('bo-preferences');
  if (!root || root.dataset.mounted) return () => {};
  root.dataset.mounted = 'true';
  const el = (id: string): any => doc.getElementById('bo-' + id);
  const removers: Array<() => void> = [];
  let alive = true;
  const keyState = () => {
    const configured = !!prefs.get('apiKey', '');
    el('key-state').textContent = configured ? '已配置 · 仅保存在本机' : '未配置';
    el('key-editor').hidden = configured;
    el('change-key').hidden = !configured;
    el('clear-key').hidden = !configured;
    el('cancel-key').hidden = !configured;
    el('key').value = '';
  };
  const update = () => {
    if (!alive) return;
    el('settings-sync').checked = prefs.get('syncSettings', true);
    el('translations-sync').checked = prefs.get('syncTranslations', true);
    const info = storage.getSyncInfo();
    el('connection').textContent = info.connected ? '同步笔记已连接' : '尚未连接同步笔记';
    el('resolve-settings').hidden = !info.settingsConflict;
    el('status').textContent = storage.status;
  };
  keyState(); update(); removers.push(storage.subscribe(update));
  function action(id: string, event: string, status: string, fn: () => Promise<void>) {
    const target = el(id);
    const handler = async () => {
      target.disabled = true; el(status).textContent = '正在处理…';
      try { await fn(); if (alive) el(status).textContent = event === 'change' || id === 'save-key' ? '已保存' : id === 'change-key' || id === 'cancel-key' ? '' : id === 'clear-key' ? '本机密钥已清除' : '操作已结束，请查看状态或弹窗结果'; }
      catch (e) { if (alive) el(status).textContent = typeof (e as any)?.message === 'string' ? (e as any).message : '操作失败，请重试。'; }
      finally { if (alive) { target.disabled = false; update(); } }
    };
    target.addEventListener(event, handler); removers.push(() => target.removeEventListener(event, handler));
  }
  action('change-key', 'click', 'key-feedback', async () => { el('key-editor').hidden = false; el('key').focus(); });
  action('cancel-key', 'click', 'key-feedback', async () => { keyState(); });
  action('save-key', 'click', 'key-feedback', async () => {
    const key = el('key').value.trim(); if (!key) throw new Error('请输入密钥；留空不会修改已有密钥。');
    prefs.set('apiKey', key); keyState();
  });
  action('clear-key', 'click', 'key-feedback', async () => { prefs.set('apiKey', ''); keyState(); });
  for (const [id, name] of [['settings-sync', 'syncSettings'], ['translations-sync', 'syncTranslations']]) {
    action(id, 'change', 'sync-feedback', async () => { prefs.set(name, el(id).checked); await storage.sync(); });
  }
  action('connect', 'click', 'sync-feedback', () => storage.connect(window));
  action('sync', 'click', 'sync-feedback', () => storage.sync());
  action('resolve-settings', 'click', 'sync-feedback', () => storage.sync(true));
  action('cleanup', 'click', 'maintenance-feedback', () => storage.cleanup(window));
  action('restore', 'click', 'maintenance-feedback', () => storage.restore(window));
  const dispose = () => { if (!alive) return; alive = false; removers.forEach(fn => fn()); delete root.dataset.mounted; window.removeEventListener('unload', dispose); };
  window.addEventListener('unload', dispose, { once: true }); return dispose;
}
