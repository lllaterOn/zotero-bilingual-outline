import type { Translation, Prefs } from './types';
import { change, mergeRecords, validateRecords, splitRecords, noteHTML, noteBytes, NOTE_LIMIT, type Records } from './sync';
type Settings = { showChinese: boolean };
interface State { schema: 1; actor: string; translations: Records<Translation>; settings: Records<Settings>; parentKey?: string; noteKeys: string[] }
const PARENT = 'personal-zotero-addons-container: 1';
const validTranslation = (v: any) => v && typeof v.outlineHash === 'string' && v.outlineHash.length > 0 && v.outlineHash.length <= 150000 && typeof v.title === 'string' && v.title.length <= 4000 && typeof v.updatedAt === 'string' && Number.isFinite(Date.parse(v.updatedAt)) && Array.isArray(v.entries) && v.entries.length > 0 && v.entries.length <= 10000 && new Set(v.entries.map((e: any) => e?.id)).size === v.entries.length && v.entries.every((e: any) => e && typeof e.id === 'string' && /^[0-9]+(?:\.[0-9]+)*$/.test(e.id) && e.id.length <= 200 && typeof e.text === 'string' && e.text.length > 0 && e.text.length <= 20000 && typeof e.zh === 'string' && e.zh.trim().length > 0 && e.zh.length <= 20000);
const validSettings = (v: any) => v && typeof v.showChinese === 'boolean' && Object.keys(v).length === 1;

