import { test } from 'node:test';
import assert from 'node:assert/strict';
import { change, mergeRecords, mergeVersions, splitRecords, noteHTML, noteBytes, validateRecords } from '../src/sync';
test('different PDF changes from offline devices survive a whole-note overwrite', () => {
  const a = { PDF1: change([], 'A', 'one') }, b = { PDF2: change([], 'B', 'two') };
  assert.deepEqual(Object.keys(mergeRecords(a, b)).sort(), ['PDF1', 'PDF2']);
});
test('same PDF concurrent edits conflict; explicit whole record choice resolves all', () => {
  const base = change([], 'A', 'old');
  const a = change(base, 'A', 'new A'), b = change(base, 'B', 'new B');
  const conflict = mergeVersions(a, b); assert.equal(conflict.length, 2);
  const resolved = change(conflict, 'A', 'new B');
  assert.deepEqual(mergeVersions(resolved, a), resolved);
  assert.deepEqual(mergeVersions(resolved, b), resolved);
});
test('remote descendant replaces unchanged local; merges are commutative and idempotent', () => {
  const a = change([], 'A', 'one'), b = change(a, 'B', 'two');
  assert.deepEqual(mergeVersions(a, b), b);
  assert.deepEqual(mergeVersions(a, b), mergeVersions(b, a));
  assert.deepEqual(mergeVersions(b, b), b);
});
test('permanent deletion cannot be resurrected by old or concurrent offline edits; explicit restore works', () => {
  const initial = change([], 'A', 'text'), deleted = change(initial, 'A', null);
  assert.equal(mergeVersions(deleted, initial)[0].value, null);
  const offline = change(initial, 'B', 'offline');
  const merged = mergeVersions(deleted, offline); assert.equal(merged[0].value, null);
  const restored = change(merged, 'A', 'restored');
  assert.equal(mergeVersions(restored, offline)[0].value, 'restored');
});
test('partition uses final escaped UTF8 HTML; oversized individual record rejected', () => {
  const records = Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['PDF' + i, change([], 'A', '中文<&>'.repeat(15))]));
  const pages = splitRecords(records, 1800); assert.ok(pages.length > 1);
  for (const page of pages) assert.ok(noteBytes(noteHTML('translations', page, 'Bilingual Outline · 译文 999999')) <= 1800);
  assert.equal(Object.keys(Object.assign({}, ...pages)).length, 10);
  assert.throws(() => splitRecords({ Huge: change([], 'A', '中'.repeat(1000)) }, 1000));
});
test('malformed clocks and values are rejected', () => {
  assert.throws(() => validateRecords({ p: [{ clock: { A: -1 }, value: 'x', updatedAt: new Date().toISOString() }] }, () => true));
  assert.throws(() => validateRecords({ p: change([], 'A', 'bad') }, v => typeof v === 'number'));
});
