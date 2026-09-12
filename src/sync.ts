export type Clock = Record<string, number>;
export interface Version<T> { clock: Clock; value: T | null; updatedAt: string }
export type Records<T> = Record<string, Version<T>[]>;
export function dominates(a: Clock, b: Clock): boolean {
  return Object.keys(b).every(k => (a[k] || 0) >= b[k]);
}
export function joinClock(versions: Array<Version<unknown>>): Clock {
  const clock: Clock = {};
  for (const v of versions) for (const [k, n] of Object.entries(v.clock)) clock[k] = Math.max(clock[k] || 0, n);
  return clock;
}
export function change<T>(current: Version<T>[], actor: string, value: T | null): Version<T>[] {
  const clock = joinClock(current); clock[actor] = (clock[actor] || 0) + 1;
  return [{ clock, value, updatedAt: new Date().toISOString() }];
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable((value as any)[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function mergeVersions<T>(a: Version<T>[], b: Version<T>[]): Version<T>[] {
  const all = [...a, ...b];
  const unique = all.filter((v, i) => all.findIndex(w => stable(w) === stable(v)) === i);
  const frontier = unique.filter(v => !unique.some(w => w !== v && dominates(w.clock, v.clock) && !dominates(v.clock, w.clock)));
  // A permanent deletion also suppresses a concurrent edit from an offline device.
  // Retain the joined clock so an explicit restore can supersede that deletion.
  if (frontier.some(v => v.value === null)) return [{ clock: joinClock(frontier), value: null, updatedAt: frontier.map(v => v.updatedAt).sort().at(-1)! }];
  return frontier.sort((x, y) => stable(x).localeCompare(stable(y)));
}
export function mergeRecords<T>(a: Records<T>, b: Records<T>): Records<T> {
  const result: Records<T> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) result[k] = mergeVersions(a[k] || [], b[k] || []);
  return result;
}
export function validateRecords<T>(input: unknown, validateValue: (v: any) => boolean): Records<T> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('同步记录格式无效');
  if (Object.keys(input).length > 100000) throw new Error('同步记录数量超出本插件保护限制');
  for (const [key, versions] of Object.entries(input)) {
    if (!/^[A-Za-z0-9:_-]{1,120}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key) || !Array.isArray(versions) || !versions.length || versions.length > 1000) throw new Error('同步记录标识无效');
    for (const v of versions) {
      if (!v || typeof v.updatedAt !== 'string' || !Number.isFinite(Date.parse(v.updatedAt)) || !v.clock || typeof v.clock !== 'object' || Array.isArray(v.clock) || !Object.keys(v.clock).length || Object.keys(v.clock).length > 1000) throw new Error('同步版本无效');
      for (const [actor, count] of Object.entries(v.clock)) if (!/^[A-Za-z0-9_-]{1,100}$/.test(actor) || ['__proto__', 'constructor', 'prototype'].includes(actor) || !Number.isSafeInteger(count) || (count as number) < 1) throw new Error('同步时钟无效');
      if (v.value !== null && !validateValue(v.value)) throw new Error('同步内容无效');
    }
  }
  return input as Records<T>;
}
export const NOTE_LIMIT = 180000; // Plugin safety threshold, UTF-8 bytes of complete HTML.
export function noteHTML(kind: string, records: Records<unknown>, label: string): string {
  const payload = JSON.stringify({ schema: 1, plugin: 'zotero-bilingual-outline', kind, records });
  const escaped = payload.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '<div data-schema-version="9"><p>' + label + '</p><p>由 Bilingual Outline 管理，请勿直接编辑。</p><pre>' + escaped + '</pre></div>';
}
export function noteBytes(html: string): number { return new TextEncoder().encode(html).length; }
export function splitRecords<T>(records: Records<T>, limit = NOTE_LIMIT): Records<T>[] {
  const pages: Records<T>[] = [{}];
  for (const key of Object.keys(records).sort()) {
    const one = { [key]: records[key] };
    if (noteBytes(noteHTML('translations', one, 'Bilingual Outline · 译文 999999')) > limit) throw new Error('这份目录超过单条同步笔记的安全容量；已有译文保持不变。');
    let page = pages.at(-1)!;
    if (noteBytes(noteHTML('translations', { ...page, ...one }, 'Bilingual Outline · 译文 999999')) > limit) { page = {}; pages.push(page); }
    page[key] = records[key];
  }
  return pages;
}
