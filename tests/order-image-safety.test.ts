import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPersistentOrderImages, confirmedImageUpload } from '../src/lib/orderImageSafety.ts';

test('HTTPS image is eligible for persistence, including a correctly uploaded design', () => {
  assert.doesNotThrow(() => assertPersistentOrderImages([
    'https://example.supabase.co/storage/v1/object/public/order-images/originals/design.png',
    undefined,
    null
  ]));
});

test('temporary URLs never pass into an order', () => {
  for (const bad of [
    'blob:https://example.app/123',
    'data:image/png;base64,YWJj',
    'backup-asset:item-a',
    'file:///C:/Users/image.png',
    'http://example.test/image.png',
    'javascript:alert(1)'
  ]) {
    assert.throws(() => assertPersistentOrderImages([bad]), /chưa được tải lên Supabase/);
  }
});

test('failed upload blocks order persistence', async () => {
  await assert.rejects(confirmedImageUpload(async () => { throw new Error('Storage upload failed'); }), /Storage upload failed/);
  await assert.rejects(confirmedImageUpload(async () => undefined), /không trả về đường dẫn/);
  await assert.rejects(confirmedImageUpload(async () => 'blob:https://example.app/123'), /chưa được tải lên Supabase/);
});

test('successful mocked upload produces a reload-safe HTTPS URL', async () => {
  const uploadedUrl = 'https://example.supabase.co/storage/v1/object/public/order-images/originals/design.png';
  const persistedUrl = await confirmedImageUpload(async () => uploadedUrl);
  assert.equal(persistedUrl, uploadedUrl);
  assert.doesNotThrow(() => assertPersistentOrderImages([persistedUrl]));
});

test('unrelated edits do not need to re-validate historical image URLs', () => {
  // StorageManager.updateOrder passes only explicitly updated image fields.
  assert.doesNotThrow(() => assertPersistentOrderImages([]));
});
