import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesOrderImageReadback } from '../src/lib/orderImageReadback.ts';

const correct = {
  orderImages: ['https://storage.example/originals/design.png'],
  items: [{id:'itm_01', image:'https://storage.example/originals/design.png'}]
};
const order = {order_images:JSON.stringify({images:correct.orderImages,notes:''})};
const items = [{id:'itm_01',image:correct.items[0].image}];

test('exact matching design URLs permit acknowledgement after cloud readback', () => {
  assert.equal(matchesOrderImageReadback(correct,order,items),true);
});
test('readback prevents acknowledgement if photo is absent from orders table', () => {
  assert.equal(matchesOrderImageReadback(correct,{order_images:'{"images":[]}'},items),false);
});
test('readback prevents acknowledgement if item image missing or from another invoice', () => {
  assert.equal(matchesOrderImageReadback(correct,order,[{id:'itm_01',image:null}]),false);
  assert.equal(matchesOrderImageReadback(correct,order,[{id:'itm_02',image:correct.items[0].image}]),false);
});
test('readback refuses malformed cloud data or missing details', () => {
  assert.equal(matchesOrderImageReadback(correct,{order_images:'broken-json'},items),false);
  assert.equal(matchesOrderImageReadback(correct,undefined,items),false);
  assert.equal(matchesOrderImageReadback(correct,order,[]),false);
});
test('image order and item order are not silently reassigned', () => {
  assert.equal(matchesOrderImageReadback(
    {orderImages:['https://storage.example/a.png','https://storage.example/b.png'],items:[]},
    {order_images:JSON.stringify({images:['https://storage.example/b.png','https://storage.example/a.png']})},
    []
  ),false);
});
test('invoice with no images still validates if no items are missing', () => {
  assert.equal(matchesOrderImageReadback({orderImages:[],items:[]},{order_images:'{"images":[]}'},[]),true);
});
