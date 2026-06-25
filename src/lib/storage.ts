import { createClient } from '@supabase/supabase-js';
import { Product, Order, OrderItem, Customer, DashboardStats, OrderType, PaymentHistory } from '../types';
import { getOrderProductSummary } from '../utils/orderSummary';

const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL || 'https://ykbsykqqdjqgnpslemsw.supabase.co';
const SUPABASE_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrYnN5a3FxZGpxZ25wc2xlbXN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MTM0ODUsImV4cCI6MjA5NTA4OTQ4NX0.UY-W_jJYWcJrsT4_D-XQmVdfWy4UXWEXsfF-WBMjxwk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Frontend must not initialize business records. Empty storage should render
// empty states and only real Supabase/localStorage/backup data should be shown.
const SUPPRESSED_LEGACY_PRODUCT_IDS = new Set([
  'p1_m',
  'p1_l',
  'p1_xl',
  'p2_m',
  'p2_l',
  'p3_l',
  'p3_xl',
  'p4_m',
  'p4_l'
]);

const SUPPRESSED_LEGACY_ORDER_IDS = new Set(['o1', 'o2', 'o3', 'o4', 'o5', 'o6']);

export class StorageManager {
  private static STORAGE_PREFIX = 'petshirt_admin_';
  private static isSupabaseActive = false;
  private static backupAssetUrls = new Map<string, string>();

