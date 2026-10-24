import { createClient } from '@supabase/supabase-js';
import { Product, Order, OrderItem, Customer, DashboardStats, OrderType, PaymentHistory, TemporaryBill } from '../types';
import { getOrderProductSummary } from '../utils/orderSummary';
import {
  commitNewReceipt, commitNewReversal,
  getPendingFinanceOperation as readPendingFinance,
  retryPendingFinanceOperation as retryPendingFinanceRpc,
  validateVnd
} from './accountingOperations';
import {
  queueOrderForSync, getPendingOrders, confirmOrderSync,
  noteOrderSyncError, matchesRecordedOrder, validateOrderAmounts
} from './orderOutbox';

const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL || 'https://ykbsykqqdjqgnpslemsw.supabase.co';
const SUPABASE_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrYnN5a3FxZGpxZ25wc2xlbXN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MTM0ODUsImV4cCI6MjA5NTA4OTQ4NX0.UY-W_jJYWcJrsT4_D-XQmVdfWy4UXWEXsfF-WBMjxwk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export type DtfBackfillResult = {
  localPetOrders: number;
  missingOrders: number;
  syncedOrders: number;
  existingOrders: number;
  failedOrders: number;
  errors: string[];
};

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
  private static pendingOrderSyncWork: Promise<void> | null = null;

  static getPendingOrderSyncCount(): number {
    return getPendingOrders().length;
  }

  static getPendingOrderSyncSummary(): ReturnType<typeof getPendingOrders> {
    return getPendingOrders();
  }

  private static async flushPendingOrdersImpl(): Promise<void> {
    if (!this.isSupabaseActive) return;
    for (const entry of getPendingOrders()) {
      try {
        const localOrder = this.getOrders().find(order => order.id === entry.id);
        if (!localOrder) throw new Error('Đơn hàng chờ đồng bộ không còn trên máy.');
        if (localOrder.customerName !== entry.customerName ||
            localOrder.type !== entry.type ||
            localOrder.totalPrice !== entry.totalPrice ||
            localOrder.paidAmount !== entry.paidAmount ||
            localOrder.debtAmount !== entry.debtAmount) {
          throw new Error('Đơn cục bộ đã thay đổi sau khi đưa vào hàng đợi. Cần đối chiếu thủ công.');
        }
        validateOrderAmounts(localOrder);

        // With atomic accounting enabled, the invoice, opening balance, line items,
        // initial receipt, and allocation journal must be one database transaction.
        if ((import.meta as any).env?.VITE_ATOMIC_ACCOUNTING_ENABLED === 'true') {
          const initialPaymentId = entry.initialPaymentId || null;
          const initialPaymentMethod = entry.initialPaymentMethod || 'Thanh toán khi tạo đơn';
          if (localOrder.paidAmount > 0 && !initialPaymentId) {
            throw new Error('Đơn đang chờ có khoản trả trước nhưng thiếu mã biên nhận bền vững. Không tự tạo mã mới; cần đối soát.');
          }
          if (localOrder.paidAmount === 0 && initialPaymentId) {
            throw new Error('Đơn không có tiền trả trước nhưng hàng đợi chứa mã biên nhận. Cần đối soát.');
          }
          const legacyCustomerId = \`c_\${localOrder.type}_\` +
            btoa(encodeURIComponent(localOrder.customerName)).replace(/=/g, '');
          const orderImagesPayload = JSON.stringify({
            images: (localOrder.orderImages || []).filter(image =>
              typeof image === 'string' && !/^(data:|blob:|backup-asset:)/i.test(image)),
            notes: localOrder.notes || '',
            surcharge: localOrder.surcharge || 0,
          });
          const itemsPayload = (localOrder.items || []).map(item => ({
            id: item.id,
            type: item.type,
            product_name: item.productName,
            color: (item.color || 'Mặc định').replace(/\(Phân khúc nhập sỉ\)/gi, '').trim(),
            size: item.size || null,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            total_price: item.totalPrice,
            image: item.image && !/^(data:|blob:|backup-asset:)/i.test(item.image) ? item.image : null,
          }));
          const { data: created, error: createError } = await supabase.rpc('create_order_atomic', {
            p_order_id: localOrder.id,
            p_order_code: localOrder.orderCode,
            p_customer_name: localOrder.customerName,
            p_customer_type: localOrder.type,
            p_legacy_customer_id: legacyCustomerId,
            p_product_name: localOrder.productName,
            p_color: localOrder.color || '',
            p_quantity: localOrder.quantity,
            p_unit_price: localOrder.unitPrice,
            p_total_price: localOrder.totalPrice,
            p_paid_amount: localOrder.paidAmount,
            p_debt_amount: localOrder.debtAmount,
            p_status: localOrder.status,
            p_order_images: orderImagesPayload,
            p_created_at: localOrder.createdAt,
            p_initial_payment_id: initialPaymentId,
            p_initial_payment_method: initialPaymentMethod,
            p_items: itemsPayload,
          });
          if (createError) throw new Error('Tạo đơn nguyên tử chưa được xác nhận: ' + createError.message);
          if (created?.order_id !== localOrder.id || created?.state !== 'committed') {
            throw new Error('Phản hồi tạo đơn không khớp. Giữ nguyên hàng đợi để đối soát.');
          }

          const { data: confirmed, error: readbackError } = await supabase
            .from('orders')
            .select('id,order_code,customer_name,type,total_price,paid_amount,debt_amount')
            .eq('id', entry.id).maybeSingle();
          if (readbackError) throw readbackError;
          if (!confirmed ||
              confirmed.id !== localOrder.id ||
              confirmed.order_code !== localOrder.orderCode ||
              confirmed.customer_name !== localOrder.customerName ||
              confirmed.type !== localOrder.type ||
              Number(confirmed.total_price) !== localOrder.totalPrice ||
              Number(confirmed.paid_amount) < localOrder.paidAmount ||
              Number(confirmed.debt_amount) > localOrder.debtAmount ||
              Number(confirmed.paid_amount) + Number(confirmed.debt_amount) !== localOrder.totalPrice) {
            throw new Error('Đơn trên cloud không khớp với hóa đơn ban đầu hoặc bất biến kế toán. Không tự ghi đè.');
          }

          if (initialPaymentId) {
            const { data: receipt, error: receiptError } = await supabase
              .from('payment_history')
              .select('id,customer_id,customer_name,type,amount,payment_method,accounting_origin')
              .eq('id', initialPaymentId).maybeSingle();
            if (receiptError) throw receiptError;
            if (!receipt || receipt.customer_id !== legacyCustomerId ||
                receipt.customer_name !== localOrder.customerName ||
                receipt.type !== localOrder.type ||
                Number(receipt.amount) !== localOrder.paidAmount ||
                receipt.payment_method !== initialPaymentMethod ||
                receipt.accounting_origin !== 'initial_order_payment') {
              throw new Error('Biên nhận trả trước không khớp đơn. Giữ nguyên hàng đợi để đối soát.');
            }
            const { data: allocations, error: allocationError } = await supabase
              .from('payment_allocations').select('order_id,amount').eq('payment_id', initialPaymentId);
            if (allocationError) throw allocationError;
            const allocationTotal = (allocations || []).reduce((sum, row) => sum + Number(row.amount), 0);
            if (allocationTotal !== localOrder.paidAmount ||
                !(allocations || []).some(row => row.order_id === localOrder.id)) {
              throw new Error('Phân bổ khoản trả trước không khớp. Giữ nguyên hàng đợi để đối soát.');
            }
          }

          const { data: remoteItems, error: itemReadError } = await supabase
            .from('order_items')
            .select('id,order_id,type,product_name,color,size,quantity,unit_price,total_price')
            .eq('order_id', localOrder.id);
          if (itemReadError) throw itemReadError;
          const remoteById = new Map((remoteItems || []).map(item => [String(item.id), item]));
          if (remoteById.size !== itemsPayload.length) {
            throw new Error('Số dòng hàng trên cloud khác hóa đơn. Giữ nguyên hàng đợi để đối soát.');
          }
          for (const item of itemsPayload) {
            const remote = remoteById.get(String(item.id));
            if (!remote || remote.order_id !== localOrder.id ||
                remote.type !== item.type || remote.product_name !== item.product_name ||
                remote.color !== item.color || (remote.size || null) !== item.size ||
                Number(remote.quantity) !== item.quantity ||
                Number(remote.unit_price) !== item.unit_price ||
                Number(remote.total_price) !== item.total_price) {
              throw new Error('Chi tiết hàng trên cloud khác hóa đơn. Giữ nguyên hàng đợi để đối soát.');
            }
          }
          confirmOrderSync(entry.id);
          continue;
        }

        const { data: existing, error: lookupError } = await supabase
          .from('orders').select('*').eq('id', entry.id).maybeSingle();
        if (lookupError) throw lookupError;
        if (!existing) {
          const payload = {
            id: localOrder.id, order_code: localOrder.orderCode,
            customer_name: localOrder.customerName, type: localOrder.type,
            product_name: localOrder.productName,
            color: (localOrder.color || '').replace(/\\(Phân khúc nhập sỉ\\)/gi, '').trim(),
            quantity: localOrder.quantity, unit_price: localOrder.unitPrice,
            total_price: localOrder.totalPrice, paid_amount: localOrder.paidAmount,
            debt_amount: localOrder.debtAmount, status: localOrder.status,
            created_at: localOrder.createdAt,
            // Keep accounting metadata; avoid huge inlined base64 previews in API rows.
            order_images: JSON.stringify({
              images: (localOrder.orderImages || []).filter(image =>
                typeof image === 'string' && !/^(data:|blob:|backup-asset:)/i.test(image)),
              notes: localOrder.notes || '', surcharge: localOrder.surcharge || 0,
            }),
          };
          const { error: insertError } = await supabase.from('orders').insert([payload]);
          if (insertError && insertError.code !== '23505') throw insertError;
        }
        const { data: confirmed, error: readbackError } = await supabase
          .from('orders').select('id,customer_name,type,total_price,paid_amount,debt_amount')
          .eq('id', entry.id).maybeSingle();
        if (readbackError) throw readbackError;
        if (!confirmed || !matchesRecordedOrder(entry, confirmed)) {
          throw new Error('Cloud và máy có số tiền khác nhau; KHÔNG ghi đè. Cần đối soát.');
        }

        if (entry.itemIds.length) {
          const { data: remoteItems, error: itemReadError } = await supabase
            .from('order_items').select('id,order_id,type,product_name,quantity,unit_price,total_price')
            .eq('order_id', entry.id);
          if (itemReadError) throw itemReadError;
          const existingItems = new Map((remoteItems || []).map(item => [String(item.id), item]));
          const currentIds = new Set((localOrder.items || []).map(item => item.id));
          if (entry.itemIds.some(id => !currentIds.has(id))) {
            throw new Error('Chi tiết đơn trên máy khác lúc tạo. Cần đối soát.');
          }
          for (const item of localOrder.items || []) {
            const remote = existingItems.get(item.id);
            if (remote) {
              if (remote.order_id !== entry.id || remote.type !== item.type ||
                  remote.product_name !== item.productName ||
                  Number(remote.quantity) !== item.quantity ||
                  Number(remote.unit_price) !== item.unitPrice ||
                  Number(remote.total_price) !== item.totalPrice) {
                throw new Error('Chi tiết hóa đơn đã thay đổi trên cloud. Không tự ghi đè.');
              }
            } else {
              const { error: itemInsertError } = await supabase.from('order_items').insert([{
                id: item.id, order_id: entry.id, type: item.type,
                product_name: item.productName,
                color: (item.color || 'Mặc định').replace(/\\(Phân khúc nhập sỉ\\)/gi, '').trim(),
                size: item.size || null, quantity: item.quantity,
                unit_price: item.unitPrice, total_price: item.totalPrice,
                image: item.image && !/^(data:|blob:|backup-asset:)/i.test(item.image) ? item.image : null,
              }]);
              if (itemInsertError) throw itemInsertError;
            }
          }
        }
        confirmOrderSync(entry.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Pending order is not confirmed on cloud:', entry.id, message);
        noteOrderSyncError(entry.id, message);
      }
    }
  }

  static async flushPendingOrderSync(): Promise<void> {
    if (this.pendingOrderSyncWork) return this.pendingOrderSyncWork;
    const work = this.flushPendingOrdersImpl();
    this.pendingOrderSyncWork = work;
    try { await work; }
    finally { if (this.pendingOrderSyncWork === work) this.pendingOrderSyncWork = null; }
  }

  private static isSupabaseActive = false;
  private static backupAssetUrls = new Map<string, string>();

  static getTemporaryBills(): TemporaryBill[] {
    const raw = localStorage.getItem(this.STORAGE_PREFIX + 'temporary_bills');
    if (!raw) return [];
    try {
      return (JSON.parse(raw) as TemporaryBill[])
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (error) {
      console.error('Error parsing temporary bills:', error);
      return [];
    }
  }

  static saveTemporaryBill(input: Omit<TemporaryBill, 'id' | 'billCode'>): TemporaryBill {
    const bills = this.getTemporaryBills();
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const bill: TemporaryBill = {
      ...input,
      id: `tmp_${Date.now()}_${suffix}`,
      billCode: `TAM-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${suffix}`
    };
    localStorage.setItem(this.STORAGE_PREFIX + 'temporary_bills', JSON.stringify([bill, ...bills]));
    return bill;
  }

  static deleteTemporaryBill(id: string): void {
    const bills = this.getTemporaryBills().filter(bill => bill.id !== id);
    localStorage.setItem(this.STORAGE_PREFIX + 'temporary_bills', JSON.stringify(bills));
  }

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

  private static isPetOnlyOrder(order: Order): boolean {
    if (order.type === 'dtf') return true;
    if (order.type !== 'mixed' || !order.items?.length) return false;
    return order.items.every(item => item.type === 'dtf');
  }

  private static async backfillMissingDtfOrders(localOrders: Order[], remoteOrders: any[]): Promise<DtfBackfillResult> {
    const remoteIds = new Set(remoteOrders.map(order => String(order.id)));
    const localPetOrders = localOrders.filter(order =>
      this.isPetOnlyOrder(order) && !SUPPRESSED_LEGACY_ORDER_IDS.has(String(order.id))
    );
    const missingOrders = localPetOrders.filter(order => !remoteIds.has(String(order.id)));

    let syncedCount = 0;
    let existingCount = localPetOrders.length - missingOrders.length;
    const errors: string[] = [];
    for (const order of missingOrders) {
      // Keep the parent record deliberately small. Old local orders can contain
      // large base64 previews which make the Supabase request fail before the
      // accounting data reaches the cloud.
      const payload: any = {
        id: order.id,
        order_code: order.orderCode,
        customer_name: order.customerName,
        type: order.type,
        product_name: order.productName,
        color: (order.color || '').replace(/\(Phân khúc nhập sỉ\)/gi, '').trim(),
        quantity: order.quantity,
        unit_price: order.unitPrice,
        total_price: order.totalPrice,
        paid_amount: order.paidAmount,
        debt_amount: order.debtAmount,
        status: order.status,
        created_at: order.createdAt
      };

      try {
        const { error } = await supabase.from('orders').insert([payload]);
        if (error?.code === '23505') {
          remoteIds.add(String(order.id));
          existingCount += 1;
          continue;
        }
        if (error) throw error;

        // The parent order is already safely stored at this point. Item/image
        // failures must not turn a successful accounting sync into a false loss.
        syncedCount += 1;
        remoteIds.add(String(order.id));
        if (order.items?.length) {
          const safeItems = order.items
            .filter(item => item.type === 'dtf')
            .map(item => ({
              ...item,
              image: item.image && !/^(data:|blob:|backup-asset:)/i.test(item.image) ? item.image : undefined
            }));
          try {
            await this.syncOrderItems(order.id, safeItems);
          } catch (itemError: any) {
            console.warn('Order synced but PET line items could not be copied:', order.id, itemError);
          }
        }
      } catch (error: any) {
        console.error('Supabase DTF backlog sync failed for order:', order.id, error);
        errors.push(`${order.orderCode || order.id}: ${error?.message || 'Lỗi không xác định'}`);
      }
    }

    if (syncedCount > 0) {
      console.info(`Synced ${syncedCount} missing DTF order(s) to Supabase.`);
      window.dispatchEvent(new Event('supabase_sync_success'));
    }
    return {
      localPetOrders: localPetOrders.length,
      missingOrders: missingOrders.length,
      syncedOrders: syncedCount,
      existingOrders: existingCount,
      failedOrders: errors.length,
      errors
    };
  }

  static async inspectDtfDebtSync(): Promise<{
    localCount: number; cloudCount: number;
    missing: Array<{ id: string; code: string; customer: string; date: string; debt: number }>;
    mismatched: Array<{ id: string; code: string; customer: string; localDebt: number; cloudDebt: number }>;
    missingDebt: number;
  }> {
    if (!(await this.checkSupabaseConnection())) throw new Error('Không thể kết nối Supabase.');
    const cloudOrders = await this.fetchAllSupabaseRows('orders');
    const cloudById = new Map(cloudOrders.map(order => [String(order.id), order]));
    const local = this.getOrders().filter(order =>
      this.isPetOnlyOrder(order) && !SUPPRESSED_LEGACY_ORDER_IDS.has(String(order.id))
    );
    const missing = local.filter(order => !cloudById.has(String(order.id))).map(order => ({
      id: String(order.id), code: order.orderCode || String(order.id),
      customer: order.customerName, date: order.createdAt,
      debt: Number(order.debtAmount) || 0
    }));
    const mismatched = local.flatMap(order => {
      const remote = cloudById.get(String(order.id));
      if (!remote) return [];
      const localDebt = Number(order.debtAmount) || 0;
      const cloudDebt = Number(remote.debt_amount) || 0;
      if (localDebt === cloudDebt && Number(order.totalPrice) === Number(remote.total_price)
        && Number(order.paidAmount) === Number(remote.paid_amount)) return [];
      return [{ id: String(order.id), code: order.orderCode || String(order.id),
        customer: order.customerName, localDebt, cloudDebt }];
    });
    return {
      localCount: local.length,
      cloudCount: cloudOrders.filter(order => order.type === 'dtf').length,
      missing, mismatched,
      missingDebt: missing.reduce((sum, order) => sum + order.debt, 0)
    };
  }

  static async syncLocalDtfOrdersToSupabase(): Promise<DtfBackfillResult> {
    const isOnline = await this.checkSupabaseConnection();
    if (!isOnline) throw new Error('Không thể kết nối Supabase.');

    const audit = await this.inspectDtfDebtSync();
    if (audit.mismatched.length) throw new Error('Có đơn sai lệch tiền giữa máy và cloud. Cần kiểm tra trước khi đồng bộ.');
    const remoteOrders = await this.fetchAllSupabaseRows('orders');
    return this.backfillMissingDtfOrders(this.getOrders(), remoteOrders);
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
      // After owner-only RLS, an anonymous SELECT may return [] without error.
      // Connectivity alone must not be mistaken for permission to synchronize accounts.
      const { data: identity, error: authError } = await supabase.auth.getUser();
      if (authError || !identity.user ||
          identity.user.email?.toLowerCase() !== 'hoangkenlee@gmail.com') {
        this.isSupabaseActive = false;
        return false;
      }
      const { error } = await supabase.from('orders').select('id').limit(1);
      if (error) {
        console.warn('Supabase orders cannot be read under the owner session:', error.message);
        this.isSupabaseActive = false;
        return false;
      }
      this.isSupabaseActive = true;
      return true;
    } catch (e) {
      console.warn('Cannot confirm an authorized Supabase connection:', e);
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

  private static async fetchAllSupabaseRows(table: 'orders' | 'order_items' | 'payment_history'): Promise<any[]> {
    const pageSize = 500;
    const result: any[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from(table)
        .select('*')
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(`Failed to fetch ${table} at offset ${offset}: ${error.message}`);
      const rows = data || [];
      result.push(...rows);
      if (rows.length < pageSize) return result;
    }
  }

  static async syncAllDataFromSupabase(): Promise<boolean> {
    if (this.isRestoreProtectionActive()) {
      console.warn('Supabase sync skipped because restored data is temporarily protected.');
      return false;
    }
    try {
      const isOnline = await this.checkSupabaseConnection();
      if (!isOnline) return false;

      // Replay only locally queued NEW orders using their original immutable IDs.
      // Never push arbitrary historical local-only orders over live accounting rows.
      await this.flushPendingOrderSync();

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
      const dbOrders = await this.fetchAllSupabaseRows('orders');
      const orderError = null;

      if (orderError) {
        console.warn('Cannot fetch orders from Supabase:', orderError.message);
      } else if (dbOrders) {
        // Fetch order items to reconstruct orders perfectly
        const dbItems = await this.fetchAllSupabaseRows('order_items');
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
        // Read-only refresh: uploading local-only orders requires explicit confirmation.
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
      const dbPayments = await this.fetchAllSupabaseRows('payment_history');
      const payError = null;

      if (payError) {
        console.warn('Cannot fetch payment history from Supabase:', payError.message);
      } else if (dbPayments) {
        // Do not erase old receipts: reversals are separate, auditable entries.
        let reversals = new Map<string, string>();
        if ((import.meta as any).env?.VITE_ATOMIC_ACCOUNTING_ENABLED === 'true') {
          const { data: reverted, error: reversalError } = await supabase
            .from('payment_reversals').select('payment_id,reversed_at');
          if (reversalError) throw reversalError;
          reversals = new Map((reverted || []).map(row => [row.payment_id, row.reversed_at]));
        }
        const mappedPayments: PaymentHistory[] = dbPayments.map(p => ({
          id: p.id,
          customerName: p.customer_name || '',
          type: (p.type || 'dtf') as OrderType,
          customerId: p.customer_id || undefined,
          amount: Number(p.amount) || 0,
          paymentMethod: p.payment_method || '',
          createdAt: p.created_at || new Date().toISOString(),
          isReversed: reversals.has(p.id),
          reversedAt: reversals.get(p.id)
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
    if (!crypto?.randomUUID) throw new Error('Không thể tạo mã định danh hóa đơn an toàn.');
    const randomCode = Math.floor(1000 + Math.random() * 9000);
    const prefix = order.type === 'dtf' ? 'ORD-DTF-' : 'ORD-TS-';
    const qty = order.type === 'dtf' ? this.extractLengthFromOrder(order) : order.quantity;
    const newOrder: Order = {
      ...order, quantity: qty,
      id: 'o_' + crypto.randomUUID(),
      orderCode: `${prefix}${randomCode}`,
      createdAt: order.createdAt || new Date().toISOString(),
      items: order.items?.map(item => ({
        ...item, id: item.id || 'itm_' + crypto.randomUUID()
      })),
    } as Order;
    validateOrderAmounts(newOrder);

    // 1. Persist the exact invoice identity to the durable outbox.
    // 2. Save locally, allowing daily bookkeeping even during network outages.
    // 3. Only remove the outbox entry after remote read-back confirms its values.
    queueOrderForSync(newOrder);
    const orders = this.getOrders();
    orders.unshift(newOrder);
    this.saveOrders(orders);

    if (this.isSupabaseActive) {
      await this.flushPendingOrderSync();
    }

    // Legacy inventory stock handling is retained pending its own transactional
    // inventory migration. Do not silently turn an invoice into a duplicate.
    if (order.items && order.items.length > 0) {
      const products = this.getProducts();
      for (const item of order.items) {
        if (item.type !== 'tshirt') continue;
        const prd = products.find(p => {
          if (item.productId) return p.id === item.productId;
          const sizeMatches = p.size === item.size;
          const nameMatches = p.name === item.productName ||
            `${p.name} - Màu: ${p.color}` === item.productName;
          const colorMatches = p.color === item.color || item.color.includes(p.color);
          return nameMatches && colorMatches && sizeMatches;
        });
        if (prd) {
          void this.updateProductStock(prd.id, Math.max(0, prd.stock - item.quantity));
        }
      }
    } else if (order.type === 'tshirt') {
      const products = this.getProducts();
      let item = products.find(p => {
        const colorAndSize = `${p.color} - Size ${p.size || 'N/A'}`;
        return order.productName === p.name && order.color === colorAndSize;
      });
      if (!item) {
        item = products.find(p => p.name === order.productName ||
          p.name + ' - ' + p.color === order.productName);
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

  private static assertAtomicAccountingEnabled(): void {
    if ((import.meta as any).env?.VITE_ATOMIC_ACCOUNTING_ENABLED !== 'true') {
      throw new Error('Bản thử nghiệm chưa kích hoạt máy chủ kế toán giao dịch nguyên tử. Chưa thể ghi tiền an toàn.');
    }
    if (!this.isSupabaseActive) {
      throw new Error('Chưa có kết nối Supabase Auth của chủ sở hữu. Không ghi tiền vào sổ cục bộ khi chưa thể xác nhận cloud.');
    }
  }

  static getPendingFinance(): ReturnType<typeof readPendingFinance> {
    return readPendingFinance();
  }

  private static async refreshCommittedFinancialState(): Promise<void> {
    const success = await this.syncAllDataFromSupabase();
    if (!success) {
      throw new Error('Cloud đã xử lý giao dịch nhưng không thể tải lại số dư. KHÔNG ghi tiền lần nữa. Hãy kiểm tra đối soát.');
    }
    window.dispatchEvent(new Event('supabase_sync_success'));
  }

  static async retryPendingFinance(): Promise<boolean> {
    this.assertAtomicAccountingEnabled();
    const replayed = await retryPendingFinanceRpc(supabase);
    if (replayed) await this.refreshCommittedFinancialState();
    return replayed;
  }

  static async updateOrderPayment(id: string, additionalPay: number, _status?: 'pending' | 'completed'): Promise<Order | null> {
    this.assertAtomicAccountingEnabled();
    validateVnd(additionalPay);
    const orders = this.getOrders();
    const existing = orders.find(o => o.id === id);
    if (!existing) throw new Error('Không tìm thấy hóa đơn.');
    if (existing.type !== 'dtf' && existing.type !== 'tshirt') {
      throw new Error('Không hỗ trợ gạch nợ hóa đơn hỗn hợp khi chưa kiểm thử.');
    }
    if (additionalPay > existing.debtAmount) {
      throw new Error('Tiền thu vượt số dư hóa đơn đang hiển thị. Cần đồng bộ trước.');
    }
    const customerId = `c_${existing.type}_` +
      btoa(encodeURIComponent(existing.customerName)).replace(/=/g, '');
    await commitNewReceipt(supabase, {
      customerName: existing.customerName,
      customerType: existing.type,
      customerId, amount: additionalPay,
      method: `Gạch nợ hóa đơn ${existing.orderCode} [${existing.id}]`,
      targetOrderId: id,
    });
    await this.refreshCommittedFinancialState();
    return this.getOrders().find(o => o.id === id) || null;
  }

  static async updateOrder(id: string, updatedFields: Partial<Order>): Promise<void> {
    if (getPendingOrders().some(row => row.id === id)) {
      throw new Error('Đơn chưa đồng bộ cloud. Không sửa trước khi đối soát.');
    }
    if ((import.meta as any).env?.VITE_ATOMIC_ACCOUNTING_ENABLED === 'true') {
      if (!this.isSupabaseActive) {
        throw new Error('Không thể sửa đơn khi chưa xác thực và đồng bộ cloud.');
      }
      const existing = this.getOrders().find(row => row.id === id);
      if (existing && (
        (updatedFields.totalPrice !== undefined && updatedFields.totalPrice !== existing.totalPrice) ||
        (updatedFields.paidAmount !== undefined && updatedFields.paidAmount !== existing.paidAmount) ||
        (updatedFields.debtAmount !== undefined && updatedFields.debtAmount !== existing.debtAmount)
      )) {
        throw new Error('Bản bảo mật chưa hỗ trợ điều chỉnh số tiền đơn đã ghi. Cần bút toán điều chỉnh nguyên tử, không sửa số dư trực tiếp.');
      }
    }
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
    if (getPendingOrders().some(row => row.id === id)) {
      throw new Error('Không thể xóa đơn đang chờ đồng bộ. Cần đối soát trước.');
    }
    if ((import.meta as any).env?.VITE_ATOMIC_ACCOUNTING_ENABLED === 'true') {
      throw new Error('Không xóa hóa đơn khi chưa có quy trình hủy/đảo bút toán an toàn.');
    }
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

  // Receipt allocation and history are committed together on the database.
  // No local paid/debt mutation is permitted until RPC confirms the commit.
  static async recordCustomerPayment(customerName: string, type: OrderType, amount: number, paymentMethod: string): Promise<void> {
    this.assertAtomicAccountingEnabled();
    validateVnd(amount);
    if (type !== 'dtf' && type !== 'tshirt') {
      throw new Error('Chưa hỗ trợ thu tiền loại đơn hỗn hợp.');
    }
    const customerId = `c_${type}_` +
      btoa(encodeURIComponent(customerName)).replace(/=/g, '');
    await commitNewReceipt(supabase, {
      customerName, customerType: type, customerId,
      amount, method: paymentMethod || 'Mặc định',
    });
    await this.refreshCommittedFinancialState();
  }

  // A reversal may only touch allocations created by the new atomic system.
  // Historical receipt amounts MUST NOT be used to reset all paid invoices.
  static async deletePaymentAndRecalculate(paymentId: string, _customerName: string, _type: OrderType): Promise<void> {
    this.assertAtomicAccountingEnabled();
    // Legacy receipts have no allocation journal; do NOT create a pending
    // reversal ID for an operation the server must correctly reject.
    const { data: journaled, error } = await supabase.from('payment_allocations')
      .select('payment_id').eq('payment_id', paymentId).limit(1);
    if (error) throw error;
    if (!journaled?.length) {
      throw new Error('Khoản thu lịch sử chưa có bút toán phân bổ. Không thể hoàn tác tự động an toàn.');
    }
    await commitNewReversal(supabase, paymentId);
    await this.refreshCommittedFinancialState();
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
