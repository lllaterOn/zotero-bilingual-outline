import test from 'node:test';
import assert from 'node:assert/strict';
import { flattenOutline, outlineSignature, visibleOutlineMap } from '../src/outline';

test('full paths include collapsed and filtered nodes, not mutable view properties', () => {
  const tree = [{ title: 'Same', expanded: false, items: [{ title: 'Same', items: [{ title: 'long '.repeat(400) }] }] }, { title: 'Same', matched: false, childMatched: false }];
  const before = flattenOutline(tree);
  assert.deepEqual(before.map(e => e.id), ['0', '0.0', '0.0.0', '1']);
  tree[0].expanded = true; tree[1].matched = true;
  assert.equal(outlineSignature(before), outlineSignature(flattenOutline(tree)));
  tree[0].title = 'Changed';
  assert.notEqual(outlineSignature(before), outlineSignature(flattenOutline(tree)));
});

test('native render counter includes filtered siblings but never filtered or collapsed descendants', () => {
  const tree = [
    { title: 'hidden', matched: false, childMatched: false, expanded: true, items: [{ title: 'hidden child' }] },
    { title: 'visible', matched: true, childMatched: false, expanded: true, items: [
      { title: 'hidden', matched: false, childMatched: false }, { title: 'child' },
    ] },
    { title: 'collapsed', expanded: false, items: [{ title: 'child' }] }, { title: 'last' },
  ];
  assert.deepEqual([...visibleOutlineMap(tree)].map(([native, entry]) => [native, entry.id]), [['1', '1'], ['3', '1.1'], ['4', '2'], ['5', '3']]);
});

test('signature is canonical, unambiguous and independent of extra fields', () => {
  assert.notEqual(outlineSignature([{ id: '0', text: 'a|b' }]), outlineSignature([{ id: '0', text: 'a' }, { id: '1', text: 'b' }]));
  assert.equal(flattenOutline(null as any).length, 0);
  assert.equal(outlineSignature([]), '[]');
});
