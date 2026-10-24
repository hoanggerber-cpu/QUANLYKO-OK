export type ProductImageMergeRecord = {
  id: string;
  image?: string;
  updatedAt?: string;
  createdAt?: string;
};

function timestamp(record: ProductImageMergeRecord): number {
  const value = record.updatedAt || record.createdAt;
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Merge remote and local product records by recency without letting a newer
 * record with a blank/unusable image erase a recoverable image from the other
 * copy. The callback lets callers reject ephemeral or unresolved image URLs.
 */
export function mergeProductRecordsByUpdatedAt<T extends ProductImageMergeRecord>(
  remote: readonly T[],
  local: readonly T[],
  isUsableImage: (image?: string) => boolean = image => Boolean(image?.trim()),
): T[] {
  const merged = new Map<string, T>();

  const putNewer = (product: T) => {
    const current = merged.get(product.id);
    if (!current) {
      merged.set(product.id, product);
      return;
    }

    const productWins = timestamp(product) >= timestamp(current);
    const winner = productWins ? product : current;
    const fallback = productWins ? current : product;
    const preferredImage = winner.image?.trim() || '';
    const fallbackImage = fallback.image?.trim() || '';

    const image = isUsableImage(preferredImage)
      ? preferredImage
      : isUsableImage(fallbackImage)
        ? fallbackImage
        : preferredImage || fallbackImage || '';

    merged.set(product.id, { ...winner, image } as T);
  };

  remote.forEach(putNewer);
  local.forEach(putNewer);

  return Array.from(merged.values()).sort((a, b) => timestamp(b) - timestamp(a));
}
