// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: assert
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/model-data-center.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {normalizedPrice, roundEstimate, valueScore, buildPriceFromMetadata,
  buildPriceFromOpenRouter, enrichRows} = require('../src/model-data-center.cjs');

test('unknown price fields stay unknown while numeric zero remains a real price', () => {
  const fields = ['input', 'output', 'cache_read', 'cache_write'];
  for (const value of [undefined, null, '', ' \t\n', false, true, [], {}, -1, NaN, Infinity, 'unknown']) {
    const price = normalizedPrice(Object.fromEntries(fields.map(key => [key, value])), {currency: 'CNY'});
    for (const key of fields) assert.equal(price[key], null, key + ': ' + String(value));
  }
  for (const value of [0, '0', ' 0 ', 12.5, '12.5']) {
    const price = normalizedPrice(Object.fromEntries(fields.map(key => [key, value])), {currency: 'CNY'});
    for (const key of fields) assert.equal(price[key], Number(value));
  }
});

test('USD amounts retain their source price when a valid exchange rate is unavailable', () => {
  for (const fx of [undefined, null, '', ' ', 0, -1, Infinity, false]) {
    const price = normalizedPrice({input: 1, output: 2}, {currency: 'USD', fx});
    assert.equal(price.input, null);
    assert.equal(price.output, null);
    assert.equal(price.original.input, 1);
    assert.equal(price.original.output, 2);
    assert.equal(price.fx.usd_cny, null);
  }
  const known = normalizedPrice({input: 1, output: 2}, {currency: 'USD', fx: '7.2', fxDate: '2026-10-12'});
  assert.equal(known.input, 7.2);
  assert.equal(known.output, 14.4);
  assert.equal(known.fx.date, '2026-10-12');
  const metadata = buildPriceFromMetadata({cost: {input: 1, output: 2}});
  assert.equal(metadata.input, null);
  assert.equal(metadata.original.currency, 'USD');
  const router = buildPriceFromOpenRouter({pricing: {prompt: '0.000001', completion: '0.000002'}}, null);
  assert.equal(router.input, null);
  assert.equal(router.original.input, 0.000001);
});

test('round estimates use full input price for unknown cache pricing and reject incomplete totals', () => {
  for (const cache_read of [undefined, null, '', ' ']) {
    const estimate = roundEstimate({input: 4, output: 10, cache_read});
    assert.equal(estimate.cny, .09);
    assert.equal(estimate.cache_known, false);
  }
  const freeCache = roundEstimate({input: 4, output: 10, cache_read: 0});
  assert.equal(freeCache.cny, .026);
  assert.equal(freeCache.cache_known, true);
  assert.equal(roundEstimate({input: 0, output: 0, cache_read: 0}).cny, 0);
  for (const price of [{}, {input: null, output: null}, {input: 4}, {output: 10}, {input: null, output: 10, cache_read: 0}]) {
    assert.equal(roundEstimate(price).cny, null, JSON.stringify(price));
  }
});

test('an absent Agent score cannot create a value recommendation', () => {
  for (const score of [undefined, null, '', ' ', false, {}, {value: null}]) {
    assert.equal(valueScore(score, {input: 4, output: 4}), null);
  }
  assert.equal(valueScore(0, {input: 4, output: 4}), 0);
  assert.equal(valueScore('10', {input: 4, output: 4}), 2.5);
  const rows = enrichRows([
    {id: 'unknown', agent_score: {value: null}, price: {input: 4, output: 10, cache_read: null}},
    {id: 'known', agent_score: {value: 10}, price: {input: 4, output: 4}},
  ]);
  const unknown = rows.find(row => row.id === 'unknown');
  assert.equal(unknown.value_score, null);
  assert.equal(unknown.recommended, false);
  assert.equal(unknown.round_estimate.cny, .09);
  assert.equal(unknown.free, null);
  assert.equal(rows[0].id, 'known');
});
