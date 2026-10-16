const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCountedQty, isValidForUnit, itemDelta, newQuantityOnApply, summarize } = require('../src/utils/stockCount');

test('parseCountedQty: vergül və nöqtə, boş, səhv', () => {
  assert.equal(parseCountedQty('2,5'), 2.5);
  assert.equal(parseCountedQty(' 12 '), 12);
  assert.equal(parseCountedQty('0.1234'), 0.123);
  assert.equal(parseCountedQty(''), null);
  assert.equal(parseCountedQty(null), null);
  assert.equal(parseCountedQty('-3'), undefined);
  assert.equal(parseCountedQty('abc'), undefined);
});

test('ədəd vahidi tam say tələb edir', () => {
  assert.equal(isValidForUnit(3, 'PIECE'), true);
  assert.equal(isValidForUnit(2.5, 'PIECE'), false);
  assert.equal(isValidForUnit(2.5, 'KG'), true);
  assert.equal(isValidForUnit(null, 'PIECE'), true);
});

test('fərq = real − sistem', () => {
  assert.equal(itemDelta({ systemQty: 81, countedQty: 12 }), -69);
  assert.equal(itemDelta({ systemQty: '2.796', countedQty: '3.100' }), 0.304);
  assert.equal(itemDelta({ systemQty: 5, countedQty: null }), null);
});

test('tətbiq: sayımdan sonrakı satış qorunur, mənfi olmur', () => {
  // Sayılanda sistem 12, real 10. Sonra 2 satıldı → indiki qalıq 10. Nəticə 8 olmalıdır.
  assert.equal(newQuantityOnApply(10, { systemQty: 12, countedQty: 10 }), 8);
  assert.equal(newQuantityOnApply(1, { systemQty: 5, countedQty: 0 }), 0);
  assert.equal(newQuantityOnApply(7, { systemQty: 7, countedQty: null }), 7);
});

test('xülasə: əskik/artıq dəyəri alış qiyməti ilə', () => {
  const s = summarize([
    { systemQty: 81, countedQty: 80, purchasePrice: 6 },
    { systemQty: 2, countedQty: 4, purchasePrice: 10 },
    { systemQty: 5, countedQty: 5, purchasePrice: 3 },
    { systemQty: 9, countedQty: null, purchasePrice: 1 },
  ]);
  assert.equal(s.counted, 3);
  assert.equal(s.uncounted, 1);
  assert.equal(s.matched, 1);
  assert.equal(s.shortageValue, 6);
  assert.equal(s.surplusValue, 20);
  assert.equal(s.netValue, 14);
});
