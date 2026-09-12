import type { Storage } from './storage';
import type { OutlineEntry, Translation } from './types';
import { flattenOutline, outlineSignature, visibleOutlineMap, outlineBranches, toggleAllOutline } from './outline';

const ATTR = 'data-bilingual-outline-zh';
const PATH = 'data-bilingual-outline-path';
const CSS = `
.outline-view .title[${ATTR}]::after { content: attr(${ATTR}); display:block; white-space:pre-wrap; overflow-wrap:anywhere; color:var(--fill-secondary, #626b77); font-size:.94em; line-height:1.5; padding-top:2px; }
.outline-view .item.active .title[${ATTR}]::after { color:inherit; }
.bo-controls { -moz-window-dragging:no-drag; min-width:0; overflow-x:auto; display:flex; align-items:center;gap:3px;white-space:nowrap;}
.bo-controls button {-moz-window-dragging:no-drag;flex-shrink:0;font:inherit;cursor:pointer;width:28px;height:28px;padding:4px;display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:4px;background:transparent;color:inherit;}
.bo-controls button:hover {background:var(--fill-quinary, #ddd);}
.bo-controls button[aria-pressed="true"] {background:var(--fill-quaternary, #d5d5d5);}
.bo-controls svg {width:20px;height:20px;pointer-events:none;}
.bo-controls button[aria-busy="true"] svg {animation:bo-spin 1.2s linear infinite;}
@keyframes bo-spin {to {transform:rotate(360deg);}}
.bo-controls button:disabled {opacity:.55;cursor:default;}
.bo-controls button[hidden] {display:none;}
`;


