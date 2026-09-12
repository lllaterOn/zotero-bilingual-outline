import { Storage } from './storage';
import { Translator } from './translator';
import { ReaderUI } from './reader';
import { mountPreferences } from './preferences';
import type { Prefs } from './types';

let cleanup: (() => Promise<void>) | undefined;
export async function startup(Z: any, io: any, path: any, services: any, rootURI: string) {
  if (cleanup) return;
  await Z.initializationPromise;
  const prefs: Prefs = {
    get<T>(name: string, fallback: T): T { const v = Z.Prefs.get('extensions.bilingualOutline.' + name, true); return v === undefined ? fallback : v; },
    set(name, value) { Z.Prefs.set('extensions.bilingualOutline.' + name, value, true); },
  };
  const storage = new Storage(Z, io, path, prefs);
  const translator = new Translator(Z, prefs);
  const paneID = 'bilingual-outline-preferences';
  const reader = new ReaderUI(Z, storage, translator.translate.bind(translator),
    (value, target) => (globalThis as any).Components.utils.cloneInto(value, target));
  const mounts = new Set<() => void>();
  const api = { mountPreferences(window: any) { const dispose = mountPreferences(window, storage, prefs); mounts.add(dispose); } };
  let registered: string | undefined;
  cleanup = async () => {
    reader.stop(); translator.close();
    for (const dispose of mounts) dispose();
    mounts.clear();
    await storage.close();
    if (registered) Z.PreferencePanes.unregister(registered);
    if (Z.BilingualOutline === api) delete Z.BilingualOutline;
  };
  try {
    await storage.init();
    Z.BilingualOutline = api;
    registered = await Z.PreferencePanes.register({ pluginID: 'bilingual-outline@lllateron', id: paneID, label: '目录双语', src: rootURI + 'preferences.xhtml', scripts: [rootURI + 'preferences.js'], image: rootURI + 'icon.svg' });
    await reader.start();
  } catch (e) { await shutdown(); throw e; }
}
export async function shutdown() { const fn = cleanup; cleanup = undefined; if (fn) await fn(); }
