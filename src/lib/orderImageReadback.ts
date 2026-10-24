export type RemoteOrderImages = { order_images?: unknown };
export type RemoteItemImage = { id?: string; image?: string | null };

/**
 * The cloud is not confirmed until it contains the exact image references
 * selected when the invoice was created. An HTTP URL alone does not prove
 * that an object exists in Storage; this guard protects DB readback only.
 */
export function matchesOrderImageReadback(local: {orderImages?: string[]; items?: Array<{id: string; image?: string}>}, remote: RemoteOrderImages | null | undefined, items: RemoteItemImage[]): boolean {
  if (!remote) return false;
  let json: unknown = remote.order_images;
  try {
    if (typeof json === 'string') json = JSON.parse(json);
  } catch {
    return false;
  }
  if (!json || typeof json !== 'object' || !Array.isArray((json as {images?:unknown}).images)) return false;
  const stored = (json as {images:string[]}).images;
  const expected = local.orderImages || [];
  if (stored.length !== expected.length || stored.some((s,i) => s !== expected[i])) return false;
  const localItems = local.items || [];
  if (items.length !== localItems.length) return false;
  const byId = new Map(items.map(item => [item.id,item]));
  for (const item of localItems) {
    const cloud = byId.get(item.id);
    if (!cloud || (cloud.image || '') !== (item.image || '')) return false;
  }
  return true;
}
