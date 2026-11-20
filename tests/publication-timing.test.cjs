const assert = require('node:assert/strict');
const test = require('node:test');
const {dailyRows, estimate, wallTime, plotScale, workbookTime, workbookHistory, workbookPlotRows, archiveHistory} = require('../begd/publication-timing.js');

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

test('Excel archive merges by report ID without assigning archived records a receipt time', () => {
  const archive = {reports: [
    {report_id: '1', listed_date: '2026-11-17', excel_created_at: '2026-11-17T05:00:00Z'},
    {report_id: '2', listed_date: '2026-11-18', excel_created_at: '2026-11-18T08:00:00'}
  ]};
  const reports = workbookHistory(archive, [
    {report_id: '2', date: '2026-11-18', first_seen_at: '2026-11-18T08:20:00Z',
      excel_modified_at: '2026-11-18T08:01:00+06:00'}
  ]);
  assert.deepEqual(reports.map(row => row.report_id), ['2', '1']);
  assert.equal(reports[1].first_seen_at, undefined);
  assert.equal(reports[0].excel_created_at, '2026-11-18T08:00:00');
  const points = workbookPlotRows(reports);
  assert.deepEqual(points.map(row => row.marks), [
    [{time: 481, type: 'modified'}], [{time: 660, type: 'created'}]
  ]);
  assert.ok(plotScale(points).end > 660);
});

test('60-day source history preserves empty dates and adds live slots without receipt estimates', () => {
  const readings = {end_date: '2026-11-19', sources: {demand: {
    days: {'2026-11-19': ['00:00', '01:00']}, unavailable: ['2026-11-18']
  }}};
  const workbooks = {reports: [{report_id: '5205', listed_date: '2026-11-18'}]};
  const feeds = {demand: {last_poll: {received_at: '2026-11-19T18:05:00Z'},
    seen: {'2026-11-19T01:00': '2026-11-19', '2026-11-20T00:00': '2026-11-20'}}};
  const history = archiveHistory(readings, workbooks, feeds);
  assert.equal(history.demand.length, 60);
  assert.equal(history.demand[0].date, '2026-11-20');
  assert.deepEqual(history.demand[0].slots, ['00:00']);
  assert.deepEqual(history.demand[1].slots, ['00:00', '01:00']);
  assert.equal(history.demand[2].unavailable, true);
  assert.equal(history.operations[2].reports[0].report_id, '5205');
  assert.equal(history.imports.length, 60);
  assert.equal(history.imports[0].slots.length, 0);
});
