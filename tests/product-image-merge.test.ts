import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeProductRecordsByUpdatedAt } from '../src/lib/productImageMerge.ts';

test('a newer cloud record with an empty image does not erase the local image', () => {
  const result = mergeProductRecordsByUpdatedAt(
    [{ id: 'p1', name: 'Cloud name', image: '', updatedAt: '2026-10-20T00:00:00Z' }],
    [{ id: 'p1', name: 'Local name', image: 'data:image/png;base64,LOCAL', updatedAt: '2026-10-01T00:00:00Z' }],
  );

  assert.equal(result[0].name, 'Cloud name');
  assert.equal(result[0].image, 'data:image/png;base64,LOCAL');
});

test('a newer cloud image remains preferred when it is usable', () => {
  const result = mergeProductRecordsByUpdatedAt(
    [{ id: 'p1', image: 'https://cdn.example.test/product.png', updatedAt: '2026-10-20T00:00:00Z' }],
    [{ id: 'p1', image: 'data:image/png;base64,LOCAL', updatedAt: '2026-10-01T00:00:00Z' }],
  );

  assert.equal(result[0].image, 'https://cdn.example.test/product.png');
});

test('a local image fills a blank cloud image even when timestamps tie', () => {
  const result = mergeProductRecordsByUpdatedAt(
    [{ id: 'p1', image: '', updatedAt: '2026-10-20T00:00:00Z', name: 'Cloud' }],
    [{ id: 'p1', image: 'https://cdn.example.test/local.png', updatedAt: '2026-10-20T00:00:00Z', name: 'Local' }],
  );

  assert.equal(result[0].name, 'Local');
  assert.equal(result[0].image, 'https://cdn.example.test/local.png');
});

test('an unusable preferred image falls back to the other copy', () => {
  const result = mergeProductRecordsByUpdatedAt(
    [{ id: 'p1', image: 'blob:expired-reference', updatedAt: '2026-10-20T00:00:00Z' }],
    [{ id: 'p1', image: 'data:image/png;base64,LOCAL', updatedAt: '2026-10-01T00:00:00Z' }],
    image => Boolean(image && !image.startsWith('blob:')),
  );

  assert.equal(result[0].image, 'data:image/png;base64,LOCAL');
});

test('empty images stay empty when neither copy has a recoverable image', () => {
  const result = mergeProductRecordsByUpdatedAt(
    [{ id: 'p1', image: '', updatedAt: '2026-10-20T00:00:00Z' }],
    [{ id: 'p1', image: '', updatedAt: '2026-10-01T00:00:00Z' }],
  );

  assert.equal(result[0].image, '');
});
