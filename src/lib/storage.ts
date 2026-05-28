import { createClient } from '@supabase/supabase-js';
import { Product, Order, Customer, DashboardStats, OrderType, PaymentHistory } from '../types';

const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL || 'https://ykbsykqqdjqgnpslemsw.supabase.co';
const SUPABASE_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrYnN5a3FxZGpxZ25wc2xlbXN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MTM0ODUsImV4cCI6MjA5NTA4OTQ4NX0.UY-W_jJYWcJrsT4_D-XQmVdfWy4UXWEXsfF-WBMjxwk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Define Mock Data to make the app look stunning and professional immediately
const MOCK_PRODUCTS: Product[] = [
  {
    id: 'p1_m',
    name: 'Áo thun Cotton Premium 100%',
    image: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=300&auto=format&fit=crop&q=60&ixlib=rb-4.0.3',
    color: 'Đen (Black)',
    size: 'M',
    stock: 65,
    importPrice: 45000,
    salePrice: 95000,
    source: 'self_produced',
    createdAt: '2026-05-15T08:00:00Z'
  },
  {
    id: 'p1_l',
    name: 'Áo thun Cotton Premium 100%',
    image: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=300&auto=format&fit=crop&q=60&ixlib=rb-4.0.3',
    color: 'Đen (Black)',
    size: 'L',
    stock: 87,
    importPrice: 45000,
    salePrice: 95000,
    source: 'self_produced',
    createdAt: '2026-05-15T08:00:00Z'
  },
  {
    id: 'p1_xl',
    name: 'Áo thun Cotton Premium 100%',
    image: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=300&auto=format&fit=crop&q=60&ixlib=rb-4.0.3',
    color: 'Đen (Black)',
    size: 'XL',
    stock: 12,
    importPrice: 45000,
    salePrice: 95000,
    source: 'self_produced',
    createdAt: '2026-05-15T08:00:00Z'
  },
  {
    id: 'p2_m',
    name: 'Áo Polo Basic Slimfit',
    image: 'https://images.unsplash.com/photo-1581655353564-df123a1eb820?w=300&auto=format&fit=crop&q=60&ixlib=rb-4.0.3',
    color: 'Xanh Navy (Navy Blue)',
    size: 'M',
    stock: 45,
    importPrice: 62000,
    salePrice: 125000,
    source: 'external',
    createdAt: '2026-05-16T09:30:00Z'
  },
  {
    id: 'p2_l',
    name: 'Áo Polo Basic Slimfit',
    image: 'https://images.unsplash.com/photo-1581655353564-df123a1eb820?w=300&auto=format&fit=crop&q=60&ixlib=rb-4.0.3',
    color: 'Xanh Navy (Navy Blue)',
    size: 'L',
    stock: 35,
    importPrice: 62000,
    salePrice: 125000,
    source: 'external',
    createdAt: '2026-05-16T09:30:00Z'
  },
  {
    id: 'p3_l',
    name: 'Áo Oversize Streetwear Heavyweight',
    image: 'https://images.unsplash.com/photo-1562157873-818bc0726f68?w=300&auto=format&fit=crop&q=60&ixlib=rb-4.0.3',
    color: 'Trắng (White)',
    size: 'L',
    stock: 8,
    importPrice: 55000,
    salePrice: 110000,
    source: 'self_produced',
    createdAt: '2026-05-18T14:15:00Z'
  },
  {
    id: 'p3_xl',
    name: 'Áo Oversize Streetwear Heavyweight',
    image: 'https://images.unsplash.com/photo-1562157873-818bc0726f68?w=300&auto=format&fit=crop&q=60&ixlib=rb-4.0.3',
    color: 'Trắng (White)',
    size: 'XL',
    stock: 15,
    importPrice: 55000,
    salePrice: 110000,
    source: 'self_produced',
    createdAt: '2026-05-18T14:15:00Z'
  },
  {
    id: 'p4_m',
    name: 'Áo thun Raglan Sporty',
    image: 'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=300&auto=format&fit=crop&q=60&ixlib=rb-4.0.3',
    color: 'Xám Phối Đỏ',
    size: 'M',
    stock: 25,
    importPrice: 48000,
    salePrice: 98000,
    source: 'external',
    createdAt: '2026-05-20T10:00:00Z'
  },
  {
    id: 'p4_l',
    name: 'Áo thun Raglan Sporty',
    image: 'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=300&auto=format&fit=crop&q=60&ixlib=rb-4.0.3',
    color: 'Xám Phối Đỏ',
    size: 'L',
    stock: 20,
    importPrice: 48000,
    salePrice: 98000,
    source: 'external',
    createdAt: '2026-05-20T10:00:00Z'
  }
];

