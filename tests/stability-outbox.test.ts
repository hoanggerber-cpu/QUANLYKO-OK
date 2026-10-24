import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  queueOrderForSync, getPendingOrders, confirmOrderSync, noteOrderSyncError,
  matchesRecordedOrder,
} from '../src/lib/orderOutbox.ts';
import type { Order } from '../src/types.ts';

const pendingKey = 'petshirt_admin_pending_orders_v1';
function fakeStorage() {
  const entries = new Map<string,string>();
  return {
    get length() {return entries.size;},
    key: (i: number) => [...entries.keys()][i] ?? null,
    getItem: (k: string) => entries.get(k) ?? null,
    setItem: (k: string, v: string) => {entries.set(k,v);},
    removeItem: (k: string) => {entries.delete(k);},
    clear: () => entries.clear(),
  };
}
function sampleOrder(id='o_123'): Order {
  return {id,orderCode:'ORD-DTF-1234',type:'dtf',customerName:'TEST ONLY',
    productName:'Phim PET test',color:'',quantity:1,unitPrice:50000,totalPrice:50000,
    paidAmount:20000,debtAmount:30000,status:'pending',createdAt:'2026-10-24T10:00:00Z',
    items:[{id:'itm_test',type:'dtf',productName:'Test',color:'',quantity:1,unitPrice:50000,totalPrice:50000}]};
}
beforeEach(()=>{
  Object.defineProperty(globalThis,'localStorage',{value:fakeStorage(),configurable:true,writable:true});
});
test('offline record and initial receipt retain same identities across failed sync and reload',()=>{
  const invoice=sampleOrder();
  queueOrderForSync(invoice,{id:'receipt-fixed-uuid',method:'cash'});
  noteOrderSyncError(invoice.id,'offline');
  const cached=localStorage.getItem(pendingKey);
  assert.ok(cached);
  // Simulate reload reading localStorage again.
  const pending=getPendingOrders()[0];
  assert.equal(pending.id, invoice.id);
  assert.equal(pending.initialPaymentId,'receipt-fixed-uuid');
  assert.equal(pending.lastError,'offline');
  assert.equal(matchesRecordedOrder(pending,{
    id:invoice.id,customer_name:invoice.customerName,type:'dtf',
    total_price:50000,paid_amount:20000,debt_amount:30000,
  }),true);
  assert.equal(getPendingOrders().length,1);
  confirmOrderSync('another-id');
  assert.equal(getPendingOrders().length,1);
  confirmOrderSync(invoice.id);
  assert.equal(getPendingOrders().length,0);
});
test('disk full/quota: order is not queued as successfully durable',()=>{
  const storage=localStorage;
  const originalSet=storage.setItem.bind(storage);
  storage.setItem=(k,v)=>{if(k===pendingKey)throw new Error('QuotaExceededError');originalSet(k,v)};
  assert.throws(()=>queueOrderForSync(sampleOrder()),/QuotaExceededError/);
  assert.equal(getPendingOrders().length,0);
});
test('refuse duplicate order IDs during offline retry',()=>{
  queueOrderForSync(sampleOrder());
  assert.throws(()=>queueOrderForSync(sampleOrder()),/hàng đợi/);
  assert.equal(getPendingOrders().length,1);
});
test('remote readback with changed accounting balances cannot acknowledge offline order',()=>{
  queueOrderForSync(sampleOrder());
  const p=getPendingOrders()[0];
  assert.equal(matchesRecordedOrder(p,{
    id:p.id, customer_name:p.customerName,type:p.type,
    total_price:50000,paid_amount:50000,debt_amount:0,
  }),false);
  assert.equal(getPendingOrders().length,1);
});
test('corrupt local journal causes fail-closed behavior',()=>{
  localStorage.setItem(pendingKey,'{"oops":true}');
  assert.throws(()=>queueOrderForSync(sampleOrder()),/định dạng sai/);
});
