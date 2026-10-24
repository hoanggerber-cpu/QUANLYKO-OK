import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  queueOrderForSync, getPendingOrders, validateOrderAmounts,
  matchesRecordedOrder, confirmOrderSync
} from '../src/lib/orderOutbox.ts';
import {
  commitNewReceipt, commitNewReversal, retryPendingFinanceOperation,
  getPendingFinanceOperation, validateVnd
} from '../src/lib/accountingOperations.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
    key: index => [...values.keys()][index] ?? null,
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, writable: true, value: createMemoryStorage(),
  });
});

test('strict VND financial invariants accept exact amounts', () => {
  assert.doesNotThrow(() => validateOrderAmounts({
    totalPrice: 5_000_000, paidAmount: 2_000_000, debtAmount: 3_000_000
  }));
  assert.throws(() => validateOrderAmounts({
    totalPrice: 5_000_000, paidAmount: 2_000_000, debtAmount: 3_000_001
  }), /Sai phép tính/);
  assert.throws(() => validateOrderAmounts({
    totalPrice: 5_000_000, paidAmount: 5_000_001, debtAmount: -1
  }), /Sai phép tính/);
  assert.throws(() => validateOrderAmounts({
    totalPrice: 500.5, paidAmount: 500, debtAmount: 0.5
  }), /Sai phép tính/);
  for (const amount of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
    assert.throws(() => validateVnd(amount), /Số tiền/);
  }
  validateVnd(2_000_000);
});

test('offline order stays pending until the exact cloud read-back matches', () => {
  const invoice = {
    id:'o_test-1', orderCode:'ORD-DTF-0001',
    customerName:'Khach A', type:'dtf',
    totalPrice:5000000, paidAmount:2000000, debtAmount:3000000,
    createdAt:'2026-10-24T08:00:00Z', items: [{id:'itm_1'}],
  } as Parameters<typeof queueOrderForSync>[0];
  queueOrderForSync(invoice);
  assert.equal(getPendingOrders().length,1);
  assert.throws(() => queueOrderForSync(invoice), /hàng đợi/);
  assert.equal(matchesRecordedOrder(getPendingOrders()[0], {
    id:'o_test-1', customer_name:'Khach A',type:'dtf',
    total_price:'5000000',paid_amount:'2000000',debt_amount:'3000000'
  }),true);
  assert.equal(matchesRecordedOrder(getPendingOrders()[0], {
    id:'o_test-1', customer_name:'Khach A',type:'dtf',
    total_price:'5000000',paid_amount:'2000001',debt_amount:'2999999'
  }),false);
  assert.equal(getPendingOrders().length,1);
  confirmOrderSync('o_test-1');
  assert.equal(getPendingOrders().length,0);
});

test('corrupt durable order sync journal fails closed', () => {
  localStorage.setItem('petshirt_admin_pending_orders_v1', '{bad-json');
  assert.throws(() => getPendingOrders(), /bị hỏng/);
});

test('cloud commit confirms once and clears persistent receipt ID', async () => {
  let issuedId = '';
  let calls = 0;
  const client = {
    rpc: async (_name: string, params: Record<string, unknown>) => {
      calls++;
      issuedId = String(params.p_payment_id);
      assert.equal(params.p_amount, 2000000);
      assert.equal(params.p_target_order_id, null);
      assert.equal(getPendingFinanceOperation()?.id,issuedId);
      return { data: { payment_id: issuedId, state:'committed' }, error:null };
    },
  } as unknown as SupabaseClient;
  await commitNewReceipt(client, {
    customerName:'Khach A',customerType:'dtf',customerId:'c_dtf_test',
    amount:2000000,method:'Chuyển khoản'
  });
  assert.equal(calls,1);
  assert.equal(getPendingFinanceOperation(),null);
});

test('network timeout after server commit retries SAME UUID and never creates second receipt', async () => {
  let initialId = '';
  let commits = 0;
  const client = {
    rpc: async (_name: string, params: Record<string, unknown>) => {
      const id = String(params.p_payment_id);
      commits++;
      if (commits === 1) {
        initialId=id;
        throw new Error('timeout after the server committed');
      }
      assert.equal(id,initialId,'idempotency key must survive browser retry');
      return { data:{payment_id:id,state:'committed',duplicate:true},error:null };
    },
  } as unknown as SupabaseClient;

  await assert.rejects(commitNewReceipt(client,{
    customerName:'Khach A',customerType:'dtf',customerId:'c_dtf_test',
    amount:2000000,method:'Cash'
  }), /timeout/);
  assert.equal(getPendingFinanceOperation()?.id,initialId);
  await assert.rejects(commitNewReceipt(client,{
    customerName:'Khach A',customerType:'dtf',customerId:'c_dtf_test',
    amount:2000000,method:'Cash'
  }), /chưa được xác nhận/);
  assert.equal(commits,1,'blocked new attempt never reaches server');
  assert.equal(await retryPendingFinanceOperation(client),true);
  assert.equal(commits,2,'single deliberate retry with identical UUID');
  assert.equal(getPendingFinanceOperation(),null);
});

test('failed reversal retains its original idempotency operation for safe replay', async () => {
  let firstId='';
  let calls=0;
  const client = {
    rpc: async (_name: string, params: Record<string,unknown>) => {
      calls++;
      const id=String(params.p_reversal_id);
      if (calls===1) {firstId=id;throw new Error('uncertain response');}
      assert.equal(id,firstId);
      assert.equal(params.p_payment_id,'receipt-123');
      return {data:{payment_id:'receipt-123',state:'reversed'},error:null};
    },
  } as unknown as SupabaseClient;
  await assert.rejects(commitNewReversal(client,'receipt-123'), /uncertain/);
  assert.equal(getPendingFinanceOperation()?.kind,'reversal');
  await retryPendingFinanceOperation(client);
  assert.equal(getPendingFinanceOperation(),null);
});

test('invalid or reversed payment response keeps receipt pending for investigation', async () => {
  const client = {
    rpc: async (_name: string, params: Record<string,unknown>) => ({
      data:{payment_id:params.p_payment_id,state:'reversed'},error:null
    }),
  } as unknown as SupabaseClient;
  await assert.rejects(commitNewReceipt(client,{
    customerName:'Khach A', customerType:'dtf',customerId:'c_a',
    amount:1000000,method:'Cash'
  }), /đã hoàn tác/);
  assert.ok(getPendingFinanceOperation());
});
