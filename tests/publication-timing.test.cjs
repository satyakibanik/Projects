const assert = require('node:assert/strict');
const test = require('node:test');
const {dailyRows, estimate, wallTime, plotScale, workbookTime} = require('../begd/publication-timing.js');

function row(date, reading_time, before, after) {
  return {date, reading_time, absent_after: before && before + ':00+06:00', first_seen_at: after + ':00+06:00'};
}

test('daily history excludes setup days, unbounded days and wide windows from estimates', () => {
  const observations = [
    row('2026-11-12', '00:00', '2026-11-11T23:55', '2026-11-12T00:10'),
    row('2026-11-13', '00:00', null, '2026-11-13T00:10'),
    row('2026-11-14', '00:00', '2026-11-13T22:00', '2026-11-14T00:10'),
    row('2026-11-15', '01:00', '2026-11-15T00:45', '2026-11-15T01:05'),
    row('2026-11-15', '00:00', '2026-11-14T23:55', '2026-11-15T00:10'),
    row('2026-11-16', '00:00', '2026-11-15T23:58', '2026-11-16T00:12')
  ];
  const days = dailyRows({baseline_through: '2026-11-12', observations});
  assert.deepEqual(days.map(day => day.eligible), [true, true, false, false, false]);
  assert.equal(days[1].first.reading_time, '00:00');
  assert.equal(days[1].records.length, 2);
  assert.deepEqual(estimate(days, 5), {count: 2});
  assert.deepEqual(estimate(days, 2), {count: 2, lower: -4, upper: 11});
  assert.equal(wallTime(-4), '23:56 (-1d)');
  assert.equal(wallTime(1441), '00:01 (+1d)');
});

test('unknown lower bound among equally early records makes the day unbounded', () => {
  const days = dailyRows({observations: [
    row('2026-11-15', '01:00', '2026-11-15T00:45', '2026-11-15T01:05'),
    row('2026-11-15', '00:00', null, '2026-11-15T01:05')
  ]});
  assert.equal(days[0].eligible, false);
  assert.equal(days[0].bounded, false);
});

test('plot scale spans midnight and includes a typical band and first-seen-only records', () => {
  const scale = plotScale([{lower: null, upper: -8}, {lower: 10, upper: 12}], {lower: -10, upper: 5});
  assert.ok(scale.start < -10);
  assert.ok(scale.end > 12);
  assert.ok(scale.ticks.includes(0));
  assert.ok(scale.ticks.length <= 10);
  const single = plotScale([{lower: null, upper: 7}]);
  assert.ok(single.start < 7 && single.end > 7);
});

test('workbook timestamps convert only values with an explicit UTC offset', () => {
  assert.match(workbookTime('2026-11-18T05:46:45+00:00'), /11:46:45$/);
  assert.equal(workbookTime('2026-11-18T05:46:45'), '2026-11-18 05:46:45 (time zone unspecified)');
  assert.equal(workbookTime(undefined), '—');
});
