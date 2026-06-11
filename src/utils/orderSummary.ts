import { Order, OrderItem } from '../types';

const uniqueNames = (items: OrderItem[]) =>
  Array.from(new Set(items.map(item => item.productName?.trim()).filter((name): name is string => Boolean(name))));

export const getTshirtInventoryNames = (items: OrderItem[] = []): string[] =>
  uniqueNames(items.filter(item => item.type === 'tshirt'));

export const buildCartProductSummary = (items: OrderItem[]): string => {
  const parts = [...getTshirtInventoryNames(items)];
  const dtfItems = items.filter(item => item.type === 'dtf');

  if (dtfItems.length > 0) {
    const meters = dtfItems.reduce((sum, item) => sum + item.quantity, 0);
    parts.push(`In PET phim (${meters.toFixed(1)}m)`);
  }

  return parts.join(' / ') || 'Đơn gộp tổng hợp';
};

export const getOrderProductSummary = (order: Order): string => {
  if (!order.items?.length || order.type === 'dtf') return order.productName;
  return uniqueNames(order.items).join(' / ') || order.productName;
};
