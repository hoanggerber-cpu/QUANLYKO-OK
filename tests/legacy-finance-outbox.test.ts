import assert from 'node:assert/strict';
import {beforeEach,test} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {getPendingLegacyReceipt,queueLegacyReceipt,syncLegacyReceipt} from '../src/lib/legacyFinanceOutbox.ts';

function freshStorage(): Storage {
  const m=new Map<string,string>();
  return {
    get length(){return m.size;},
    key:(n)=>[...m.keys()][n]??null,
    getItem:(k)=>m.get(k)??null,
    setItem:(k,v)=>{m.set(k,v);},
    removeItem:(k)=>{m.delete(k);},
    clear:()=>m.clear(),
  };
}
beforeEach(()=>{
  Object.defineProperty(globalThis,'localStorage',{configurable:true,writable:true,value:freshStorage()});
});

test('offline amount is held without cloud RPC until manually synced',async()=>{
  const pending=queueLegacyReceipt({
    customerName:'Khach A',customerType:'dtf',customerId:'c_dtf_A',
    amount:2000000,method:'Cash',targetOrderId:null
  });
  assert.equal(getPendingLegacyReceipt()?.amount,2000000);
  let calls=0;
  const client={rpc:async (_name:string,params:Record<string,unknown>)=>{
    calls++;
    assert.equal(params.p_payment_id,pending.id);
    assert.equal(params.p_amount,2000000);
    return {data:{payment_id:pending.id,state:'committed'},error:null};
  }} as unknown as SupabaseClient;
  assert.equal(calls,0);
  assert.equal(await syncLegacyReceipt(client),true);
  assert.equal(calls,1);
  assert.equal(getPendingLegacyReceipt(),null);
});

test('offline receipt keeps immutable UUID through timeout after database commit',async()=>{
  const pending=queueLegacyReceipt({
    customerName:'Khach A',customerType:'dtf',customerId:'c_dtf_A',
    amount:2000000,method:'Bank',targetOrderId:null,
  });
  let n=0;
  const client={rpc:async (_name:string,params:Record<string,unknown>)=>{
    n++;
    assert.equal(params.p_payment_id,pending.id);
    if(n===1)throw new Error('timeout after commit');
    return {data:{payment_id:pending.id,state:'committed',duplicate:true},error:null};
  }} as unknown as SupabaseClient;
  await assert.rejects(syncLegacyReceipt(client),/timeout/);
  assert.equal(getPendingLegacyReceipt()?.id,pending.id);
  assert.throws(()=>queueLegacyReceipt({
    customerName:'Khach A',customerType:'dtf',customerId:'c_dtf_A',
    amount:2000000,method:'Bank',targetOrderId:null
  }),/chưa xác nhận/);
  assert.equal(await syncLegacyReceipt(client),true);
  assert.equal(n,2);
  assert.equal(getPendingLegacyReceipt(),null);
});

test('invalid RPC acknowledgement must never drop the pending receipt',async()=>{
  queueLegacyReceipt({
    customerName:'Khach A',customerType:'dtf',customerId:'c_dtf_A',
    amount:1000000,method:'Cash',targetOrderId:null
  });
  const client={rpc:async()=>({data:{payment_id:'wrong',state:'committed'},error:null})} as unknown as SupabaseClient;
  await assert.rejects(syncLegacyReceipt(client),/chưa xác nhận đúng mã/);
  assert.ok(getPendingLegacyReceipt());
});

test('corrupted journal is not overwritten with a new payment',()=>{
  localStorage.setItem('petshirt_admin_pending_legacy_receipt_v1','{not valid');
  assert.throws(()=>getPendingLegacyReceipt(),/bị lỗi/);
  assert.throws(()=>queueLegacyReceipt({
    customerName:'Khach A',customerType:'dtf',customerId:'c_dtf_A',
    amount:1000000,method:'Cash',targetOrderId:null
  }),/bị lỗi/);
});