const MOCK_ORDERS: Order[] = [
  {
    id: 'o1',
    orderCode: 'ORD-DTF-001',
    customerName: 'In Ấn Hoàng Nam',
    type: 'dtf',
    productName: 'Cuộn Pet DTF Khổ 60cm x 100m',
    color: 'Chuyển sắc',
    quantity: 4,
    unitPrice: 150000,
    totalPrice: 600000,
    paidAmount: 400000,
    debtAmount: 200000,
    status: 'completed',
    createdAt: '2026-05-19T08:30:00Z'
  },
  {
    id: 'o2',
    orderCode: 'ORD-TS-002',
    customerName: 'Đồng Phục Phương Vy',
    type: 'tshirt',
    productName: 'Áo thun Cotton Premium 100% - Đen (Black)',
    color: 'Đen (Black)',
    quantity: 50,
    unitPrice: 95000,
    totalPrice: 4750000,
    paidAmount: 4750000,
    debtAmount: 0,
    status: 'completed',
    createdAt: '2026-05-20T11:15:00Z'
  },
  {
    id: 'o3',
    orderCode: 'ORD-DTF-003',
    customerName: 'Xưởng In Ấn Minh Anh',
    type: 'dtf',
    productName: 'Hình In Pet Áo Đọc Thêm 30x30cm',
    color: 'Nhiều màu',
    quantity: 120,
    unitPrice: 25000,
    totalPrice: 3000000,
    paidAmount: 1800000,
    debtAmount: 1200000,
    status: 'pending',
    createdAt: '2026-05-21T15:40:00Z'
  },
  {
    id: 'o4',
    orderCode: 'ORD-TS-004',
    customerName: 'Local Brand Hades Studio',
    type: 'tshirt',
    productName: 'Áo Oversize Streetwear Heavyweight - Trắng (White)',
    color: 'Trắng (White)',
    quantity: 20,
    unitPrice: 110000,
    totalPrice: 2200000,
    paidAmount: 1000000,
    debtAmount: 1200000,
    status: 'pending',
    createdAt: '2026-05-22T09:00:00Z'
  },
  {
    id: 'o5',
    orderCode: 'ORD-DTF-005',
    customerName: 'Quảng Cáo Đại Nam',
    type: 'dtf',
    productName: 'Pet DTF Logo Thương Hiệu Nhỏ',
    color: 'Vàng Kim',
    quantity: 500,
    unitPrice: 3000,
    totalPrice: 1500000,
    paidAmount: 1500000,
    debtAmount: 0,
    status: 'completed',
    createdAt: '2026-05-22T16:20:00Z'
  },
  {
    id: 'o6',
    orderCode: 'ORD-TS-006',
    customerName: 'Đồng Phục Shop Ánh Dương',
    type: 'tshirt',
    productName: 'Áo Polo Basic Slimfit - Xanh Navy',
    color: 'Xanh Navy (Navy Blue)',
    quantity: 15,
    unitPrice: 125000,
    totalPrice: 1875000,
    paidAmount: 1000000,
    debtAmount: 875000,
    status: 'pending',
    createdAt: '2026-05-23T05:10:00Z'
  }
];

export class StorageManager {
  private static STORAGE_PREFIX = 'petshirt_admin_';
  private static isSupabaseActive = false;