const ICONS: Record<string, string> = {
  translate: 'M3 4h10M8 2v2M5 6c1 4 4 6 7 7M11 4c-1 5-4 8-8 10M12 18l4-10 4 10M14 14h4',
  bilingual: 'M3 3h7v14H3zM13 3h7v14h-7zM5 7h3M5 10h3M15 7h3M15 10h3',
  expand: 'M4 7l6-4 6 4M4 13l6 4 6-4M4 10h12',
  collapse: 'M4 3l6 4 6-4M4 17l6-4 6 4M4 10h12',
  conflict: 'M10 2l9 16H1zM10 7v5M10 15v.2',
  busy: 'M18 10a8 8 0 1 1-4-7M14 1v4h4',
};
function setIcon(button: HTMLButtonElement, name: string): void {
  if (button.getAttribute('data-bo-icon') === name) return;
  const doc = button.ownerDocument;
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 22 20'); svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(svg.namespaceURI, 'path');
  for (const [key, value] of Object.entries({ d: ICONS[name], fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) path.setAttribute(key, value);
  svg.append(path); button.replaceChildren(svg); button.setAttribute('data-bo-icon', name);
}

/** Attributes and pseudo-elements leave the native React text and child tree intact. */
export function decorateOutline(doc: Document, tree: any[], value: Translation | null, show: boolean): void {
  const mapping = visibleOutlineMap(tree);
  const translations = new Map(value?.entries.map(e => [e.id, e]) || []);
  for (const row of doc.querySelectorAll('.outline-view .item[data-id]')) {
    const title = row.querySelector(':scope > .title');
    if (!title) continue;
    const entry = mapping.get(row.getAttribute('data-id') || '');
    const zh = entry && translations.get(entry.id);
    // Verify native text to avoid a transient React commit painting another row.
    const nativeText = title.firstChild?.nodeType === 3 ? title.firstChild.textContent : title.textContent;
    if (show && entry && zh?.text === entry.text && nativeText === entry.text) {
      if (title.getAttribute(ATTR) !== zh.zh) title.setAttribute(ATTR, zh.zh);
      if (title.getAttribute(PATH) !== entry.id) title.setAttribute(PATH, entry.id);
    } else {
      title.removeAttribute(ATTR);
      title.removeAttribute(PATH);
    }
  }
}

export function clearOutline(doc: Document): void {
  for (const title of doc.querySelectorAll(`[${ATTR}], [${PATH}]`)) {
    title.removeAttribute(ATTR);
    title.removeAttribute(PATH);
  }
}

interface Session {
  reader: any; doc: Document; controls: HTMLElement; style: HTMLStyleElement;
  translateButton: HTMLButtonElement; toggleButton: HTMLButtonElement; conflictButton: HTMLButtonElement; expandButton: HTMLButtonElement;
  observer: MutationObserver; cleanups: Array<() => void>; closed: boolean; busy: boolean; queued: boolean;
}
interface Snapshot { key: string; hash: string; entries: OutlineEntry[]; title: string }

export class ReaderUI {
  private sessions = new Map<any, Session>();
  private running = false;
  private unsubscribe?: () => void;
  private notifier: any;
  private pending = new Set<string>();
  constructor(private Z: any, private storage: Storage,
    private translate: (title: string, entries: OutlineEntry[]) => Promise<Array<OutlineEntry & { zh: string }>>,
    private cloneIntoReader: (value: any, target: Window) => any = value => value) {}

  private renderToolbar = (event: any) => {
    if (!this.running) return;
    try {
      const s = this.attach(event.reader, event.doc);
      if (s) this.placeControls(s);
    } catch (error) { this.Z.logError?.(error); }
  };

  private mountExisting(reader: any): void {
    if (!this.running || reader._isUninitialized) return;
    try {
      const doc = reader._iframeWindow?.document;
      const container = doc?.querySelector('#sidebarContainer .sidebar-toolbar');
      if (!container) return;
      const s = this.attach(reader, doc);
      if (s) this.placeControls(s);
    } catch (error) { this.Z.logError?.(error); }
  }

  private placeControls(s: Session): void {
    const bar = s.doc.querySelector('#sidebarContainer .sidebar-toolbar');
    if (!bar || s.controls.parentElement === bar) return;
    bar.insertBefore(s.controls, bar.querySelector(':scope > .end'));
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.Z.Reader.registerEventListener('renderToolbar', this.renderToolbar);
    this.unsubscribe = this.storage.subscribe(() => {
      for (const s of this.sessions.values()) this.refresh(s);
    });
    this.notifier = this.Z.Notifier.registerObserver({ notify: (event: string, type: string, ids: any[]) => {
      if (type === 'tab' && event === 'close') {
        for (const s of this.sessions.values()) if (ids.includes(s.reader.tabID)) this.detach(s);
      }
    } }, ['tab'], 'bilingual-outline-reader');
    for (const reader of this.Z.Reader._readers || []) {
      this.mountExisting(reader);
      // An already-open tab may still be loading when the add-on is enabled.
      if (reader._initPromise) void Promise.resolve(reader._initPromise)
        .then(() => this.mountExisting(reader)).catch(error => this.Z.logError?.(error));
    }
  }

  stop(): void {
    this.running = false;
    this.Z.Reader.unregisterEventListener('renderToolbar', this.renderToolbar);
    this.unsubscribe?.();
    if (this.notifier != null) this.Z.Notifier.unregisterObserver(this.notifier);
    for (const s of [...this.sessions.values()]) this.detach(s);
  }

  private hostWindow(s: Session): any { return s.reader._window || this.Z.getMainWindow(); }
  private promptService(s: Session): any { return this.hostWindow(s).Services?.prompt || (this.Z.getMainWindow().Services || (globalThis as any).Services).prompt; }
  private alert(s: Session, message: string): void {
    if (!s.closed && this.running) this.promptService(s).alert(this.hostWindow(s), '目录双语翻译', message);
  }
  private attach(reader: any, doc: Document): Session | null {
    if (this.sessions.has(reader)) {
      const previous = this.sessions.get(reader)!;
      if (previous.doc === doc) return previous;
      this.detach(previous);
    }
    if (!doc.defaultView) return null;
    const controls = doc.createElement('div'); controls.className = 'bo-controls';
    const style = doc.createElement('style'); style.textContent = CSS; doc.head.append(style);
    const cleanups: Array<() => void> = [];
    const button = (label: string, title: string, run: () => void) => {
      const b = doc.createElement('button'); b.type = 'button'; b.title = title; setIcon(b, label);
      b.setAttribute('aria-label', title); b.setAttribute('data-tabstop', '1');
      b.addEventListener('click', run); cleanups.push(() => b.removeEventListener('click', run)); controls.append(b); return b;
    };
    let s: Session;
    const translateButton = button('translate', '手动翻译当前 PDF 目录', () => { void this.runTranslation(s); });
    const toggleButton = button('bilingual', '切换中英目录显示', () => { void this.action(s, async () => {
      await this.storage.setSettings({ showChinese: !this.storage.getSettings().showChinese });
    }); });
    const conflictButton = button('conflict', '选择保留哪一整份目录译文', () => { void this.action(s, async () => {
      const snapshot = this.snapshot(s); await this.storage.resolve(snapshot.key, this.hostWindow(s));
    }); });
    const expandButton = button('expand', '展开全部目录', () => { void this.action(s, async () => {
      const tree = this.tree(s);
      if (!Array.isArray(tree) || !outlineBranches(tree).length) return;
      // Same state update as Zotero's native onUpdateOutline, with content-owned data.
      s.reader._internalReader._updateState(this.cloneIntoReader({ outline: toggleAllOutline(tree) }, s.doc.defaultView!));
    }); });
    const observer = new (doc.defaultView as any).MutationObserver(() => {
      if (!s || s.closed || s.queued) return;
      s.queued = true;
      Promise.resolve().then(() => {
        s.queued = false;
        if (!s.closed) { this.mountExisting(s.reader); this.refresh(s); }
      }).catch(error => this.Z.logError?.(error));
    });
    s = { reader, doc, controls, style, translateButton, toggleButton, conflictButton, expandButton, observer, cleanups, closed: false, busy: false, queued: false };
    const context = (event: Event) => {
      const el = (event.target as Element)?.closest?.(`[${PATH}]`);
      if (!el) return;
      event.preventDefault(); event.stopPropagation();
      void this.edit(s, el.getAttribute(PATH)!);
    };
    const unload = () => this.detach(s);
    doc.addEventListener('contextmenu', context, true);
    doc.defaultView.addEventListener('pagehide', unload);
    doc.defaultView.addEventListener('unload', unload);
    cleanups.push(() => doc.removeEventListener('contextmenu', context, true),
      () => doc.defaultView?.removeEventListener('pagehide', unload), () => doc.defaultView?.removeEventListener('unload', unload));
    // The content window cannot read a privileged sandbox's plain object/array.
    const observeOptions = this.cloneIntoReader({ subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-id'] }, doc.defaultView);
    try { observer.observe(doc.body, observeOptions); }
    catch (error) { observer.disconnect(); cleanups.forEach(fn => fn()); controls.remove(); style.remove(); throw error; }
    this.sessions.set(reader, s); this.refresh(s); return s;
  }

  private detach(s: Session): void {
    if (s.closed) return;
    s.closed = true; s.observer.disconnect();
    for (const cleanup of s.cleanups) cleanup();
    clearOutline(s.doc); s.controls.remove(); s.style.remove(); this.sessions.delete(s.reader);
  }

  private tree(s: Session): any[] {
    const tree = s.reader._internalReader?._state?.outline;
    // Work on sandbox-owned data. Content Array.map/flatMap cannot consume
    // privileged callback return objects through Firefox's security wrapper.
    return Array.isArray(tree) ? JSON.parse(JSON.stringify(tree)) : [];
  }
  private snapshot(s: Session): Snapshot {
    if (s.closed || !this.running) throw new Error('阅读器已关闭。');
    const item = this.Z.Items.get(s.reader.itemID);
    if (!item || item.libraryID !== this.Z.Libraries.userLibraryID) throw new Error('首版仅支持个人库中的 PDF。');
    if (!(item.isPDFAttachment?.() || item.attachmentContentType === 'application/pdf')) throw new Error('请在 PDF 阅读器中使用此功能。');
    const tree = this.tree(s);
    if (!Array.isArray(tree)) throw new Error('目录尚未准备好，请稍后再试。');
    const entries = flattenOutline(tree);
    if (!entries.length || !entries.some(e => e.text.trim())) throw new Error('此 PDF 没有可用目录；本插件不生成目录。');
    const parent = item.parentID ? this.Z.Items.get(item.parentID) : null;
    return { key: item.key, hash: outlineSignature(entries), entries, title: String(parent?.getField('title') || item.getField('title') || 'PDF') };
  }

  private refresh(s: Session): void {
    if (s.closed) return;
    let value: Translation | null = null;
    let enabled = true; let hint = '手动翻译当前 PDF 目录'; let label = '翻译目录'; let conflict = false;
    try {
      const snap = this.snapshot(s); const cached = this.storage.get(snap.key);
      conflict = this.storage.hasConflict(snap.key);
      if (cached) {
        label = '重新翻译';
        if (cached.outlineHash === snap.hash) value = cached;
        else hint = '目录已变化，旧译文未显示。点击重新翻译。';
      }
      enabled = !this.pending.has(snap.key);
      if (conflict) hint = '此 PDF 存在同步冲突，请先处理冲突。';
    } catch (error) { enabled = false; hint = (error as Error).message; }
    const text = s.busy ? '翻译中…' : label;
    setIcon(s.translateButton, s.busy ? 'busy' : 'translate');
    s.translateButton.setAttribute('aria-busy', String(s.busy));
    s.translateButton.disabled = !enabled || s.busy || conflict;
    s.translateButton.title = text + '：' + hint;
    s.translateButton.setAttribute('aria-label', s.translateButton.title);
    s.conflictButton.hidden = !conflict;
    const show = this.storage.getSettings().showChinese;
    const toggle = show ? '仅英文' : '中英对照';
    s.toggleButton.title = toggle; s.toggleButton.setAttribute('aria-label', toggle);
    s.toggleButton.setAttribute('aria-pressed', String(show));
    const branches = outlineBranches(this.tree(s));
    const expand = branches.some(node => !node.expanded);
    setIcon(s.expandButton, expand ? 'expand' : 'collapse');
    s.expandButton.disabled = !branches.length;
    s.expandButton.title = expand ? '展开全部目录' : '收起全部目录';
    s.expandButton.setAttribute('aria-label', s.expandButton.title);
    decorateOutline(s.doc, this.tree(s), value, show);
  }

  private async action(s: Session, work: () => Promise<void>): Promise<void> {
    try { await work(); } catch (e) {
      this.Z.logError?.(e);
      this.alert(s, typeof (e as any)?.message === 'string' ? (e as any).message : '操作未完成，请查看错误控制台。');
    }
    finally { if (!s.closed) this.safeRefresh(s); }
  }

  private safeRefresh(s: Session): void {
    try { this.refresh(s); } catch (e) { this.Z.logError?.(e); }
  }

  private async runTranslation(s: Session): Promise<void> {
    if (s.busy) return;
    await this.action(s, async () => {
      const snap = this.snapshot(s);
      if (this.pending.has(snap.key)) return;
      if (this.storage.hasConflict(snap.key)) throw new Error('请先处理此 PDF 的同步冲突。');
      const before = this.storage.get(snap.key);
      const beforeJSON = JSON.stringify(before);
      if (before && !this.promptService(s).confirm(this.hostWindow(s), '重新翻译目录', '重新翻译成功后将替换整份译文，包括手工修订。继续吗？')) return;
      s.busy = true; this.pending.add(snap.key);
      try {
        for (const session of this.sessions.values()) this.refresh(session);
        const entries = await this.translate(snap.title, snap.entries);
        if (!this.running || s.closed) return;
        const current = this.snapshot(s);
        if (current.key !== snap.key || current.hash !== snap.hash) throw new Error('PDF 或目录已变化，本次结果未保存，请回到目标 PDF 后重试。');
        if (JSON.stringify(this.storage.get(snap.key)) !== beforeJSON || this.storage.hasConflict(snap.key)) throw new Error('翻译期间已有译文发生变化，本次结果未覆盖，请检查同步或修订后重试。');
        await this.storage.put(snap.key, { title: snap.title, outlineHash: snap.hash, entries, updatedAt: new Date().toISOString() });
      } finally {
        s.busy = false; this.pending.delete(snap.key);
        // Always release the button even if rendering another control fails.
        s.translateButton.disabled = false;
        s.translateButton.setAttribute('aria-busy', 'false');
        for (const session of this.sessions.values()) this.safeRefresh(session);
      }
    });
  }

  private async edit(s: Session, id: string): Promise<void> {
    await this.action(s, async () => {
      const snap = this.snapshot(s);
      if (this.pending.has(snap.key)) throw new Error('当前目录正在翻译，请等待结束后再修改。');
      if (this.storage.hasConflict(snap.key)) throw new Error('请先处理此 PDF 的同步冲突。');
      const cached = this.storage.get(snap.key);
      if (!cached || cached.outlineHash !== snap.hash) return;
      const entry = cached.entries.find(e => e.id === id); if (!entry) return;
      const value = { value: entry.zh };
      if (!this.promptService(s).prompt(this.hostWindow(s), '修改中文', entry.text, value, null, {})) return;
      const zh = value.value.trim(); if (!zh) throw new Error('中文标题不能为空。');
      const current = this.snapshot(s);
      if (current.key !== snap.key || current.hash !== snap.hash || JSON.stringify(this.storage.get(snap.key)) !== JSON.stringify(cached)) throw new Error('目录或译文已变化，请重新打开修改。');
      await this.storage.put(snap.key, { ...cached, entries: cached.entries.map(e => e.id === id ? { ...e, zh } : e), updatedAt: new Date().toISOString() });
    });
  }
}
