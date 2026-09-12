export interface OutlineEntry { id: string; text: string }
export interface Translation { outlineHash: string; title: string; entries: Array<OutlineEntry & {zh: string}>; updatedAt: string }
export interface Prefs { get<T>(name: string, fallback: T): T; set(name: string, value: string | boolean | number): void }