  private static saveOrders(orders: Order[]): void {
    const key = this.STORAGE_PREFIX + 'orders';
    try {
      // Omit rawFile references from local state to ensure localStorage doesn't serialize empty objects
      const sanitized = orders.map(o => ({
        ...o,
        items: o.items?.map(it => {
          const { rawFile, ...rest } = it as any;
          return rest;
        })
      }));
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
          
          // If still fails, severe truncation keeping only latest 50 orders
          if (pruned.length > 50) {
            const cut = pruned.slice(0, 50);
            try {
              localStorage.setItem(key, JSON.stringify(cut));
              console.log('Truncated orders list to 50 most recent due to severe browser storage limitations.');
              return;
            } catch (truncErr) {
              console.error('Truncation failed to write:', truncErr);
            }
          }
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

  static async syncAllDataFromSupabase(): Promise<boolean> {
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
        const mappedProducts: Product[] = dbProducts.map(p => ({
          id: p.id,
          name: p.name,
          image: p.image || p.image_url || '',
          color: p.color || '',
          size: p.size || undefined,
          stock: p.stock ?? 0,
          importPrice: p.import_price ?? p.importPrice ?? 0,
          salePrice: p.sale_price ?? p.salePrice ?? 0,
          source: p.source || 'self_produced',
          createdAt: p.created_at || new Date().toISOString()
        }));
        localStorage.setItem(this.STORAGE_PREFIX + 'products', JSON.stringify(mappedProducts));
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

        const mappedOrders: Order[] = dbOrders.map(o => {
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
            notes: this.parseOrderNotes(o.order_images || o.orderImages) || o.notes || o.note || ''
          };
        });
        localStorage.setItem(this.STORAGE_PREFIX + 'orders', JSON.stringify(mappedOrders));
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
        localStorage.setItem(this.STORAGE_PREFIX + 'payment_history', JSON.stringify(mappedPayments));
      }

      // Fetch customers to sync PIN codes from Supabase
      try {
        const { data: dbCustomers, error: custError } = await supabase
          .from('customers')
          .select('*');
        if (custError) {
          console.warn('Cannot fetch customers from Supabase:', custError.message);
        } else if (dbCustomers) {
          const pinsRecord: Record<string, string> = {};
          dbCustomers.forEach(c => {
            const name = c.name || c.customer_name;
            const type = c.type;
            const pinCode = c.pin_code;
            if (name && type && pinCode) {
              pinsRecord[`${name}_${type}`] = pinCode;
            }
          });
          localStorage.setItem(this.STORAGE_PREFIX + 'customer_pins', JSON.stringify(pinsRecord));
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
      localStorage.setItem(this.STORAGE_PREFIX + 'products', JSON.stringify(MOCK_PRODUCTS));
      return MOCK_PRODUCTS;
    }
    return JSON.parse(raw);
  }

  static async addProduct(product: Omit<Product, 'id' | 'createdAt'>): Promise<Product> {
    const newProduct: Product = {
      ...product,
      id: 'p_' + Math.random().toString(36).substr(2, 9),
      createdAt: new Date().toISOString()
    };

    if (this.isSupabaseActive) {
      const payload: any = {
        id: newProduct.id,
        name: newProduct.name,
        image: newProduct.image,
        color: newProduct.color,
        stock: newProduct.stock,
        import_price: newProduct.importPrice,
        sale_price: newProduct.salePrice,
        source: newProduct.source,
        created_at: newProduct.createdAt
      };
      
      if (newProduct.size) {
        payload.size = newProduct.size;
      }

      try {
        const { error } = await supabase.from('products').insert([payload]);
        if (error) {
          console.warn('Supabase product sync failed (retrying without size):', error.message);
          if (payload.size) {
            delete payload.size;
            const { error: retryErr } = await supabase.from('products').insert([payload]);
            if (retryErr) throw retryErr;
          } else {
            throw error;
          }
        }
      } catch (err: any) {
        console.error('Supabase product initial sync failed:', err);
        throw err;
      }
    }

    const products = this.getProducts();
    products.unshift(newProduct);
    localStorage.setItem(this.STORAGE_PREFIX + 'products', JSON.stringify(products));

    return newProduct;
  }

  static async updateProductStock(id: string, newStock: number): Promise<void> {
    if (this.isSupabaseActive) {
      try {
        const { error } = await supabase
          .from('products')
          .update({ stock: newStock })
          .eq('id', id);
        if (error) throw error;
      } catch (err) {
        console.error('Supabase stock update failed:', err);
        throw err;
      }
    }

    const products = this.getProducts();
    const idx = products.findIndex(p => p.id === id);
    if (idx !== -1) {
      products[idx].stock = newStock;
      localStorage.setItem(this.STORAGE_PREFIX + 'products', JSON.stringify(products));
    }
  }

  static async updateProduct(id: string, updatedFields: Partial<Product>): Promise<void> {
    if (this.isSupabaseActive) {
      const payload: any = {};
      if (updatedFields.name !== undefined) payload.name = updatedFields.name;
      if (updatedFields.color !== undefined) payload.color = updatedFields.color;
      if (updatedFields.size !== undefined) payload.size = updatedFields.size;
      if (updatedFields.stock !== undefined) payload.stock = updatedFields.stock;
      if (updatedFields.importPrice !== undefined) payload.import_price = updatedFields.importPrice;
      if (updatedFields.salePrice !== undefined) payload.sale_price = updatedFields.salePrice;
      if (updatedFields.source !== undefined) payload.source = updatedFields.source;
      if (updatedFields.image !== undefined) payload.image = updatedFields.image;

      try {
        const { error } = await supabase.from('products').update(payload).eq('id', id);
        if (error) throw error;
      } catch (err) {
        console.error('Supabase product update failed:', err);
        throw err;
      }
    }

    const products = this.getProducts();
    const idx = products.findIndex(p => p.id === id);
    if (idx !== -1) {
      products[idx] = { ...products[idx], ...updatedFields };
      localStorage.setItem(this.STORAGE_PREFIX + 'products', JSON.stringify(products));
    }
  }

  static async deleteProduct(id: string): Promise<void> {
    if (this.isSupabaseActive) {
      try {
        const { error } = await supabase.from('products').delete().eq('id', id);
        if (error) throw error;
      } catch (err) {
        console.error('Supabase product delete failed:', err);
        throw err;
      }
    }

    const products = this.getProducts();
    const filtered = products.filter(p => p.id !== id);
    localStorage.setItem(this.STORAGE_PREFIX + 'products', JSON.stringify(filtered));
  }

  // --- ORDERS MANAGEMENT ---
  static getOrders(): Order[] {
    const raw = localStorage.getItem(this.STORAGE_PREFIX + 'orders');
    if (!raw) {
      this.saveOrders(MOCK_ORDERS);
      return MOCK_ORDERS;
    }
    try {
      const parsed = JSON.parse(raw) as Order[];
      return parsed.map(o => {
        const qty = o.type === 'dtf' ? this.extractLengthFromOrder(o) : o.quantity;
        return {
          ...o,
          quantity: qty,
          orderImages: this.parseOrderImagesArray(o.orderImages)
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
    localStorage.setItem(this.STORAGE_PREFIX + 'customer_pins', JSON.stringify(pins));
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

    // Background sync to Supabase (await it to handle errors correctly)
    if (this.isSupabaseActive) {
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
        notes: newOrder.notes || ''
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
        throw err;
      }
    }

    const orders = this.getOrders();
    orders.unshift(newOrder);
    this.saveOrders(orders);

    // Adjust product stock based on items in cart or single order
    if (order.items && order.items.length > 0) {
      const products = this.getProducts();
      for (const item of order.items) {
        if (item.type === 'tshirt') {
          const prd = products.find(p => {
            const sizeMatches = p.size === item.size;
            const nameMatches = p.name === item.productName || `${p.name} - Màu: ${p.color}` === item.productName;
            const colorMatches = p.color === item.color || item.color.includes(p.color);
            return nameMatches && colorMatches && sizeMatches;
          });
          if (prd) {
            await this.updateProductStock(prd.id, Math.max(0, prd.stock - item.quantity));
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
        await this.updateProductStock(item.id, Math.max(0, item.stock - order.quantity));
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
    const notesToSave = updatedFields.notes !== undefined ? updatedFields.notes : (existingOrder.notes || '');
    const imagesToSave = updatedFields.orderImages !== undefined ? updatedFields.orderImages : (existingOrder.orderImages || []);

    payload.order_images = JSON.stringify({
      images: Array.isArray(imagesToSave) ? imagesToSave : [imagesToSave],
      notes: notesToSave
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
        if (updatedFields.unitPrice !== undefined || updatedFields.quantity !== undefined || updatedFields.productName !== undefined || updatedFields.color !== undefined) {
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
    if (existingItems.length > 0) {
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
    if (this.isSupabaseActive) {
      try {
        const { error: itemsError } = await supabase.from('order_items').delete().eq('order_id', id);
        if (itemsError) throw itemsError;
        const { error: orderError } = await supabase.from('orders').delete().eq('id', id);
        if (orderError) throw orderError;
      } catch (err) {
        console.error('Supabase order delete failed:', err);
        throw err;
      }
    }

    const orders = this.getOrders();
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
      if (!client.productsTaken.includes(order.productName)) {
        client.productsTaken.push(order.productName);
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

    // 1. Direct match with stripped customer name (e.g. trangcn2 matches Trang cn 2)
    let matched = customers.find(c => stripAndNormalize(c.name) === targetStripped);
    if (matched) return matched;

    // 2. Direct match with stripped customer name + type suffix (matching "-ao", "-dtf", "-tshirt")
    matched = customers.find(c => {
      const nameStripped = stripAndNormalize(c.name);
      return nameStripped + 'dtf' === targetStripped ||
             nameStripped + 'ao' === targetStripped ||
             nameStripped + 'tshirt' === targetStripped;
    });
    if (matched) return matched;

    // 3. Fallback to full or short UUID matching
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
