import type { OutlineEntry } from './types';

export function outlineBranches(tree: any[]): any[] {
  return (Array.isArray(tree) ? tree : []).flatMap(node => node.items?.length ? [node, ...outlineBranches(node.items)] : []);
}

export function toggleAllOutline(tree: any[]): any[] {
  const expanded = outlineBranches(tree).some(node => !node.expanded);
  const walk = (nodes: any[]): any[] => nodes.map(node => node.items?.length
    ? { ...node, expanded, ...('expandedBak' in node ? { expandedBak: expanded } : {}), items: walk(node.items) }
    : { ...node });
  return walk(tree);
}

/** Full tree paths never depend on expansion, filtering or native row counters. */
export function flattenOutline(tree: any[]): OutlineEntry[] {
  const result: OutlineEntry[] = [];
  function walk(items: any[], prefix: string) {
    items.forEach((node, i) => {
      const id = prefix ? `${prefix}.${i}` : String(i);
      result.push({ id, text: typeof node?.title === 'string' ? node.title : '' });
      if (Array.isArray(node?.items)) walk(node.items, id);
    });
  }
  if (Array.isArray(tree)) walk(tree, '');
  return result;
}

/** Exact canonical signature: deliberately collision-free rather than a small hash. */
export function outlineSignature(entries: OutlineEntry[]): string {
  return JSON.stringify(entries.map(({ id, text }) => [id, text]));
}

/** Mirrors Zotero 10.0.2 OutlineView.renderItems, not its keyboard flatten(). */
export function visibleOutlineMap(tree: any[]): Map<string, OutlineEntry> {
  const result = new Map<string, OutlineEntry>();
  let counter = -1;
  function walk(items: any[], prefix: string) {
    items.forEach((node, i) => {
      const nativeId = String(++counter);
      const id = prefix ? `${prefix}.${i}` : String(i);
      if (node.matched === false && node.childMatched === false) return;
      result.set(nativeId, { id, text: typeof node.title === 'string' ? node.title : '' });
      if (node.expanded && Array.isArray(node.items)) walk(node.items, id);
    });
  }
  if (Array.isArray(tree)) walk(tree, '');
  return result;
}
