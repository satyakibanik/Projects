const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../begd/forecast-performance.js'), 'utf8'), context);
const { issuedBeforeDay, pairs, evaluate } = context.window.BEGDForecastPerformance;

test('only declared daily forecasts issued before the Dhaka operating day qualify', () => {
  const date = '2026-11-18';
  assert.equal(issuedBeforeDay({ publication_kind: 'daily', issued_at: '2026-11-17T17:59:59Z' }, date), true);
  assert.equal(issuedBeforeDay({ publication_kind: 'daily', issued_at: '2026-11-17T18:00:00Z' }, date), false);
  assert.equal(issuedBeforeDay({ publication_kind: 'retrospective', issued_at: '2026-11-17T00:00:00Z' }, date), false);
});

test('exact-hour scores reject conflicting and wrong-date observations and retain measured zeros', () => {
  const date = '2026-11-18';
  const matches = pairs([
    { time: '00:00', demand_mw: 0 },
    { time: '00:30', demand_mw: 1 },
    { time: '01:00', demand_mw: 50 },
    { time: '01:00', demand_mw: 51 },
    { time: '02:00', demand_mw: 5, date: '2026-11-17' },
  ], date, 'demand_mw', new Map([['00:00', 10], ['00:30', 10], ['01:00', 10], ['02:00', 10]]));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].error, 10);
});

test('rolling scores weight hours and peak timing requires a complete day', () => {
  const completeDay = Array.from({ length: 24 }, (_, index) => ({
    index,
    observed: index === 12 ? 30 : 20,
    forecast: index === 14 ? 34 : 22,
  })).map(row => ({ ...row, error: row.forecast - row.observed }));
  const result = evaluate([
    { date: '2026-11-17', pairs: completeDay },
    { date: '2026-11-18', pairs: [{ index: 0, observed: 20, forecast: 10, error: -10 }] },
  ]);
  assert.equal(result.daily[0].peak, 2);
  assert.equal(result.daily[1].peak, null);
  assert.equal(result.daily[1].rolling.count, 25);
  assert.equal(result.daily[1].rolling.mae, 76 / 25);
  assert.equal(result.daily[1].rolling.bias, 40 / 25);
  assert.equal(result.byHour[0].count, 2);
});
