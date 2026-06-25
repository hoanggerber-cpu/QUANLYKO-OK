export interface User {
  id: string;
  username: string;
  role: 'admin';
  fullName: string;
}

export type ProductSource =
  | 'self_produced'
  | 'external'
  | 'new_produced_unpaid'
  | 'consignment_unpaid'
  | 'consignment_paid';

export interface Product {
  id: string;
  name: string;
  image: string; // Base64 or URL
  color: string;
  size?: string;
  stock: number;
  importPrice: number;
  salePrice: number;
  source: ProductSource;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string | null;
  syncVersion?: number;
}

export type OrderType = 'dtf' | 'tshirt' | 'mixed';
export type OrderStatus = 'pending' | 'completed' | 'cancelled';

export interface OrderItem {
  id: string;
  productId?: string;
  type: 'dtf' | 'tshirt';
  productName: string;
  color: string;
  size?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  image?: string;
  extraImages?: string[];
  rawFile?: any;
  extraRawFiles?: any[];
}

export interface Order {
  id: string;
  orderCode: string;
  customerName: string;
  type: OrderType;
  // Details of products in the order
  productName: string; // Multi-items or single name
  color: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  paidAmount: number;
  debtAmount: number; // calculated: total - paid
  status: OrderStatus;
  createdAt: string;
  orderImages?: string[];
  items?: OrderItem[];
  notes?: string;
  surcharge?: number;
}

export interface Customer {
  id: string;
  name: string;
  type: OrderType; // 'dtf' or 'tshirt'
  productsTaken: string[]; // List of names
  totalSpent: number;
  paidAmount: number;
  debtAmount: number;
  updatedAt: string;
  pinCode?: string | null;
}

export interface PaymentHistory {
  id: string;
  customerName: string;
  type: OrderType;
  customerId?: string; // Optional customer id
  amount: number;
  paymentMethod: string;
  createdAt: string;
}

export interface DashboardStats {
  totalRevenue: number;
  totalPaid: number;
  totalDebtUrl: number;
  dtfRevenue: number;
  dtfDebt: number;
  tshirtRevenue: number;
  tshirtDebt: number;
  completedOrdersCount: number;
  lowStockCount: number;
}
