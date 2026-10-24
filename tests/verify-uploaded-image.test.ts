import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyUploadedImage} from '../src/lib/verifyUploadedImage.ts';

const url='https://example.supabase.co/storage/v1/object/public/order-images/originals/item.png';
const ok = ()=>Promise.resolve({data:{path:'originals/item.png'},error:null});
const info = ()=>Promise.resolve({data:{size:128},error:null});
test('uploaded photo is acknowledged only if cloud object size equals source',async()=>{
 assert.equal(await verifyUploadedImage(128,ok,info,()=>url),url);
});
test('zero-byte image cannot be submitted',async()=>{
 let uploadCalled=false;
 await assert.rejects(verifyUploadedImage(0,async()=>{uploadCalled=true;return {data:{}};},info,()=>url),/rỗng/);
 assert.equal(uploadCalled,false);
});
test('failed or unacknowledged uploads cannot be persisted',async()=>{
 await assert.rejects(verifyUploadedImage(128,async()=>({data:null,error:{message:'offline'}}),info,()=>url),/offline/);
 await assert.rejects(verifyUploadedImage(128,async()=>({data:null,error:null}),info,()=>url),/chưa xác nhận/);
});
test('storage missing or mismatched bytes cannot be persisted',async()=>{
 await assert.rejects(verifyUploadedImage(128,ok,async()=>({data:null,error:{message:'not found'}}),()=>url),/Storage/);
 await assert.rejects(verifyUploadedImage(128,ok,async()=>({data:{size:127},error:null}),()=>url),/sai dung lượng/);
 await assert.rejects(verifyUploadedImage(128,ok,async()=>({data:{size:0},error:null}),()=>url),/sai dung lượng/);
});
test('temporary or invalid URL cannot be acknowledged',async()=>{
 await assert.rejects(verifyUploadedImage(128,ok,info,()=>'blob:https://example.app/asset'),/HTTPS/);
 await assert.rejects(verifyUploadedImage(128,ok,info,()=>''),/HTTPS/);
});