  private static openBackupAssetDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('petshirt-backup-assets', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('assets')) {
          request.result.createObjectStore('assets');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private static async saveEmbeddedAssets(assets: Record<string, string>): Promise<void> {
    const db = await this.openBackupAssetDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('assets', 'readwrite');
      const store = transaction.objectStore('assets');
      store.clear();
      Object.entries(assets).forEach(([id, dataUrl]) => store.put(dataUrl, id));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
    await this.initializeBackupAssets();
  }

  static async initializeBackupAssets(): Promise<void> {
    this.backupAssetUrls.forEach(url => URL.revokeObjectURL(url));
    this.backupAssetUrls.clear();
    try {
      const db = await this.openBackupAssetDb();
      const records = await new Promise<Array<[string, string]>>((resolve, reject) => {
        const transaction = db.transaction('assets', 'readonly');
        const store = transaction.objectStore('assets');
        const keysRequest = store.getAllKeys();
        const valuesRequest = store.getAll();
        transaction.oncomplete = () => resolve(keysRequest.result.map((key, index) => [String(key), valuesRequest.result[index]]));
        transaction.onerror = () => reject(transaction.error);
      });
      db.close();
      records.forEach(([id, dataUrl]) => {
        const [header, base64] = dataUrl.split(',');
        const mime = header.match(/data:([^;]+)/)?.[1] || 'application/octet-stream';
        const bytes = Uint8Array.from(atob(base64 || ''), char => char.charCodeAt(0));
        this.backupAssetUrls.set(id, URL.createObjectURL(new Blob([bytes], { type: mime })));
      });
    } catch (error) {
      console.warn('Unable to initialize embedded backup images:', error);
    }
  }

  private static resolveBackupAsset(url?: string): string | undefined {
    if (!url?.startsWith('backup-asset://')) return url;
    return this.backupAssetUrls.get(url.slice('backup-asset://'.length)) || url;
  }

  private static serializeBackupAsset(url?: string): string | undefined {
    if (!url) return url;
    for (const [id, objectUrl] of this.backupAssetUrls) {
      if (objectUrl === url) return `backup-asset://${id}`;
    }
    return url;
  }

  private static saveProducts(products: Product[]): void {
    localStorage.setItem(this.STORAGE_PREFIX + 'products', JSON.stringify(products.map(product => ({
      ...product,
      image: this.serializeBackupAsset(product.image) || ''
    }))));
  }

  private static normalizeProduct(product: Product): Product {
    const createdAt = product.createdAt || new Date().toISOString();
    return {
      ...product,
      createdAt,
      updatedAt: product.updatedAt || createdAt,
      deletedAt: product.deletedAt || null,
      syncVersion: Number(product.syncVersion || 1),
      image: this.resolveBackupAsset(product.image) || ''
    };
  }

  private static mergeProductsByUpdatedAt(remote: Product[], local: Product[]): Product[] {
    const merged = new Map<string, Product>();
    const putNewer = (product: Product) => {
      const normalized = this.normalizeProduct(product);
      const current = merged.get(normalized.id);
      if (!current) {
        merged.set(normalized.id, normalized);
        return;
      }
      const currentTime = new Date(current.updatedAt || current.createdAt).getTime();
      const nextTime = new Date(normalized.updatedAt || normalized.createdAt).getTime();
      if (nextTime >= currentTime) merged.set(normalized.id, normalized);
    };

    remote.forEach(putNewer);
    local.forEach(putNewer);
    return Array.from(merged.values()).sort((a, b) =>
      new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
    );
  }

  private static toProductPayload(product: Product, includeSyncMetadata: boolean = true): any {
    const payload: any = {
      id: product.id,
      name: product.name,
      image: product.image || '',
      color: product.color,
      stock: Number(product.stock) || 0,
      import_price: Number(product.importPrice) || 0,
      sale_price: Number(product.salePrice) || 0,
      source: product.source || 'self_produced',
      created_at: product.createdAt || new Date().toISOString()
    };
    if (product.size) payload.size = product.size;
    if (includeSyncMetadata) {
      payload.updated_at = product.updatedAt || product.createdAt || new Date().toISOString();
      payload.deleted_at = product.deletedAt || null;
      payload.sync_version = Number(product.syncVersion || 1);
    }
    return payload;
  }

  private static async insertProductPayload(product: Product): Promise<void> {
    const payload = this.toProductPayload(product, true);
    const { error } = await supabase.from('products').insert([payload]);
    if (!error) return;

    console.warn('Supabase product insert with sync metadata failed, retrying legacy schema:', error.message);
    const legacyPayload = this.toProductPayload(product, false);
    if (product.deletedAt) legacyPayload.source = '__deleted__';
    const { error: retryErr } = await supabase.from('products').insert([legacyPayload]);
    if (retryErr) throw retryErr;
  }

  private static async updateProductPayload(id: string, updatedProduct: Product, changedFields?: Partial<Product>): Promise<void> {
    const buildPayload = (includeSyncMetadata: boolean) => {
      const payload: any = {};
      if (!changedFields || changedFields.name !== undefined) payload.name = updatedProduct.name;
      if (!changedFields || changedFields.color !== undefined) payload.color = updatedProduct.color;
      if (!changedFields || changedFields.size !== undefined) payload.size = updatedProduct.size || null;
      if (!changedFields || changedFields.stock !== undefined) payload.stock = Number(updatedProduct.stock) || 0;
      if (!changedFields || changedFields.importPrice !== undefined) payload.import_price = Number(updatedProduct.importPrice) || 0;
      if (!changedFields || changedFields.salePrice !== undefined) payload.sale_price = Number(updatedProduct.salePrice) || 0;
      if (!changedFields || changedFields.source !== undefined) payload.source = updatedProduct.source;
      if (!changedFields || changedFields.image !== undefined) payload.image = updatedProduct.image || '';
      if (includeSyncMetadata) {
        payload.updated_at = updatedProduct.updatedAt || new Date().toISOString();
        payload.deleted_at = updatedProduct.deletedAt || null;
        payload.sync_version = Number(updatedProduct.syncVersion || 1);
      } else if (updatedProduct.deletedAt) {
        payload.source = '__deleted__';
      }
      return payload;
    };

    const { error } = await supabase.from('products').update(buildPayload(true)).eq('id', id);
    if (!error) return;

    console.warn('Supabase product update with sync metadata failed, retrying legacy schema:', error.message);
    const { error: retryErr } = await supabase.from('products').update(buildPayload(false)).eq('id', id);
    if (retryErr) throw retryErr;
  }

  private static saveLocalBackup(key: string, value: unknown): void {
    try {
      localStorage.setItem(
        this.STORAGE_PREFIX + 'backup_' + key,
        JSON.stringify({ createdAt: new Date().toISOString(), data: value })
      );
    } catch (error) {
      console.warn(`Unable to create local backup for ${key}:`, error);
    }
  }

  private static mergeById<T extends { id: string }>(remote: T[], local: T[]): T[] {
    const merged = new Map<string, T>();
    remote.forEach(item => merged.set(item.id, item));
    local.forEach(item => {
      if (!merged.has(item.id)) merged.set(item.id, item);
    });
    return Array.from(merged.values());
  }

  private static saveOrders(orders: Order[]): void {
    const key = this.STORAGE_PREFIX + 'orders';
    try {
      // Omit rawFile references from local state to ensure localStorage doesn't serialize empty objects
      const sanitized = orders.map(o => ({
        ...o,
        orderImages: o.orderImages?.map(image => this.serializeBackupAsset(image) || ''),
        items: o.items?.map(it => {
          const { rawFile, extraRawFiles, ...rest } = it as any;
          return {
            ...rest,
            image: this.serializeBackupAsset(rest.image),
            extraImages: rest.extraImages?.map((image: string) => this.serializeBackupAsset(image) || '')
          };
        })
      }));
      const previous = localStorage.getItem(key);
      if (previous) {
        try {
          this.saveLocalBackup('orders', JSON.parse(previous));
        } catch {
          this.saveLocalBackup('orders', previous);
        }
      }
      localStorage.setItem(key, JSON.stringify(sanitized));
    } catch (e: any) {
      const isQuotaError = 
        e.name === 'QuotaExceededError' || 
        e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || 
        e.message?.toLowerCase().includes('quota') || 
        e.name?.toLowerCase().includes('quota');

      if (isQuotaError) {
        console.warn('LocalStorage storage quota exceeded, cleaning up base64 image data from older orders to recover space...');
        // Create a deep copy to prune images safely without side-effects in memory
        try {
          const pruned = JSON.parse(JSON.stringify(orders)) as Order[];
          
          // Loop backwards from oldest to newest and clear heavy base64 image data
          for (let i = pruned.length - 1; i >= 0; i--) {
            let cleared = false;
            if (pruned[i].orderImages && pruned[i].orderImages!.length > 0) {
              pruned[i].orderImages = undefined;
              cleared = true;
            }
            if (pruned[i].items && pruned[i].items!.length > 0) {
              pruned[i].items!.forEach(item => {
                if (item.image) {
                  item.image = undefined;
                  cleared = true;
                }
              });
            }
            
            if (cleared) {
              try {
                localStorage.setItem(key, JSON.stringify(pruned));
                console.log(`Pruned images up to index ${i} to fit quota successfully.`);
                
                // Mutate original in-memory array if we want it synchronized
                orders.forEach((o, index) => {
                  o.orderImages = pruned[index].orderImages;
                  if (o.items && pruned[index].items) {
                    o.items!.forEach((it, itIdx) => {
                      it.image = pruned[index].items![itIdx].image;
                    });
                  }
                });
                return;
              } catch (innerErr) {
                // Keep trimming older orders if it still fails
              }
            }
          }
          
          console.error('Refusing to truncate accounting records because browser storage is full.');
        } catch (copyErr) {
          console.error('Failed to parse clean copy for pruning:', copyErr);
        }
      }
      throw e;
    }
  }

  static async checkSupabaseConnection(): Promise<boolean> {
    try {
      // Try to read products table
      const { data, error } = await supabase.from('products').select('id').limit(1);
      if (error && error.code !== 'PGRST116') { // not found error or similar
        console.warn('Supabase not fully initialized with tables:', error.message);
        this.isSupabaseActive = false;
        return false;
      }
      this.isSupabaseActive = true;
      return true;
    } catch (e) {
      console.warn('Cannot connect to Supabase backend, switching to offline-first Mode:', e);
      this.isSupabaseActive = false;
      return false;
    }
  }

  static getIsSupabaseActive(): boolean {
    return this.isSupabaseActive;
  }

  static isRestoreProtectionActive(): boolean {
    const protectedUntil = Number(localStorage.getItem(this.STORAGE_PREFIX + 'restore_protected_until') || 0);
    return protectedUntil > Date.now();
  }

  private static async sha256(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  static async inspectFullBackup(file: File): Promise<{
    format: string;
    createdAt: string;
    products: number;
    orders: number;
    paymentHistory: number;
    embeddedImages: number;
    failedImages: number;
    portableComplete: boolean;
    integrityValid: boolean;
  }> {
    const parsed = JSON.parse(await file.text());
    if (
      !['petshirt-backup-v1', 'petshirt-backup-v2', 'petshirt-backup-v3', 'petshirt-portable-v4'].includes(parsed?.format) ||
      !Array.isArray(parsed.products) ||
      !Array.isArray(parsed.orders) ||
      !Array.isArray(parsed.paymentHistory)
    ) {
      throw new Error('Tệp sao lưu không đúng định dạng hoặc đã bị hỏng.');
    }
    const { integrity, ...payload } = parsed;
    const integrityValid = !integrity?.sha256 || integrity.sha256 === await this.sha256(JSON.stringify(payload));
    return {
      format: parsed.format,
      createdAt: parsed.createdAt || '',
      products: parsed.products.length,
      orders: parsed.orders.length,
      paymentHistory: parsed.paymentHistory.length,
      embeddedImages: Object.keys(parsed.embeddedAssets || {}).length,
      failedImages: Array.isArray(parsed.failedImages) ? parsed.failedImages.length : 0,
      portableComplete: parsed.portable?.complete === true,
      integrityValid
    };
  }

  static async downloadFullBackup(): Promise<{ embeddedImages: number; failedImages: string[]; portableComplete: boolean }> {
    const products = this.getProducts().map(product => ({ ...product }));
    const orders = this.getOrders().map(order => ({
      ...order,
      orderImages: [...(order.orderImages || [])],
      items: order.items?.map(item => ({ ...item }))
    }));
    const paymentHistory = this.getPaymentHistory();
    const embeddedAssets: Record<string, string> = {};
    const sourceToRef = new Map<string, string>();
    const failedImages: string[] = [];

    const embedImage = async (source?: string): Promise<string | undefined> => {
      if (!source) return source;
      const existing = sourceToRef.get(source);
      if (existing) return existing;
      try {
        const response = await fetch(this.resolveBackupAsset(source) || source);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        const id = `asset_${Object.keys(embeddedAssets).length + 1}`;
        const ref = `backup-asset://${id}`;
        embeddedAssets[id] = dataUrl;
        sourceToRef.set(source, ref);
        return ref;
      } catch (error) {
        console.warn('Unable to embed backup image:', source, error);
        failedImages.push(source);
        return source;
      }
    };

    for (const product of products) product.image = (await embedImage(product.image)) || '';
    for (const order of orders) {
      order.orderImages = (await Promise.all((order.orderImages || []).map(image => embedImage(image)))).filter(Boolean) as string[];
      if (order.items) {
        for (const item of order.items) {
          item.image = await embedImage(item.image);
          item.extraImages = (await Promise.all((item.extraImages || []).map(image => embedImage(image)))).filter(Boolean) as string[];
        }
      }
    }
    const allLocalData: Record<string, unknown> = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(this.STORAGE_PREFIX) || key.includes('backup_') || key.endsWith('restore_protected_until')) continue;
      try {
        allLocalData[key] = JSON.parse(localStorage.getItem(key) || 'null');
      } catch {
        allLocalData[key] = localStorage.getItem(key);
      }
    }

    const payload = {
      format: 'petshirt-portable-v4',
      schemaVersion: 4,
      createdAt: new Date().toISOString(),
      portable: {
        complete: failedImages.length === 0,
        compatibleTargets: ['web', 'windows-desktop', 'macos-desktop'],
        restoreMode: 'replace-entire-application-data',
        imageStorage: 'embedded-assets'
      },
      summary: {
        products: products.length,
        orders: orders.length,
        paymentHistory: paymentHistory.length,
        totalStock: products.reduce((sum, product) => sum + product.stock, 0),
        embeddedImages: Object.keys(embeddedAssets).length,
        failedImages: failedImages.length
      },
      products,
      orders,
      paymentHistory,
      customerPins: this.getCustomerPins(),
      dtfCustomerPrices: (() => {
        try {
          return JSON.parse(localStorage.getItem(this.STORAGE_PREFIX + 'dtf_customer_prices') || '{}');
        } catch {
          return {};
        }
      })(),
      allLocalData,
      embeddedAssets,
      failedImages
    };
    const backup = {
      ...payload,
      integrity: {
        algorithm: 'SHA-256',
        sha256: await this.sha256(JSON.stringify(payload))
      }
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sao-luu-toan-bo-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return { embeddedImages: Object.keys(embeddedAssets).length, failedImages, portableComplete: failedImages.length === 0 };
  }

  static async restoreFullBackup(file: File): Promise<{ products: number; orders: number; paymentHistory: number; embeddedImages: number; failedImages: number }> {
    const parsed = JSON.parse(await file.text());
    if (
      !['petshirt-backup-v1', 'petshirt-backup-v2', 'petshirt-backup-v3', 'petshirt-portable-v4'].includes(parsed?.format) ||
      !Array.isArray(parsed.products) ||
      !Array.isArray(parsed.orders) ||
      !Array.isArray(parsed.paymentHistory)
    ) {
      throw new Error('Tệp sao lưu không đúng định dạng hoặc đã bị hỏng.');
    }
    const { integrity, ...payload } = parsed;
    if (integrity?.sha256 && integrity.sha256 !== await this.sha256(JSON.stringify(payload))) {
      throw new Error('Tệp backup không vượt qua kiểm tra toàn vẹn SHA-256. Restore đã bị dừng để tránh nhập dữ liệu hỏng.');
    }

    this.saveLocalBackup('products_before_restore', this.getProducts());
    this.saveLocalBackup('orders_before_restore', this.getOrders());
    this.saveLocalBackup('payment_history_before_restore', this.getPaymentHistory());

    if (['petshirt-backup-v3', 'petshirt-portable-v4'].includes(parsed.format)) {
      await this.saveEmbeddedAssets(parsed.embeddedAssets || {});
    }

    // Portable restore is a full replacement, so stale categories/settings from this device cannot leak in.
    if (parsed.format === 'petshirt-portable-v4') {
      const keysToRemove: string[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith(this.STORAGE_PREFIX) && !key.includes('backup_')) keysToRemove.push(key);
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
    }

    this.saveProducts(parsed.products);
    this.saveOrders(parsed.orders);
    this.savePaymentHistory(parsed.paymentHistory);
    this.saveCustomerPins(parsed.customerPins || {});
    localStorage.setItem(this.STORAGE_PREFIX + 'dtf_customer_prices', JSON.stringify(parsed.dtfCustomerPrices || {}));
    if (parsed.allLocalData && typeof parsed.allLocalData === 'object') {
      const protectedCoreKeys = new Set([
        this.STORAGE_PREFIX + 'products',
        this.STORAGE_PREFIX + 'orders',
        this.STORAGE_PREFIX + 'payment_history',
        this.STORAGE_PREFIX + 'customer_pins',
        this.STORAGE_PREFIX + 'dtf_customer_prices'
      ]);
      Object.entries(parsed.allLocalData).forEach(([key, value]) => {
        if (!key.startsWith(this.STORAGE_PREFIX) || key.includes('backup_') || key.endsWith('restore_protected_until') || protectedCoreKeys.has(key)) return;
        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      });
    }

    // Prevent a damaged/stale Supabase instance from immediately overwriting restored local data.
    localStorage.setItem(this.STORAGE_PREFIX + 'restore_protected_until', String(Date.now() + 60 * 60 * 1000));
    this.isSupabaseActive = false;

    return {
      products: parsed.products.length,
      orders: parsed.orders.length,
      paymentHistory: parsed.paymentHistory.length,
      embeddedImages: Object.keys(parsed.embeddedAssets || {}).length,
      failedImages: Array.isArray(parsed.failedImages) ? parsed.failedImages.length : 0
    };
  }

  static extractLengthFromOrder(order: { type: string; color?: string; product_name?: string; productName?: string; quantity?: any; totalPrice?: any; unitPrice?: any; items?: any[] }): number {
    if (order.type !== 'dtf') {
      return Number(order.quantity) || 1;
    }
    // Attempt 1: Sum from order.items if present
    if (order.items && Array.isArray(order.items) && order.items.length > 0) {
      const dtfItems = order.items.filter((it: any) => it.type === 'dtf');
      if (dtfItems.length > 0) {
        const sum = dtfItems.reduce((acc: number, it: any) => acc + (Number(it.quantity) || 0), 0);
        if (sum > 0) return Number(sum.toFixed(2));
      }
    }
    // Attempt 2: Extract from color (e.g., "Độ dài 46.50m" or "Đoạn 46.50m (SL:1)")
    const colorStr = order.color || '';
    const colorMatch = colorStr.match(/(?:Độ dài|Đoạn)\s*([\d.]+)\s*m/i);
    if (colorMatch) {
      const parsed = parseFloat(colorMatch[1]);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
    // Attempt 3: Extract from product_name / productName (e.g., "In PET phim (46.50m)")
    const prodStr = order.product_name || order.productName || '';
    const prodMatch = prodStr.match(/In PET phim\s*\(([\d.]+)\s*m\)/i);
    if (prodMatch) {
      const parsed = parseFloat(prodMatch[1]);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
    // Attempt 4: If quantity is 1 but we can deduce it from totalPrice and unitPrice
    const quantityVal = Number(order.quantity) || 1;
    if (quantityVal === 1 && order.unitPrice > 0 && order.totalPrice > order.unitPrice) {
      const calcQty = order.totalPrice / order.unitPrice;
      if (!isNaN(calcQty) && calcQty > 0) {
        return Number(calcQty.toFixed(2));
      }
    }
    return quantityVal;
  }

  static parseOrderImagesArray(val: any): string[] {
    if (!val) return [];
    if (Array.isArray(val)) return val.filter(Boolean);
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && Array.isArray(parsed.images)) {
            return parsed.images.filter(Boolean);
          }
        } catch (e) {}
      }
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return parsed.filter(Boolean);
        } catch (e) {
          // not a valid JSON array
        }
      }
      if (trimmed.includes(',')) {
        return trimmed.split(',').map(s => s.trim()).filter(Boolean);
      }
      return [trimmed].filter(Boolean);
    }
    return [];
  }

  static parseOrderNotes(val: any): string {
    if (!val || typeof val !== 'string') return '';
    const trimmed = val.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed.notes === 'string') {
          return parsed.notes;
        }
      } catch (e) {}
    }
    return '';
  }

  static parseOrderSurcharge(val: any): number {
    if (!val || typeof val !== 'string') return 0;
    const trimmed = val.trim();
    if (trimmed.startsWith('{')) {
      try {
        const surcharge = Number(JSON.parse(trimmed)?.surcharge);
        return Number.isFinite(surcharge) && surcharge > 0 ? surcharge : 0;
      } catch (e) {}
    }
    return 0;
  }

  static async syncAllDataFromSupabase(): Promise<boolean> {
    if (this.isRestoreProtectionActive()) {
      console.warn('Supabase sync skipped because restored data is temporarily protected.');
      return false;
    }
    try {
      const isOnline = await this.checkSupabaseConnection();
      if (!isOnline) return false;

      // Fetch products from Supabase
      const { data: dbProducts, error: prodError } = await supabase
        .from('products')
        .select('*');

      if (prodError) {
        console.warn('Cannot fetch products from Supabase:', prodError.message);
      } else if (dbProducts && dbProducts.length > 0) {
        const mappedProducts: Product[] = dbProducts
          .filter(p => !SUPPRESSED_LEGACY_PRODUCT_IDS.has(String(p.id)))
          .map(p => {
          const isLegacyDeleted = p.source === '__deleted__';
          const createdAt = p.created_at || new Date().toISOString();
          return {
            id: p.id,
            name: p.name,
            image: p.image || p.image_url || '',
            color: p.color || '',
            size: p.size || undefined,
            stock: p.stock ?? 0,
            importPrice: p.import_price ?? p.importPrice ?? 0,
            salePrice: p.sale_price ?? p.salePrice ?? 0,
            source: isLegacyDeleted ? 'self_produced' : (p.source || 'self_produced'),
            createdAt,
            updatedAt: p.updated_at || p.updatedAt || createdAt,
            deletedAt: p.deleted_at || p.deletedAt || (isLegacyDeleted ? createdAt : null),
            syncVersion: Number(p.sync_version ?? p.syncVersion ?? 1)
          };
          });
        const mergedProducts = this.mergeProductsByUpdatedAt(mappedProducts, this.getProducts());
        this.saveLocalBackup('products', this.getProducts());
        this.saveProducts(mergedProducts);
      }

      // Fetch orders from Supabase
      const { data: dbOrders, error: orderError } = await supabase
        .from('orders')
        .select('*');

      if (orderError) {
        console.warn('Cannot fetch orders from Supabase:', orderError.message);
      } else if (dbOrders) {
        // Fetch order items to reconstruct orders perfectly
        const { data: dbItems } = await supabase.from('order_items').select('*');
        const itemsGroupedByOrder = new Map<string, any[]>();
        if (dbItems) {
          dbItems.forEach(item => {
            const mappedItem = {
              id: item.id,
              type: item.type,
              productName: item.product_name,
              color: item.color || 'Mặc định',
              size: item.size || undefined,
              quantity: item.quantity,
              unitPrice: item.unit_price,
              totalPrice: item.total_price,
              image: item.image || undefined
            };
            if (!itemsGroupedByOrder.has(item.order_id)) {
              itemsGroupedByOrder.set(item.order_id, []);
            }
            itemsGroupedByOrder.get(item.order_id)!.push(mappedItem);
          });
        }

        const mappedOrders: Order[] = dbOrders
          .filter(o => !SUPPRESSED_LEGACY_ORDER_IDS.has(String(o.id)))
          .map(o => {
          const type = o.type;
          const items = itemsGroupedByOrder.get(o.id) || undefined;
          const rawQty = o.quantity ?? 1;
          const qty = type === 'dtf' ? this.extractLengthFromOrder({
            type,
            color: o.color || '',
            product_name: o.product_name || o.productName || '',
            quantity: rawQty,
            totalPrice: o.total_price ?? o.totalPrice ?? 0,
            unitPrice: o.unit_price ?? o.unitPrice ?? 0,
            items
          }) : rawQty;

          return {
            id: o.id,
            orderCode: o.order_code || o.orderCode || '',
            customerName: o.customer_name || o.customerName || '',
            type: o.type,
            productName: o.product_name || o.productName || '',
            color: o.color || '',
            quantity: qty,
            unitPrice: o.unit_price ?? o.unitPrice ?? 0,
            totalPrice: o.total_price ?? o.totalPrice ?? 0,
            paidAmount: o.paid_amount ?? o.paidAmount ?? 0,
            debtAmount: o.debt_amount ?? o.debtAmount ?? 0,
            status: o.status || 'pending',
            createdAt: o.created_at || new Date().toISOString(),
            orderImages: this.parseOrderImagesArray(o.order_images || o.orderImages),
            items,
            notes: this.parseOrderNotes(o.order_images || o.orderImages) || o.notes || o.note || '',
            surcharge: this.parseOrderSurcharge(o.order_images || o.orderImages)
          };
        });
        const localOrders = this.getOrders();
        const localOrdersById = new Map(localOrders.map(order => [order.id, order]));
        const protectedRemoteOrders = mappedOrders.map(order => {
          const localOrder = localOrdersById.get(order.id);
          if (!localOrder) return order;
          return {
            ...order,
            items: order.items?.length ? order.items : localOrder.items,
            orderImages: order.orderImages?.length ? order.orderImages : localOrder.orderImages,
            notes: order.notes || localOrder.notes,
            surcharge: order.surcharge || localOrder.surcharge
          };
        });
        const mergedOrders = this.mergeById(protectedRemoteOrders, localOrders)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        this.saveOrders(mergedOrders);
      }

      // Fetch payment_history from Supabase
      const { data: dbPayments, error: payError } = await supabase
        .from('payment_history')
        .select('*');

      if (payError) {
        console.warn('Cannot fetch payment history from Supabase:', payError.message);
      } else if (dbPayments) {
        const mappedPayments: PaymentHistory[] = dbPayments.map(p => ({
          id: p.id,
          customerName: p.customer_name || '',
          type: (p.type || 'dtf') as OrderType,
          customerId: p.customer_id || undefined,
          amount: Number(p.amount) || 0,
          paymentMethod: p.payment_method || '',
          createdAt: p.created_at || new Date().toISOString()
        }));
        const mergedPayments = this.mergeById(mappedPayments, this.getPaymentHistory())
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        this.savePaymentHistory(mergedPayments);
      }

      // Fetch customers to sync PIN codes from Supabase
      try {
        const { data: dbCustomers, error: custError } = await supabase
          .from('customers')
          .select('*');
        if (custError) {
          console.warn('Cannot fetch customers from Supabase:', custError.message);
        } else if (dbCustomers) {
          const pinsRecord: Record<string, string> = { ...this.getCustomerPins() };
          dbCustomers.forEach(c => {
            const name = c.name || c.customer_name;
            const type = c.type;
            const pinCode = c.pin_code;
            if (name && type && pinCode) {
              pinsRecord[`${name}_${type}`] = pinCode;
            }
          });
          this.saveCustomerPins(pinsRecord);
        }
      } catch (e) {
        console.warn('Failed to sync customers table from Supabase:', e);
      }

      return true;
    } catch (err) {
      console.warn('Failed to sync data from Supabase:', err);
      return false;
    }
  }

  // --- PRODUCTS MANAGEMENT ---
  static getProducts(): Product[] {
    const raw = localStorage.getItem(this.STORAGE_PREFIX + 'products');
    if (!raw) {
      return [];
    }
    return (JSON.parse(raw) as Product[])
      .filter(product => !SUPPRESSED_LEGACY_PRODUCT_IDS.has(String(product.id)))
      .map(product => ({
        ...this.normalizeProduct(product)
      }));
  }

  static async addProduct(product: Omit<Product, 'id' | 'createdAt'>): Promise<Product> {
    const now = new Date().toISOString();
    const newProduct: Product = {
      ...product,
      id: 'p_' + Math.random().toString(36).substr(2, 9),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      syncVersion: 1
    };

    if (this.isSupabaseActive) {
      try {
        await this.insertProductPayload(newProduct);
      } catch (err: any) {
        console.error('Supabase product initial sync failed:', err);
        throw err;
      }
    }

    const products = this.getProducts();
    products.unshift(newProduct);
    this.saveProducts(products);

    return newProduct;
  }

  static async updateProductStock(id: string, newStock: number, throwOnRemoteError: boolean = false): Promise<void> {
    const products = this.getProducts();
    const idx = products.findIndex(p => p.id === id);
    let updatedProduct: Product | undefined;
    if (idx !== -1) {
      const now = new Date().toISOString();
      products[idx] = {
        ...products[idx],
        stock: newStock,
        updatedAt: now,
        syncVersion: Number(products[idx].syncVersion || 1) + 1
      };
      updatedProduct = products[idx];
      this.saveProducts(products);
    }

    if (this.isSupabaseActive) {
      try {
        const { data: existing } = await supabase.from('products').select('id').eq('id', id).maybeSingle();
        if (!existing) {
          const localProd = updatedProduct || products.find(p => p.id === id);
          if (localProd) {
            await this.insertProductPayload(localProd);
          }
        } else {
          if (updatedProduct) {
            await this.updateProductPayload(id, updatedProduct, { stock: newStock });
          }
        }
      } catch (err) {
        console.error('Supabase stock update failed:', err);
        if (throwOnRemoteError) throw err;
      }
    }
  }

  static async updateProduct(id: string, updatedFields: Partial<Product>): Promise<void> {
    const products = this.getProducts();
    const idx = products.findIndex(p => p.id === id);
    const now = new Date().toISOString();
    const nextProduct = idx !== -1 ? {
      ...products[idx],
      ...updatedFields,
      updatedAt: now,
      syncVersion: Number(products[idx].syncVersion || 1) + 1
    } : undefined;

    if (this.isSupabaseActive) {
      try {
        const { data: existing } = await supabase.from('products').select('id').eq('id', id).maybeSingle();
        if (!existing) {
          if (nextProduct) {
            await this.insertProductPayload(nextProduct);
          } else {
            console.warn('Local product not found for update-insert ID:', id);
          }
        } else {
          if (nextProduct) {
            await this.updateProductPayload(id, nextProduct, updatedFields);
          }
        }
      } catch (err) {
        console.error('Supabase product update failed:', err);
        throw err;
      }
    }

    if (idx !== -1) {
      products[idx] = nextProduct!;
      this.saveProducts(products);
    }
  }

  static async deleteProduct(id: string): Promise<void> {
    const products = this.getProducts();
    const idx = products.findIndex(p => p.id === id);
    if (idx === -1) return;

    const now = new Date().toISOString();
    const deletedProduct: Product = {
      ...products[idx],
      stock: 0,
      deletedAt: now,
      updatedAt: now,
      syncVersion: Number(products[idx].syncVersion || 1) + 1
    };

    if (this.isSupabaseActive) {
      try {
        const { data: existing } = await supabase.from('products').select('id').eq('id', id).maybeSingle();
        if (existing) {
          await this.updateProductPayload(id, deletedProduct, { stock: 0, deletedAt: now, updatedAt: now, syncVersion: deletedProduct.syncVersion });
        } else {
          await this.insertProductPayload(deletedProduct);
        }
      } catch (err) {
        console.error('Supabase product soft delete failed:', err);
        throw err;
      }
    }

    products[idx] = deletedProduct;
    this.saveProducts(products);
  }

  static async clearLocalProductCacheAndReloadFromSupabase(): Promise<boolean> {
    localStorage.removeItem(this.STORAGE_PREFIX + 'products');
    return this.syncAllDataFromSupabase();
  }

  // --- ORDERS MANAGEMENT ---
  static getOrders(): Order[] {
    const raw = localStorage.getItem(this.STORAGE_PREFIX + 'orders');
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as Order[];
      return parsed
        .filter(o => !SUPPRESSED_LEGACY_ORDER_IDS.has(String(o.id)))
        .map(o => {
        const qty = o.type === 'dtf' ? this.extractLengthFromOrder(o) : o.quantity;
        return {
          ...o,
          quantity: qty,
          orderImages: this.parseOrderImagesArray(o.orderImages).map(image => this.resolveBackupAsset(image) || image),
          items: o.items?.map(item => ({
            ...item,
            image: this.resolveBackupAsset(item.image),
            extraImages: item.extraImages?.map(image => this.resolveBackupAsset(image) || image)
          }))
        };
      });
    } catch (e) {
      console.error('Error parsing orders from LocalStorage:', e);
      return [];
    }
  }

  static getPaymentHistory(): PaymentHistory[] {
    const raw = localStorage.getItem(this.STORAGE_PREFIX + 'payment_history');
    if (!raw) {
      return [];
    }
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error('Error parsing payment history:', e);
      return [];
    }
  }

  private static savePaymentHistory(payments: PaymentHistory[]): void {
    const previous = localStorage.getItem(this.STORAGE_PREFIX + 'payment_history');
    if (previous) {
      try {
        this.saveLocalBackup('payment_history', JSON.parse(previous));
      } catch {
        this.saveLocalBackup('payment_history', previous);
      }
    }
    localStorage.setItem(this.STORAGE_PREFIX + 'payment_history', JSON.stringify(payments));
  }

  static getCustomerPins(): Record<string, string> {
    const raw = localStorage.getItem(this.STORAGE_PREFIX + 'customer_pins');
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  static saveCustomerPins(pins: Record<string, string>): void {
    const previous = localStorage.getItem(this.STORAGE_PREFIX + 'customer_pins');
    if (previous) {
      try {
        this.saveLocalBackup('customer_pins', JSON.parse(previous));
      } catch {
        this.saveLocalBackup('customer_pins', previous);
      }
    }
    localStorage.setItem(this.STORAGE_PREFIX + 'customer_pins', JSON.stringify(pins));
  }

  private static getDtfPriceKey(customerName: string): string {
    return customerName.trim().toLocaleLowerCase('vi-VN');
  }

  static getDtfPricesForCustomer(customerName: string): number[] {
    if (!customerName.trim()) return [];

    const raw = localStorage.getItem(this.STORAGE_PREFIX + 'dtf_customer_prices');
    let savedPrices: Record<string, number[]> = {};
    try {
      savedPrices = raw ? JSON.parse(raw) : {};
    } catch {
      savedPrices = {};
    }

    const key = this.getDtfPriceKey(customerName);
    const historicalPrices = this.getOrders()
      .filter(order =>
        order.customerName.trim().toLocaleLowerCase('vi-VN') === key &&
        (order.type === 'dtf' || order.type === 'mixed')
      )
      .flatMap(order => {
        const itemPrices = order.items
          ?.filter(item => item.type === 'dtf')
          .map(item => Number(item.unitPrice)) || [];
        return itemPrices.length > 0 ? itemPrices : [Number(order.unitPrice)];
      });

    return Array.from(new Set([...(savedPrices[key] || []), ...historicalPrices]))
      .filter(price => Number.isFinite(price) && price > 0)
      .sort((a, b) => a - b);
  }

  static saveDtfPriceForCustomer(customerName: string, price: number): number[] {
    const trimmedName = customerName.trim();
    const normalizedPrice = Math.round(Number(price));
    if (!trimmedName || !Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
      throw new Error('Tên khách hàng và đơn giá PET phải hợp lệ.');
    }

    const storageKey = this.STORAGE_PREFIX + 'dtf_customer_prices';
    let savedPrices: Record<string, number[]> = {};
    try {
      const raw = localStorage.getItem(storageKey);
      savedPrices = raw ? JSON.parse(raw) : {};
    } catch {
      savedPrices = {};
    }

    const key = this.getDtfPriceKey(trimmedName);
    savedPrices[key] = Array.from(new Set([...(savedPrices[key] || []), normalizedPrice]))
      .filter(savedPrice => Number.isFinite(savedPrice) && savedPrice > 0)
      .sort((a, b) => a - b);
    localStorage.setItem(storageKey, JSON.stringify(savedPrices));

    return this.getDtfPricesForCustomer(trimmedName);
  }

  static async addOrder(order: Omit<Order, 'id' | 'orderCode'> & { createdAt?: string }): Promise<Order> {
    const randomCode = Math.floor(1000 + Math.random() * 9000);
    const prefix = order.type === 'dtf' ? 'ORD-DTF-' : 'ORD-TS-';
    const qty = order.type === 'dtf' ? this.extractLengthFromOrder(order) : order.quantity;
    const newOrder: Order = {
      ...order,
      quantity: qty,
      id: 'o_' + Math.random().toString(36).substr(2, 9),
      orderCode: `${prefix}${randomCode}`,
      createdAt: order.createdAt || new Date().toISOString()
    } as Order;

    // Persist locally first so slow or unavailable remote services never block invoicing.
    const orders = this.getOrders();
    orders.unshift(newOrder);
    this.saveOrders(orders);

    // Best-effort sync to Supabase.
    if (this.isSupabaseActive) {
      void (async () => {
      const payload: any = {
        id: newOrder.id,
        order_code: newOrder.orderCode,
        customer_name: newOrder.customerName,
        type: newOrder.type,
        product_name: newOrder.productName,
        color: (newOrder.color || '').replace(/\(Phân khúc nhập sỉ\)/gi, '').trim(),
        quantity: newOrder.quantity,
        unit_price: newOrder.unitPrice,
        total_price: newOrder.totalPrice,
        paid_amount: newOrder.paidAmount,
        debt_amount: newOrder.debtAmount,
        status: newOrder.status,
        created_at: newOrder.createdAt
      };

      // Embed both notes and orderImages under order_images column to avoid schema limitations
      payload.order_images = JSON.stringify({
        images: newOrder.orderImages || [],
        notes: newOrder.notes || '',
        surcharge: newOrder.surcharge || 0
      });

      try {
        const { error } = await supabase.from('orders').insert([payload]);
        if (error) {
          console.warn('Supabase order sync failed, retrying with raw payload stripped of order_images', error.message);
          if (error.message?.includes('type integer') || error.message?.includes('invalid input syntax')) {
            localStorage.setItem('supabase_migration_needed', 'true');
            window.dispatchEvent(new Event('supabase_sync_error'));
          }
          const retryPayload = { ...payload };
          delete retryPayload.order_images;
          const { error: retryErr } = await supabase.from('orders').insert([retryPayload]);
          if (retryErr) {
            if (retryErr.message?.includes('type integer') || retryErr.message?.includes('invalid input syntax')) {
              localStorage.setItem('supabase_migration_needed', 'true');
              window.dispatchEvent(new Event('supabase_sync_error'));
            }
            throw retryErr;
          }
        }

        if (newOrder.items && newOrder.items.length > 0) {
          await this.syncOrderItems(newOrder.id, newOrder.items);
        }
      } catch (err: any) {
        console.error('Supabase order initial sync failed:', err);
      }
      })();
    }

    // Adjust product stock based on items in cart or single order
    if (order.items && order.items.length > 0) {
      const products = this.getProducts();
      for (const item of order.items) {
        if (item.type === 'tshirt') {
          const prd = products.find(p => {
            if (item.productId) return p.id === item.productId;
            const sizeMatches = p.size === item.size;
            const nameMatches = p.name === item.productName || `${p.name} - Màu: ${p.color}` === item.productName;
            const colorMatches = p.color === item.color || item.color.includes(p.color);
            return nameMatches && colorMatches && sizeMatches;
          });
          if (prd) {
            void this.updateProductStock(prd.id, Math.max(0, prd.stock - item.quantity));
          }
        }
      }
    } else if (order.type === 'tshirt') {
      const products = this.getProducts();
      // Match exactly by name AND color + size
      let item = products.find(p => {
        const colorAndSize = `${p.color} - Size ${p.size || 'N/A'}`;
        return order.productName === p.name && order.color === colorAndSize;
      });
      if (!item) {
        // Fallback for older formats or customized titles
        item = products.find(p => p.name === order.productName || p.name + ' - ' + p.color === order.productName);
      }
      if (item) {
        void this.updateProductStock(item.id, Math.max(0, item.stock - order.quantity));
      }
    }

    return newOrder;
  }

  static async syncOrderItems(orderId: string, items: any[]): Promise<void> {
    const itemPayloads = items.map(item => ({
      id: item.id || 'item_' + Math.random().toString(36).substr(2, 9),
      order_id: orderId,
      type: item.type,
      product_name: item.productName,
      color: (item.color || 'Mặc định').replace(/\(Phân khúc nhập sỉ\)/gi, '').trim(),
      size: item.size || null,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      total_price: item.totalPrice,
      image: item.image || null
    }));

    try {
      const { error } = await supabase.from('order_items').insert(itemPayloads);
      if (error) {
        console.warn('Supabase bulk order_items sync warning (trying individual sync chunks):', error.message);
        if (error.message?.includes('type integer') || error.message?.includes('invalid input syntax')) {
          localStorage.setItem('supabase_migration_needed', 'true');
          window.dispatchEvent(new Event('supabase_sync_error'));
        }
        // Try inserting items individually so schema issues don't crash
        for (const payload of itemPayloads) {
          const { error: itemErr } = await supabase.from('order_items').insert([payload]);
          if (itemErr) {
            if (itemErr.message?.includes('type integer') || itemErr.message?.includes('invalid input syntax')) {
              localStorage.setItem('supabase_migration_needed', 'true');
              window.dispatchEvent(new Event('supabase_sync_error'));
            }
            throw itemErr;
          }
        }
      }
    } catch (err) {
      console.error('Supabase order_items sync failed:', err);
      throw err;
    }
  }

  static async updateOrderPayment(id: string, additionalPay: number, status?: 'pending' | 'completed'): Promise<Order | null> {
    const orders = this.getOrders();
    const idx = orders.findIndex(o => o.id === id);
    if (idx === -1) return null;

    const o = { ...orders[idx] };
    o.paidAmount = Math.min(o.totalPrice, o.paidAmount + additionalPay);
    o.debtAmount = o.totalPrice - o.paidAmount;
    if (status) {
      o.status = status;
    } else if (o.debtAmount === 0) {
      o.status = 'completed';
    }

    if (this.isSupabaseActive) {
      try {
        const { error } = await supabase
          .from('orders')
          .update({
            paid_amount: o.paidAmount,
            debt_amount: o.debtAmount,
            status: o.status
          })
          .eq('id', id);
        if (error) throw error;
      } catch (err: any) {
        console.error('Supabase order payment update failed:', err?.message || err);
        throw err;
      }
    }

    orders[idx] = o;
    this.saveOrders(orders);
    return o;
  }

  static async updateOrder(id: string, updatedFields: Partial<Order>): Promise<void> {
    const orders = this.getOrders();
    const idx = orders.findIndex(o => o.id === id);
    if (idx === -1) return;

    let correctQty = updatedFields.quantity;
    if (orders[idx].type === 'dtf') {
      const merged = { ...orders[idx], ...updatedFields };
      correctQty = this.extractLengthFromOrder(merged);
      updatedFields.quantity = correctQty;
    }

    const payload: any = {};
    if (updatedFields.customerName !== undefined) payload.customer_name = updatedFields.customerName;
    if (updatedFields.type !== undefined) payload.type = updatedFields.type;
    if (updatedFields.productName !== undefined) payload.product_name = updatedFields.productName;
    if (updatedFields.color !== undefined) payload.color = updatedFields.color;
    if (updatedFields.quantity !== undefined) payload.quantity = updatedFields.quantity;
    if (updatedFields.unitPrice !== undefined) payload.unit_price = updatedFields.unitPrice;
    if (updatedFields.totalPrice !== undefined) payload.total_price = updatedFields.totalPrice;
    if (updatedFields.paidAmount !== undefined) payload.paid_amount = updatedFields.paidAmount;
    if (updatedFields.debtAmount !== undefined) payload.debt_amount = updatedFields.debtAmount;
    if (updatedFields.status !== undefined) payload.status = updatedFields.status;
    if (updatedFields.createdAt !== undefined) payload.created_at = updatedFields.createdAt;

    const existingOrder = orders[idx];
    if (existingOrder.type === 'tshirt' && updatedFields.items) {
      const products = this.getProducts();
      const findProductId = (item: OrderItem) => {
        if (item.productId && products.some(product => product.id === item.productId)) return item.productId;
        const itemSize = item.size || item.color.match(/Size\s+([^-]+)/i)?.[1]?.trim();
        return products.find(product =>
          product.name === item.productName &&
          product.size === itemSize &&
          (product.color === item.color || item.color.includes(product.color))
        )?.id;
      };
      const oldQuantities = new Map<string, number>();
      const newQuantities = new Map<string, number>();
      const oldItems = existingOrder.items?.length ? existingOrder.items : [{
        id: `legacy_${existingOrder.id}`,
        type: 'tshirt' as const,
        productName: existingOrder.productName,
        color: existingOrder.color,
        quantity: existingOrder.quantity,
        unitPrice: existingOrder.unitPrice,
        totalPrice: existingOrder.totalPrice
      }];
      oldItems.forEach(item => {
        const productId = findProductId(item);
        if (productId) oldQuantities.set(productId, (oldQuantities.get(productId) || 0) + item.quantity);
      });
      updatedFields.items.forEach(item => {
        const productId = findProductId(item);
        if (productId) {
          item.productId = productId;
          newQuantities.set(productId, (newQuantities.get(productId) || 0) + item.quantity);
        }
      });
      for (const productId of new Set([...oldQuantities.keys(), ...newQuantities.keys()])) {
        const product = products.find(item => item.id === productId);
        if (!product) continue;
        const nextStock = product.stock + (oldQuantities.get(productId) || 0) - (newQuantities.get(productId) || 0);
        if (nextStock < 0) throw new Error(`Số lượng cập nhật vượt tồn kho của ${product.name} - Size ${product.size}.`);
        await this.updateProductStock(productId, nextStock);
      }
    }
    const notesToSave = updatedFields.notes !== undefined ? updatedFields.notes : (existingOrder.notes || '');
    const imagesToSave = updatedFields.orderImages !== undefined ? updatedFields.orderImages : (existingOrder.orderImages || []);

    payload.order_images = JSON.stringify({
      images: Array.isArray(imagesToSave) ? imagesToSave : [imagesToSave],
      notes: notesToSave,
      surcharge: updatedFields.surcharge !== undefined ? updatedFields.surcharge : (existingOrder.surcharge || 0)
    });

    if (this.isSupabaseActive) {
      try {
        // 1. Update orders table
        const { error: orderError } = await supabase
          .from('orders')
          .update(payload)
          .eq('id', id);

        if (orderError) {
          console.error('Supabase order update failed:', orderError.message);
          if (orderError.message?.includes('type integer') || orderError.message?.includes('invalid input syntax')) {
            localStorage.setItem('supabase_migration_needed', 'true');
            window.dispatchEvent(new Event('supabase_sync_error'));
          }
          // Retry without order_images just in case
          const retryPayload = { ...payload };
          delete retryPayload.order_images;
          const { error: retryErr } = await supabase.from('orders').update(retryPayload).eq('id', id);
          if (retryErr) {
            if (retryErr.message?.includes('type integer') || retryErr.message?.includes('invalid input syntax')) {
              localStorage.setItem('supabase_migration_needed', 'true');
              window.dispatchEvent(new Event('supabase_sync_error'));
            }
            throw retryErr;
          }
        }

        // 2. Re-sync order_items table representation
        if (updatedFields.items !== undefined) {
          await supabase.from('order_items').delete().eq('order_id', id);
          if (updatedFields.items.length > 0) await this.syncOrderItems(id, updatedFields.items);
        } else if (updatedFields.unitPrice !== undefined || updatedFields.quantity !== undefined || updatedFields.productName !== undefined || updatedFields.color !== undefined) {
          // Delete old items
          await supabase.from('order_items').delete().eq('order_id', id);

          // Get items from updated state
          const targetItem = { ...(orders[idx].items?.[0] || {}) };
          targetItem.unitPrice = updatedFields.unitPrice !== undefined ? updatedFields.unitPrice : targetItem.unitPrice;
          targetItem.quantity = updatedFields.quantity !== undefined ? updatedFields.quantity : targetItem.quantity;
          targetItem.totalPrice = updatedFields.totalPrice !== undefined ? updatedFields.totalPrice : Number(((targetItem.quantity || 0) * (targetItem.unitPrice || 0)).toFixed(0));
          if (updatedFields.productName !== undefined) targetItem.productName = updatedFields.productName;
          if (updatedFields.color !== undefined) targetItem.color = updatedFields.color;

          if (targetItem.productName) {
            const itemPayload = {
              id: targetItem.id || 'itm_' + Math.random().toString(36).substring(2, 11),
              order_id: id,
              type: targetItem.type || orders[idx].type,
              product_name: targetItem.productName,
              color: (targetItem.color || 'Mặc định').replace(/\(Phân khúc nhập sỉ\)/gi, '').trim(),
              size: targetItem.size || null,
              quantity: targetItem.quantity,
              unit_price: targetItem.unitPrice,
              total_price: targetItem.totalPrice,
              image: targetItem.image || null
            };
            const { error: itemError } = await supabase.from('order_items').insert([itemPayload]);
            if (itemError) {
              console.error('Supabase order_items insert failed in updateOrder:', itemError.message);
              if (itemError.message?.includes('type integer') || itemError.message?.includes('invalid input syntax')) {
                localStorage.setItem('supabase_migration_needed', 'true');
                window.dispatchEvent(new Event('supabase_sync_error'));
              }
              throw itemError;
            }
          }
        }
      } catch (err: any) {
        console.error('Error in updateOrder Supabase sync:', err?.message || err);
        throw err;
      }
    }

    const existingItems = orders[idx].items || [];
    if (updatedFields.items !== undefined) {
      orders[idx].items = updatedFields.items;
    } else if (existingItems.length > 0) {
      existingItems[0].unitPrice = updatedFields.unitPrice !== undefined ? updatedFields.unitPrice : existingItems[0].unitPrice;
      existingItems[0].quantity = updatedFields.quantity !== undefined ? updatedFields.quantity : existingItems[0].quantity;
      existingItems[0].totalPrice = updatedFields.totalPrice !== undefined ? updatedFields.totalPrice : Number((existingItems[0].quantity * existingItems[0].unitPrice).toFixed(0));
      if (updatedFields.productName !== undefined) existingItems[0].productName = updatedFields.productName;
      if (updatedFields.color !== undefined) existingItems[0].color = updatedFields.color;
      orders[idx].items = [existingItems[0]];
    }

    orders[idx] = { ...orders[idx], ...updatedFields };
    this.saveOrders(orders);
  }

  static async deleteOrder(id: string): Promise<void> {
    const orders = this.getOrders();
    const orderToDelete = orders.find(order => order.id === id);
    if (!orderToDelete) return;

    // Return every T-shirt in the deleted invoice to its exact inventory variant.
    const tshirtItems = orderToDelete.items?.filter(item => item.type === 'tshirt') || [];
    const stockBeforeRestore = new Map<string, number>();
    if (tshirtItems.length > 0 || orderToDelete.type === 'tshirt') {
      const products = this.getProducts();
      const quantitiesToReturn = new Map<string, number>();
      const normalize = (value: string | undefined) => (value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      const findProduct = (item: OrderItem) => {
        if (item.productId) {
          const exactProduct = products.find(product => product.id === item.productId);
          if (exactProduct) return exactProduct;
        }
        const itemSize = item.size || item.color.match(/Size\s+([^-]+)/i)?.[1]?.trim();
        const normalizedItemName = normalize(item.productName);
        const normalizedItemColor = normalize(item.color.split(/\s*-\s*Size/i)[0]);
        const exactMatches = products.filter(product =>
          normalize(product.name) === normalizedItemName &&
          normalize(product.size) === normalize(itemSize) &&
          normalize(product.color) === normalizedItemColor
        );
        if (exactMatches.length === 1) return exactMatches[0];

        const compatibleMatches = products.filter(product =>
          normalize(product.name) === normalizedItemName &&
          (!itemSize || normalize(product.size) === normalize(itemSize)) &&
          (!normalizedItemColor || normalize(product.color) === normalizedItemColor)
        );
        if (compatibleMatches.length === 1) return compatibleMatches[0];

        // Older order items may contain a generic product name, but color + size still identify the variant.
        const uniqueVariantMatches = products.filter(product =>
          Boolean(itemSize) &&
          normalize(product.size) === normalize(itemSize) &&
          Boolean(normalizedItemColor) &&
          normalize(product.color) === normalizedItemColor
        );
        return uniqueVariantMatches.length === 1 ? uniqueVariantMatches[0] : undefined;
      };

      if (tshirtItems.length > 0) {
        tshirtItems.forEach(item => {
          const product = findProduct(item);
          const quantity = Number(item.quantity) || 0;
          if (quantity <= 0) return;
          if (!product) throw new Error(`Không tìm thấy mẫu áo trong kho để hoàn trả: ${item.productName} - ${item.color}. Hóa đơn chưa bị xóa.`);
          quantitiesToReturn.set(product.id, (quantitiesToReturn.get(product.id) || 0) + quantity);
        });
      } else {
        const legacyItem: OrderItem = {
          id: `legacy_${orderToDelete.id}`,
          type: 'tshirt',
          productName: orderToDelete.productName,
          color: orderToDelete.color,
          quantity: orderToDelete.quantity,
          unitPrice: orderToDelete.unitPrice,
          totalPrice: orderToDelete.totalPrice
        };
        const product = findProduct(legacyItem) || products.find(item =>
          item.name === orderToDelete.productName ||
          `${item.name} - ${item.color}` === orderToDelete.productName
        );
        if (product && orderToDelete.quantity > 0) {
          quantitiesToReturn.set(product.id, orderToDelete.quantity);
        } else {
          throw new Error(`Không tìm thấy mẫu áo trong kho để hoàn trả cho hóa đơn ${orderToDelete.orderCode}. Hóa đơn chưa bị xóa.`);
        }
      }

      try {
        for (const [productId, quantity] of quantitiesToReturn) {
          const product = products.find(item => item.id === productId);
          if (!product) throw new Error(`Không tìm thấy mã kho ${productId}. Hóa đơn chưa bị xóa.`);
          stockBeforeRestore.set(productId, product.stock);
          await this.updateProductStock(productId, product.stock + quantity, true);
        }
      } catch (error) {
        for (const [productId, previousStock] of stockBeforeRestore) {
          await this.updateProductStock(productId, previousStock);
        }
        throw error;
      }
    }

    if (this.isSupabaseActive) {
      try {
        const { error: itemsError } = await supabase.from('order_items').delete().eq('order_id', id);
        if (itemsError) throw itemsError;
        const { error: orderError } = await supabase.from('orders').delete().eq('id', id);
        if (orderError) throw orderError;
      } catch (err) {
        console.error('Supabase order delete failed:', err);
        for (const [productId, previousStock] of stockBeforeRestore) {
          await this.updateProductStock(productId, previousStock);
        }
        throw err;
      }
    }

    const filtered = orders.filter(o => o.id !== id);
    this.saveOrders(filtered);
  }

  static async updateCustomer(
    oldName: string,
    type: OrderType,
    newName: string,
    newTotalSpent?: number,
    newTotalPaid?: number,
    newPinCode?: string | null
  ): Promise<void> {
    const orders = this.getOrders();
    if (newName.trim() && newName.trim() !== oldName) {
      orders.forEach(o => {
        if (o.customerName === oldName && o.type === type) {
          o.customerName = newName.trim();
        }
      });
    }

    const currentName = newName.trim() || oldName;

    // PIN code handling
    const pins = this.getCustomerPins();
    let pinToSave = newPinCode;
    if (pinToSave === undefined) {
      pinToSave = pins[`${oldName}_${type}`] || null;
    }

    if (newName.trim() && newName.trim() !== oldName) {
      delete pins[`${oldName}_${type}`];
    }

    if (pinToSave) {
      pins[`${currentName}_${type}`] = pinToSave;
    } else {
      delete pins[`${currentName}_${type}`];
    }

    if (newTotalSpent !== undefined) {
      const customerOrders = orders.filter(o => o.customerName === currentName && o.type === type);
      if (customerOrders.length > 0) {
        const oldTotalSpent = customerOrders.reduce((sum, o) => sum + o.totalPrice, 0);
        if (oldTotalSpent > 0 && newTotalSpent !== oldTotalSpent) {
          const scale = newTotalSpent / oldTotalSpent;
          let distributed = 0;
          customerOrders.forEach((o, idx) => {
            if (idx === customerOrders.length - 1) {
              o.totalPrice = Math.round(newTotalSpent - distributed);
            } else {
              o.totalPrice = Math.round(o.totalPrice * scale);
              distributed += o.totalPrice;
            }
            o.debtAmount = Math.max(0, o.totalPrice - o.paidAmount);
            o.status = o.debtAmount === 0 ? 'completed' : 'pending';
          });
        } else if (oldTotalSpent === 0 && newTotalSpent > 0) {
          customerOrders[0].totalPrice = newTotalSpent;
          customerOrders[0].debtAmount = Math.max(0, newTotalSpent - customerOrders[0].paidAmount);
          customerOrders[0].status = customerOrders[0].debtAmount === 0 ? 'completed' : 'pending';
        }
      }
    }

    if (newTotalPaid !== undefined) {
      const customerOrders = orders.filter(o => o.customerName === currentName && o.type === type);
      if (customerOrders.length > 0) {
        customerOrders.forEach(o => {
          o.paidAmount = 0;
          o.debtAmount = o.totalPrice;
          o.status = o.debtAmount === 0 ? 'completed' : 'pending';
        });

        let remainingPaid = newTotalPaid;
        const sortedOrders = [...customerOrders].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        for (const order of sortedOrders) {
          if (remainingPaid <= 0) break;
          const toPay = Math.min(order.totalPrice, remainingPaid);
          order.paidAmount = toPay;
          order.debtAmount = Math.max(0, order.totalPrice - toPay);
          order.status = order.debtAmount === 0 ? 'completed' : 'pending';
          remainingPaid -= toPay;
        }

        if (remainingPaid > 0) {
          const newest = sortedOrders[sortedOrders.length - 1];
          newest.paidAmount += remainingPaid;
          newest.debtAmount = Math.max(0, newest.totalPrice - newest.paidAmount);
          newest.status = newest.debtAmount === 0 ? 'completed' : 'pending';
        }
      }
    }

    if (this.isSupabaseActive) {
      try {
        const customerOrders = orders.filter(o => o.customerName === currentName && o.type === type);
        for (const o of customerOrders) {
          const { error } = await supabase.from('orders').update({
            customer_name: o.customerName,
            total_price: o.totalPrice,
            paid_amount: o.paidAmount,
            debt_amount: o.debtAmount,
            status: o.status
          }).eq('id', o.id);
          if (error) throw error;
        }

        // Sync customer PIN to Supabase customers table
        const customerId = `c_${type}_` + btoa(encodeURIComponent(currentName)).replace(/=/g, '');
        const oldCustomerId = `c_${type}_` + btoa(encodeURIComponent(oldName)).replace(/=/g, '');

        if (newName.trim() && newName.trim() !== oldName) {
          const { error: delErr } = await supabase.from('customers').delete().eq('id', oldCustomerId);
          if (delErr) console.warn('Supabase customer delete failed:', delErr.message);
        }

        const { error: upsertErr } = await supabase.from('customers').upsert({
          id: customerId,
          name: currentName,
          type: type,
          pin_code: pinToSave || null
        });
        if (upsertErr) throw upsertErr;

      } catch (err: any) {
        console.error('Supabase customer or related orders updates failed:', err?.message || err);
        throw err;
      }
    }

    this.saveOrders(orders);
    this.saveCustomerPins(pins);
  }

  static async deleteCustomer(customerName: string, type: OrderType): Promise<void> {
    if (this.isSupabaseActive) {
      const customerId = `c_${type}_` + btoa(encodeURIComponent(customerName)).replace(/=/g, '');
      try {
        const { error: deleteOrdersErr } = await supabase.from('orders').delete().eq('customer_name', customerName).eq('type', type);
        if (deleteOrdersErr) throw deleteOrdersErr;
        const { error: deleteCustErr } = await supabase.from('customers').delete().eq('id', customerId);
        if (deleteCustErr) throw deleteCustErr;
      } catch (err) {
        console.error('Supabase customer delete failed:', err);
        throw err;
      }
    }

    const orders = this.getOrders();
    const filtered = orders.filter(o => o.customerName !== customerName || o.type !== type);
    this.saveOrders(filtered);

    // Clean up local PINs
    const pins = this.getCustomerPins();
    delete pins[`${customerName}_${type}`];
    this.saveCustomerPins(pins);
  }

  // --- CUSTOMER CALCULATIONS & DEBTS (Calculated in real-time derived from actual orders) ---
  static getCustomers(filterType?: 'dtf' | 'tshirt'): Customer[] {
    const orders = this.getOrders();
    const customersMap = new Map<string, Customer>();
    const pins = this.getCustomerPins();

    orders.forEach(order => {
      if (filterType && order.type !== filterType) return;

      const key = `${order.customerName}_${order.type}`;
      if (!customersMap.has(key)) {
        customersMap.set(key, {
          id: `c_${order.type}_` + btoa(encodeURIComponent(order.customerName)).replace(/=/g, ''),
          name: order.customerName,
          type: order.type,
          productsTaken: [],
          totalSpent: 0,
          paidAmount: 0,
          debtAmount: 0,
          updatedAt: order.createdAt
        });
      }

      const client = customersMap.get(key)!;
      const productSummary = getOrderProductSummary(order);
      if (!client.productsTaken.includes(productSummary)) {
        client.productsTaken.push(productSummary);
      }
      client.totalSpent += order.totalPrice;
      client.paidAmount += order.paidAmount;
      client.debtAmount = client.totalSpent - client.paidAmount;
      if (new Date(order.createdAt) > new Date(client.updatedAt)) {
        client.updatedAt = order.createdAt;
      }
    });

    const list = Array.from(customersMap.values());
    list.forEach(client => {
      client.pinCode = pins[`${client.name}_${client.type}`] || null;
    });

    return list;
  }

  // Helper to record payment directly from customer card
  static async recordCustomerPayment(customerName: string, type: OrderType, amount: number, paymentMethod: string): Promise<void> {
    // 1. Record the transaction inside payment_history (insert in local state and push to database)
    const uuid = typeof crypto !== 'undefined' && crypto.randomUUID 
      ? crypto.randomUUID() 
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) { 
          const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8); 
          return v.toString(16); 
        });

    const newPayment: PaymentHistory = {
      id: uuid,
      customerName,
      type,
      customerId: `c_${type}_` + btoa(encodeURIComponent(customerName)).replace(/=/g, ''),
      amount,
      paymentMethod: paymentMethod || 'Mặc định',
      createdAt: new Date().toISOString()
    };

    if (this.isSupabaseActive) {
      const payload = {
        id: newPayment.id,
        customer_name: newPayment.customerName,
        type: newPayment.type,
        customer_id: newPayment.customerId,
        amount: newPayment.amount,
        payment_method: newPayment.paymentMethod,
        created_at: newPayment.createdAt
      };
      
      try {
        const { error } = await supabase.from('payment_history').insert([payload]);
        if (error) {
          console.error('Supabase payment_history insert failed:', error.message);
          throw error;
        }
      } catch (err) {
        console.error('Supabase payment history initial sync failed:', err);
        throw err;
      }
    }

    const payments = this.getPaymentHistory();
    payments.unshift(newPayment);
    this.savePaymentHistory(payments);

    // 2. FIFO Allocation to unpaid/debt orders
    const orders = this.getOrders();
    let remainingAmount = amount;

    // Apply payments to customer's unpaid/debt orders starting from oldest to newest
    const customerOrders = orders
      .filter(o => o.customerName === customerName && o.type === type && o.debtAmount > 0)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (const order of customerOrders) {
      if (remainingAmount <= 0) break;
      const paymentToApply = Math.min(order.debtAmount, remainingAmount);
      
      order.paidAmount = Math.min(order.totalPrice, order.paidAmount + paymentToApply);
      order.debtAmount = order.totalPrice - order.paidAmount;
      order.status = order.paidAmount >= order.totalPrice ? 'completed' : 'pending';
      remainingAmount -= paymentToApply;

      if (this.isSupabaseActive) {
        try {
          const { error } = await supabase.from('orders')
            .update({
              paid_amount: order.paidAmount,
              debt_amount: order.debtAmount,
              status: order.status
            })
            .eq('id', order.id);
          if (error) throw error;
        } catch (err) {
          console.error('Supabase FIFO order update failed:', err);
          throw err;
        }
      }
    }

    this.saveOrders(orders);
  }

  // Undo payment / recalculate FIFO
  static async deletePaymentAndRecalculate(paymentId: string, customerName: string, type: OrderType): Promise<void> {
    // 3.1: Delete record from local state payment_history
    let payments = this.getPaymentHistory();
    payments = payments.filter(p => p.id !== paymentId);
    this.savePaymentHistory(payments);

    // Sync deletion to Supabase
    if (this.isSupabaseActive) {
      try {
        const { error } = await supabase.from('payment_history').delete().eq('id', paymentId);
        if (error) console.error('Supabase delete from payment_history failed:', error.message);
      } catch (err) {
        console.error('Failed to post delete payment_history to Supabase:', err);
      }
    }

    // 3.2: Get sum of remaining payment history records for this customer
    const newTotalPaid = payments
      .filter(p => p.customerName === customerName && p.type === type)
      .reduce((sum, p) => sum + p.amount, 0);

    // 3.3: Reset ALL orders of the customer for this specific type to paid_amount = 0 and status = 'pending'
    const orders = this.getOrders();
    const customerOrders = orders.filter(o => o.customerName === customerName && o.type === type);

    for (const order of customerOrders) {
      order.paidAmount = 0;
      order.debtAmount = order.totalPrice;
      order.status = 'pending';
    }

    // 3.4: Re-allocate old ones first (FIFO) using newTotalPaid
    let remainingAmount = newTotalPaid;
    const sortedOrders = [...customerOrders].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (const order of sortedOrders) {
      if (remainingAmount <= 0) {
        order.paidAmount = 0;
        order.debtAmount = order.totalPrice;
        order.status = 'pending';
        continue;
      }
      const paymentToApply = Math.min(order.totalPrice, remainingAmount);
      order.paidAmount = paymentToApply;
      order.debtAmount = order.totalPrice - paymentToApply;
      order.status = order.paidAmount >= order.totalPrice ? 'completed' : 'pending';
      remainingAmount -= paymentToApply;
    }

    // Save orders state locally
    this.saveOrders(orders);

    // Push updated orders to Supabase
    if (this.isSupabaseActive) {
      try {
        await Promise.all(
          customerOrders.map(async (order) => {
            return supabase.from('orders')
              .update({
                paid_amount: order.paidAmount,
                debt_amount: order.debtAmount,
                status: order.status
              })
              .eq('id', order.id);
          })
        );
      } catch (err) {
        console.error('Failed to update orders after recalculation:', err);
      }
    }
  }

  // --- STATS CALCULATION ---
  static getDashboardStats(): DashboardStats {
    const orders = this.getOrders();
    const products = this.getProducts();

    let totalRevenue = 0;
    let totalPaid = 0;
    let totalDebtUrl = 0;
    let dtfRevenue = 0;
    let dtfDebt = 0;
    let tshirtRevenue = 0;
    let tshirtDebt = 0;
    let completedOrdersCount = 0;

    orders.forEach(o => {
      totalRevenue += o.totalPrice;
      totalPaid += o.paidAmount;
      totalDebtUrl += o.debtAmount;

      if (o.type === 'dtf') {
        dtfRevenue += o.totalPrice;
        dtfDebt += o.debtAmount;
      } else {
        tshirtRevenue += o.totalPrice;
        tshirtDebt += o.debtAmount;
      }

      if (o.status === 'completed') {
        completedOrdersCount++;
      }
    });

    const lowStockCount = products.filter(p => p.stock <= 10).length;

    return {
      totalRevenue,
      totalPaid,
      totalDebtUrl,
      dtfRevenue,
      dtfDebt,
      tshirtRevenue,
      tshirtDebt,
      completedOrdersCount,
      lowStockCount
    };
  }

  // --- CUSTOMER TRACKING LINKS ---
  static getTrackingIdForCustomer(customerName: string, type: OrderType): string {
    const input = `${customerName}_${type}_xuongin-petshirt-secure-salt-2026`;
    let ch = 0;
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < input.length; i++) {
      ch = input.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
    const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
    
    let h3 = 0xabcdef01, h4 = 0x76543210;
    for (let i = input.length - 1; i >= 0; i--) {
      ch = input.charCodeAt(i) + 17;
      h3 = Math.imul(h3 ^ ch, 2654435761);
      h4 = Math.imul(h4 ^ ch, 1597334677);
    }
    h3 = Math.imul(h3 ^ (h3 >>> 16), 2246822507) ^ Math.imul(h4 ^ (h4 >>> 13), 3266489909);
    h4 = Math.imul(h4 ^ (h4 >>> 16), 2246822507) ^ Math.imul(h3 ^ (h3 >>> 13), 3266489909);
    const hex3 = (h3 >>> 0).toString(16).padStart(8, '0');
    const hex4 = (h4 >>> 0).toString(16).padStart(8, '0');
    
    // Format: 8-4-4-4-12 to perfectly match UUID shape
    const formatted = `${hex1}-${hex2.slice(0, 4)}-${hex2.slice(4, 8)}-${hex3.slice(0, 4)}-${hex3.slice(4, 8)}${hex4}`;
    return formatted;
  }

  static getTrackingSlugForCustomer(customerName: string, type: OrderType): string {
    const baseSlug = customerName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
    
    const suffix = type === 'tshirt' ? '-ao' : '';
    return baseSlug + suffix;
  }

  static getCustomerByTrackingId(trackingId: string): Customer | null {
    const customers = this.getCustomers();
    const normalizedId = trackingId.toLowerCase().trim();
    
    // 0. Support matching by direct unique customer ID (e.g. c_tshirt_..., c_dtf_...)
    const matchedById = customers.find(c => c.id.toLowerCase() === normalizedId || c.id === trackingId);
    if (matchedById) return matchedById;

    const stripAndNormalize = (str: string): string => {
      return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, 'd')
        .replace(/[^a-z0-9]/g, '');
    };

    const targetStripped = stripAndNormalize(normalizedId);
    if (!targetStripped) return null;

    // Detect if target has a specific suffix indicating the type
    const isTshirtTarget = targetStripped.endsWith('ao') || targetStripped.endsWith('tshirt');
    const isDtfTarget = targetStripped.endsWith('dtf');

    // 1. If has type suffix, try to find matching customer where c.type corresponds to that suffix
    if (isTshirtTarget) {
      const nameWithoutSuffix = targetStripped.endsWith('tshirt') 
        ? targetStripped.slice(0, -6) 
        : targetStripped.slice(0, -2);
      const matched = customers.find(c => c.type === 'tshirt' && stripAndNormalize(c.name) === nameWithoutSuffix);
      if (matched) return matched;
    } else if (isDtfTarget) {
      const nameWithoutSuffix = targetStripped.slice(0, -3);
      const matched = customers.find(c => c.type === 'dtf' && stripAndNormalize(c.name) === nameWithoutSuffix);
      if (matched) return matched;
    }

    // 2. Direct match with stripped customer name (e.g. trangcn2 matches Trang cn 2)
    let matched = customers.find(c => stripAndNormalize(c.name) === targetStripped);
    if (matched) return matched;

    // 3. Direct match with stripped customer name + type suffix (matching "-ao", "-dtf", "-tshirt")
    matched = customers.find(c => {
      const nameStripped = stripAndNormalize(c.name);
      if (c.type === 'dtf') {
        return nameStripped + 'dtf' === targetStripped;
      } else if (c.type === 'tshirt') {
        return nameStripped + 'ao' === targetStripped || nameStripped + 'tshirt' === targetStripped;
      }
      return nameStripped === targetStripped ||
             nameStripped + 'dtf' === targetStripped ||
             nameStripped + 'ao' === targetStripped ||
             nameStripped + 'tshirt' === targetStripped;
    });
    if (matched) return matched;

    // 4. Fallback to full or short UUID matching
    return customers.find(c => {
      const full = this.getTrackingIdForCustomer(c.name, c.type).toLowerCase();
      const shortId = full.split('-')[0];
      return full === normalizedId || shortId === normalizedId;
    }) || null;
  }

  static getOrdersForCustomer(customerName: string, type: OrderType): Order[] {
    return this.getOrders().filter(o => o.customerName === customerName && o.type === type);
  }
}