export class Storage {
  status = '尚未连接同步笔记';
  private state!: State;
  private folder: string;
  private file: string;
  private listeners = new Set<() => void>();
  private queue: Promise<any> = Promise.resolve();
  private observer: any;
  private timer: any;
  private stopped = false;
  private writing = false;
  private savedSnapshot: string | undefined;
  constructor(private Z: any, private io: any, private path: any, private prefs: Prefs) {
    this.folder = path.join(Z.DataDirectory.dir, 'bilingual-outline');
    this.file = path.join(this.folder, 'state.json');
  }
  private emit() { for (const fn of this.listeners) { try { fn(); } catch (_) { /* isolate UI listeners */ } } }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.queue.then(fn); this.queue = job.catch(() => {}); return job;
  }
  private async persist() {
    const snapshot = JSON.stringify(this.state);
    try { await this.io.writeJSON(this.file, this.state, { tmpPath: this.file + '.tmp' }); this.savedSnapshot = snapshot; }
    catch (e) { if (this.savedSnapshot) this.state = JSON.parse(this.savedSnapshot); this.emit(); throw e; }
  }
  private win(window?: any) { return window || this.Z.getMainWindow(); }
  private prompts(window?: any) { return (this.win(window).Services || (globalThis as any).Services).prompt; }
  private confirm(window: any, text: string) { return this.prompts(window).confirm(window, 'Bilingual Outline', text); }
  private alert(window: any, text: string) { this.prompts(window).alert(window, 'Bilingual Outline', text); }
  async init() {
    await this.io.makeDirectory(this.folder, { ignoreExisting: true });
    if (await this.io.exists(this.file)) {
      const raw = await this.io.readJSON(this.file);
      if (raw.schema !== 1 || !/^[A-Za-z0-9_-]{1,100}$/.test(raw.actor) || !Array.isArray(raw.noteKeys)) throw new Error('本机双语目录缓存无法识别；已保留原文件，请勿删除。');
      validateRecords(raw.translations, validTranslation); validateRecords(raw.settings, validSettings); this.state = raw; this.savedSnapshot = JSON.stringify(raw);
    } else {
      const actor = 'd' + this.Z.Utilities.randomString(32);
      this.state = { schema: 1, actor, translations: {}, settings: {}, noteKeys: [] };
      await this.persist();
    }
    this.observer = this.Z.Notifier.registerObserver({ notify: () => {
      if (this.writing || this.stopped) return;
      const w = this.win(); if (this.timer) w.clearTimeout(this.timer);
      this.timer = w.setTimeout(() => { this.timer = null; void this.sync().catch(() => {}); }, 1200);
    } }, ['item'], 'bilingual-outline-storage');
    await this.sync();
  }
  async close() {
    this.stopped = true;
    if (this.timer) this.win().clearTimeout(this.timer);
    if (this.observer !== undefined) this.Z.Notifier.unregisterObserver(this.observer);
    await this.queue; this.listeners.clear();
  }
  get(key: string): Translation | null { const versions = this.state.translations[key] || []; return versions.length === 1 ? JSON.parse(JSON.stringify(versions[0].value)) : null; }
  hasConflict(key: string) { return (this.state.translations[key]?.length || 0) > 1; }
  getSyncInfo() { return { connected: !!this.state.parentKey, settingsConflict: (this.state.settings.preferences?.length || 0) > 1 }; }
  getSettings(): Settings { return { ...(this.state.settings.preferences?.[0]?.value || { showChinese: true }) }; }
  async put(key: string, value: Translation) {
    return this.run(async () => {
      if (!/^[A-Za-z0-9:_-]{1,120}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key) || !validTranslation(value)) throw new Error('目录数据无效，未保存。');
      if (this.hasConflict(key)) throw new Error('此 PDF 存在同步冲突，请先选择保留的整份译文。');
      const next = change(this.state.translations[key] || [], this.state.actor, JSON.parse(JSON.stringify(value)));
      splitRecords({ [key]: next });
      this.state.translations[key] = next; await this.persist(); this.emit(); await this.syncNow(false);
    });
  }
  async setSettings(value: Settings) {
    return this.run(async () => {
      if ((this.state.settings.preferences?.length || 0) > 1) throw new Error('设置存在同步冲突，请先在设置页点击“同步”并选择保留版本。');
      this.state.settings.preferences = change(this.state.settings.preferences || [], this.state.actor, { showChinese: value.showChinese });
      await this.persist(); this.emit(); await this.syncNow(false);
    });
  }
  async sync(interactive = false) { return this.run(() => this.syncNow(interactive)); }
  private kind(item: any): string | null {
    // Notes identify themselves through their managed payload, not user-visible tags.
    try {
      const doc = new (this.win().DOMParser)().parseFromString(item.getNote(), 'text/html');
      const payload = JSON.parse(doc.querySelector('pre')?.textContent || '');
      if (payload.plugin === 'zotero-bilingual-outline' && payload.schema === 1
        && ['settings', 'translations'].includes(payload.kind)) return payload.kind;
    } catch (_) { /* Missing or damaged payload is not a recognized note. */ }
    return null;
  }
  private decode(item: any, kind: string): Records<any> {
    const doc = new (this.win().DOMParser)().parseFromString(item.getNote(), 'text/html');
    let obj;
    try { obj = JSON.parse(doc.querySelector('pre')?.textContent || ''); } catch (_) { throw new Error('本插件同步笔记内容损坏或被编辑，已停止写入；本机译文保留。'); }
    if (obj.schema !== 1 || obj.plugin !== 'zotero-bilingual-outline' || obj.kind !== kind) throw new Error('同步笔记身份或格式不一致，已停止写入。');
    return validateRecords(obj.records, kind === 'settings' ? validSettings : validTranslation);
  }
  private async parent() {
    if (!this.state.parentKey) return null;
    const item = await this.Z.Items.getByLibraryAndKeyAsync(this.Z.Libraries.userLibraryID, this.state.parentKey);
    if (!item || item.deleted || item.itemType !== 'computerProgram' || !this.isParent(item)) throw new Error('已连接的系列父条目已消失、进入回收站或标记改变。请恢复原条目；本插件不会自动重建。');
    return item;
  }
  private isParent(item: any) { return String(item.getField('extra')).split(/\r?\n/).some((line: string) => line.trim() === PARENT); }
  private async notes(parent: any) {
    const found: any[] = [];
    for (const id of parent.getNotes(true)) {
      const item = await this.Z.Items.getAsync(id);
      if (item && this.kind(item)) {
        if (item.deleted) throw new Error('本插件同步笔记在回收站中，请恢复该笔记后同步。');
        found.push(item);
      }
    }
    for (const key of this.state.noteKeys) if (!found.some(n => n.key === key)) throw new Error('已连接的本插件同步笔记缺失或身份改变，请恢复原笔记后同步；本机数据已保留。');
    return found.sort((a, b) => a.key.localeCompare(b.key));
  }
  private syncBusy() { return !!this.Z.Sync?.Runner?.syncInProgress; }
  private async syncNow(interactive: boolean) {
    if (this.stopped) return;
    if (!this.state.parentKey) { this.status = '本机保存；尚未连接同步笔记'; this.emit(); return; }
    if (this.syncBusy()) { this.status = 'Zotero 正在同步，稍后自动协调笔记'; this.emit();
      if (!this.timer) this.timer = this.win().setTimeout(() => { this.timer = null; void this.sync(); }, 5000); return; }
    this.writing = true;
    try {
      const parent = await this.parent(); const notes = await this.notes(parent);
      const settingsOn = this.prefs.get('syncSettings', true), translationsOn = this.prefs.get('syncTranslations', true);
      // Read and validate every enabled note before any remote mutation.
      let mergedSettings = this.state.settings;
      let mergedTranslations = this.state.translations;
      for (const note of notes) {
        const kind = this.kind(note)!;
        if (kind === 'settings' && settingsOn) mergedSettings = mergeRecords(mergedSettings, this.decode(note, kind));
        if (kind === 'translations' && translationsOn) mergedTranslations = mergeRecords(mergedTranslations, this.decode(note, kind));
      }
      this.state.settings = mergedSettings;
      this.state.translations = mergedTranslations;
      this.state.noteKeys = [...new Set([...this.state.noteKeys, ...notes.map(n => n.key)])];
      await this.persist();
      if (interactive && settingsOn && (this.state.settings.preferences?.length || 0) > 1) await this.choose('preferences', this.state.settings, this.win(), '设置');
      if (settingsOn) await this.writePages(parent, notes.filter(n => this.kind(n) === 'settings'), 'settings', [this.state.settings]);
      if (translationsOn) {
        const translationNotes = notes.filter(n => this.kind(n) === 'translations');
        await this.writePages(parent, translationNotes, 'translations', this.allocatePages(translationNotes));
      }
      await this.persist();
      const conflicts = Object.values(this.state.translations).filter(v => v.length > 1).length;
      const settingsConflict = (this.state.settings.preferences?.length || 0) > 1;
      this.status = `本机已保存；${settingsOn || translationsOn ? '已协调启用的同步笔记（云端传输由 Zotero 完成）' : '设置和译文同步均已关闭'}` + (conflicts ? `；${conflicts} 份译文待解决冲突` : '') + (settingsConflict ? '；设置待解决冲突，点击同步选择' : '');
    } catch (e) {
      this.status = '本机数据保留；' + (e instanceof Error ? e.message : '同步失败');
      if (interactive) this.alert(this.win(), this.status);
    } finally { this.writing = false; this.emit(); }
  }
  private allocatePages(notes: any[]): Records<Translation>[] {
    const pages: Records<Translation>[] = notes.map(() => ({}));
    if (!pages.length) pages.push({});
    const assigned = new Set<string>();
    const fits = (page: Records<Translation>) => noteBytes(noteHTML('translations', page, 'Bilingual Outline · 译文 999999')) <= NOTE_LIMIT;
    // Keep each existing record on its page when possible, and reclaim holes for new data.
    for (let i = 0; i < notes.length; i++) for (const key of Object.keys(this.decode(notes[i], 'translations'))) {
      if (assigned.has(key) || !this.state.translations[key]) continue;
      const candidate = { ...pages[i], [key]: this.state.translations[key] };
      if (fits(candidate)) { pages[i] = candidate; assigned.add(key); }
    }
    for (const key of Object.keys(this.state.translations).sort()) {
      if (assigned.has(key)) continue;
      const record = { [key]: this.state.translations[key] }; splitRecords(record);
      const page = pages.find(p => fits({ ...p, ...record }));
      if (page) page[key] = this.state.translations[key]; else pages.push(record);
    }
    return pages;
  }
  private async writePages(parent: any, existing: any[], kind: string, pages: Records<any>[]) {
    // Reuse discovered pages, including pages concurrently created on another device.
    // Empty surplus pages retain identity and prevent missing-note false alarms.
    for (let i = 0; i < Math.max(pages.length, existing.length); i++) {
      const label = kind === 'settings' ? 'Bilingual Outline · 设置' : 'Bilingual Outline · 译文 ' + String(i + 1).padStart(3, '0');
      const html = noteHTML(kind, pages[i] || {}, label);
      if (noteBytes(html) > NOTE_LIMIT) throw new Error('同步笔记超过安全容量，未写入此页。');
      let note = existing[i];
      if (!note) { note = new this.Z.Item('note'); note.libraryID = this.Z.Libraries.userLibraryID; note.parentID = parent.id; }
      // Zotero normalizes HTML on save: compare decoded data to avoid notifier loops.
      if (!note.id || JSON.stringify(this.decode(note, kind)) !== JSON.stringify(pages[i] || {})) {
        note.setNote(html); await note.saveTx();
      }
      if (!this.state.noteKeys.includes(note.key)) { this.state.noteKeys.push(note.key); await this.persist(); }
    }
  }
  async connect(window: any) {
    return this.run(async () => {
      if (this.state.parentKey) { await this.syncNow(true); return; }
      if (this.syncBusy()) { this.alert(window, '请等待 Zotero 同步完成后再连接。'); return; }
      if (!this.confirm(window, '请先完成本机 Zotero 同步，再连接插件数据。确认当前个人库已同步完整？本操作仅创建本插件专属笔记。')) return;
      const matching = (await this.Z.Items.getAll(this.Z.Libraries.userLibraryID, true, true)).filter((i: any) => i.itemType === 'computerProgram' && this.isParent(i));
      if (matching.some((i: any) => i.deleted)) throw new Error('系列父条目在回收站中，请先恢复或处理该条目，再连接。');
      const candidates = matching;
      if (candidates.length > 1) throw new Error('发现多个系列父条目，请先在 Zotero 中处理重复条目，再连接。');
      let parent = candidates[0];
      if (!parent) {
        if (!this.confirm(window, '未找到带系列标记的 Personal zotero addons 条目。确认在个人库新建该条目并连接？')) return;
        parent = new this.Z.Item('computerProgram'); parent.libraryID = this.Z.Libraries.userLibraryID; parent.setField('title', 'Personal zotero addons'); parent.setField('extra', PARENT); await parent.saveTx();
      }
      this.state.parentKey = parent.key; await this.persist(); await this.syncNow(true);
    });
  }
  private async choose<T>(key: string, records: Records<T>, window: any, label: string) {
    const versions = records[key] || []; if (versions.length < 2) return;
    const list = versions.map((v, i) => `${i + 1}. ${v.updatedAt} · ` + (label === '设置' ? (v.value as any)?.showChinese ? '显示中文' : '仅英文' : `${(v.value as any)?.title || key} · ${(v.value as any)?.entries?.slice(0, 2).map((e: any) => e.zh).join(' / ') || '删除版本'}`));
    const selected = { value: 0 };
    if (!this.prompts(window).select(window, '选择保留的整份' + label, '以下版本互相冲突。选择一份后覆盖此记录的其他版本。', list, selected)) return;
    if (label === '译文') {
      const chosen = versions[selected.value].value as any;
      const preview = chosen ? chosen.entries.map((e: any) => `${e.text}\n${e.zh}`).join('\n\n') : '删除版本';
      if (!this.confirm(window, '确认保留下面这整份译文并替换其他冲突版本？\n\n' + preview)) return;
    }
    records[key] = change(versions, this.state.actor, versions[selected.value].value); await this.persist();
  }
  async resolve(key: string, window: any) { return this.run(async () => { await this.choose(key, this.state.translations, window, '译文'); this.emit(); await this.syncNow(false); }); }
  private attachmentKey(key: string) { return key.includes(':') ? key.slice(key.lastIndexOf(':') + 1) : key; }
  async cleanup(window: any) {
    return this.run(async () => {
      if (this.syncBusy()) { this.alert(window, 'Zotero 正在同步，请完成同步后再清理。'); return; }
      if (!this.confirm(window, '清理只针对 PDF 条目已永久删除的译文。请先完成 Zotero 同步，确认当前个人库数据完整后继续检查。')) return;
      const dead: string[] = [];
      for (const [key, versions] of Object.entries(this.state.translations)) {
        if (!versions.some(v => v.value)) continue;
        const item = await this.Z.Items.getByLibraryAndKeyAsync(this.Z.Libraries.userLibraryID, this.attachmentKey(key));
        if (!item) dead.push(key); // Trashed / unavailable attachments still exist and are never deleted here.
      }
      if (!dead.length) { this.alert(window, '没有发现关联 PDF 已永久删除的译文。'); return; }
      const names = dead.map(k => this.state.translations[k].find(v => v.value)?.value?.title || k);
      if (!this.confirm(window, `将删除以下 ${dead.length} 份失效译文块，执行前自动保存本机备份：\n\n${names.join('\n')}\n\n清理结果将参与已启用的译文同步。`)) return;
      const backup = this.path.join(this.folder, 'cleanup-backup.json');
      await this.io.writeJSON(backup, { schema: 1, records: Object.fromEntries(dead.map(k => [k, this.state.translations[k]])) }, { tmpPath: backup + '.tmp' });
      for (const key of dead) this.state.translations[key] = change(this.state.translations[key], this.state.actor, null);
      await this.persist(); this.emit(); await this.syncNow(false);
      this.alert(window, `已清理 ${dead.length} 份译文；最近一次清理备份保存在本机，可通过“恢复最近清理”恢复。`);
    });
  }
  async restore(window: any) {
    return this.run(async () => {
      const backup = this.path.join(this.folder, 'cleanup-backup.json');
      if (!(await this.io.exists(backup))) { this.alert(window, '没有可恢复的本机清理备份。'); return; }
      const raw = await this.io.readJSON(backup); if (raw.schema !== 1) throw new Error('清理备份版本不支持。');
      const records = validateRecords<Translation>(raw.records, validTranslation);
      if (!this.confirm(window, `恢复最近清理备份的 ${Object.keys(records).length} 份记录？恢复内容会${this.prefs.get('syncTranslations', true) ? '参与译文同步' : '保存在本机，启用译文同步后参与同步'}。`)) return;
      for (const [key, versions] of Object.entries(records)) {
        const all = [...(this.state.translations[key] || []), ...versions];
        // Preserve multiple backup alternatives as a conflict; explicit resolution follows.
        this.state.translations[key] = versions.filter(v => v.value).map(v => change(all, this.state.actor, v.value)[0]);
      }
      await this.persist(); this.emit(); await this.syncNow(false);
    });
  }
}
