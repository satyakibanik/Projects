"""Causal update and honest prospective scoring checks; no ERP network calls."""
import copy
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import forecast_updates as updates
from evaluate_forecast_updates import evaluate

DAY = '2026-10-25'


def fixture():
    forecast = dict(status='ready', date=DAY, issued_at='2026-10-24T07:59:00Z',
        hourly=[dict(time=t, demand_mw=1000., generation_mw=1100.) for t in updates.HOURS])
    current = dict(today_date=DAY, source_dates=dict(demand=DAY, generation=DAY),
        independent_forecast=forecast,
        demand_hourly=[dict(time=t, demand_mw=900.) for t in updates.HOURS[:3]],
        generation_hourly=[dict(time=t, total_mw=1000.) for t in updates.HOURS[:3]])
    return current, forecast


class UpdateTests(unittest.TestCase):
    def test_future_curve_uses_prior_readings_without_rewriting_the_original(self):
        current, forecast = fixture()
        before = copy.deepcopy(current)
        issue = updates.make_issue(current, forecast, DAY+'T03:05:00+06:00')
        demand = issue['targets']['demand']
        self.assertEqual(demand['input_through'], '02:00')
        self.assertEqual(demand['bias_mw'], -100)
        self.assertEqual(demand['hourly'][0]['time'], '04:00')
        expected = 1000 - 80 * 2**(-2/6)
        self.assertAlmostEqual(demand['hourly'][0]['forecast_mw'], expected)
        self.assertGreater(demand['hourly'][-1]['forecast_mw'], expected)
        self.assertEqual(current, before)

    def test_no_target_hour_or_later_readings_can_influence_an_issue(self):
        current, forecast = fixture()
        issued = DAY+'T03:05:00+06:00'
        original = updates.make_issue(current, forecast, issued)
        current['demand_hourly'].extend(dict(time=t, demand_mw=999999.) for t in updates.HOURS[4:])
        self.assertEqual(updates.make_issue(current, forecast, issued), original)
        # Even a reading nominally at the target hour cannot be used as an input.
        current['demand_hourly'].append(dict(time='04:00', demand_mw=1000000.))
        self.assertEqual(updates.make_issue(current, forecast, issued), original)

    def test_missing_stale_wrong_date_and_conflicting_sources_are_not_corrected(self):
        for change in ('missing', 'stale', 'date', 'conflict', 'negative', 'nonfinite'):
            with self.subTest(change=change):
                current, forecast = fixture()
                if change == 'missing': current['demand_hourly'].pop(1)
                if change == 'stale': current['demand_hourly'] = current['demand_hourly'][:2]
                if change == 'date': current['source_dates']['demand'] = '2026-10-24'
                if change == 'conflict': current['demand_hourly'].append(dict(time='02:00', demand_mw=1))
                if change == 'negative': current['demand_hourly'][1]['demand_mw'] = -1
                if change == 'nonfinite': current['demand_hourly'][1]['demand_mw'] = float('nan')
                issue = updates.make_issue(current, forecast, DAY+'T04:05:00+06:00')
                self.assertNotIn('demand', (issue or {}).get('targets', {}))

    def test_correction_is_bounded_and_never_negative(self):
        current, forecast = fixture()
        for row in current['demand_hourly']: row['demand_mw'] = 0
        issue = updates.make_issue(current, forecast, DAY+'T02:05:00+06:00')
        self.assertEqual(issue['targets']['demand']['hourly'][0]['forecast_mw'], 850)

    def test_real_issues_persist_and_score_only_subsequent_hours(self):
        current, forecast = fixture()
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            updates.attach_updates(current, cache, DAY+'T03:05:00+06:00')
            first = copy.deepcopy(current['forecast_update']['latest'])
            saved = (cache/updates.VERSION/(DAY+'.json')).read_bytes()
            self.assertEqual(current['forecast_update']['scores']['demand']['count'], 0)
            updates.attach_updates(current, cache, DAY+'T03:15:00+06:00')
            self.assertEqual((cache/updates.VERSION/(DAY+'.json')).read_bytes(), saved)
            # A late 03:00 observation was not predicted before 03:00.
            current['demand_hourly'] += [dict(time='03:00', demand_mw=950), dict(time='04:00', demand_mw=940)]
            updates.attach_updates(current, cache, DAY+'T04:15:00+06:00')
            score = current['forecast_update']['scores']['demand']
            self.assertEqual(score['count'], 1)
            self.assertEqual(score['hourly'][0]['time'], '04:00')
            self.assertEqual(score['original_mae_mw'], 60)
            self.assertAlmostEqual(score['updated_mae_mw'], abs(940-first['targets']['demand']['hourly'][0]['forecast_mw']))
            issues = json.loads((cache/updates.VERSION/(DAY+'.json')).read_text())['issues']
            self.assertEqual(issues[0], first)
            # A refresh must not rescore 04:00 against the newly made issue.
            self.assertEqual(score, updates.matched_scores(issues, DAY, 'demand', {'04:00':940}))
            archived = updates.archived_update(DAY, current, cache)
            self.assertEqual(archived['scores']['demand'], score)

    def test_scoring_rejects_at_hour_issues_and_counts_each_hour_once(self):
        current, forecast = fixture()
        first = updates.make_issue(current, forecast, DAY+'T03:05:00+06:00')
        second = updates.make_issue(current, forecast, DAY+'T03:55:00+06:00')
        second['targets']['demand']['hourly'][0]['forecast_mw'] = 941
        late = copy.deepcopy(second)
        late['issued_at'] = DAY+'T04:00:00+06:00'
        late['targets']['demand']['hourly'][0]['forecast_mw'] = 940
        scores = updates.matched_scores([first, second, late], DAY, 'demand', {'04:00':940})
        self.assertEqual(scores['count'], 1)
        self.assertEqual(scores['updated_mae_mw'], 1)

    def test_published_issue_journal_survives_an_evicted_actions_cache(self):
        current, forecast = fixture()
        first = updates.make_issue(current, forecast, DAY+'T03:05:00+06:00')
        ledger = dict(version=updates.VERSION, date=DAY, issues=[first])
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {'BEGD_PUBLISHED_UPDATE_BASE_URL':'https://example.test/forecast-updates'}):
            cache = Path(directory)
            with patch.object(updates, 'urlopen', return_value=io.BytesIO(json.dumps(ledger).encode())) as fetch:
                self.assertEqual(updates.read_ledger(cache, DAY), [first])
                fetch.assert_called_once()
            with patch.object(updates, 'urlopen', side_effect=AssertionError('Must reuse restored issues')):
                self.assertEqual(updates.read_ledger(cache, DAY), [first])
            self.assertEqual(json.loads((cache/(DAY+'.json')).read_text()), ledger)

    def test_invalid_public_journal_is_not_restored_or_scored(self):
        current, forecast = fixture()
        issue = updates.make_issue(current, forecast, DAY+'T03:05:00+06:00')
        issue['targets']['demand']['hourly'][0]['time'] = '03:00'
        ledger = dict(version=updates.VERSION, date=DAY, issues=[issue])
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {'BEGD_PUBLISHED_UPDATE_BASE_URL':'https://example.test/forecast-updates'}), patch.object(updates, 'urlopen', return_value=io.BytesIO(json.dumps(ledger).encode())):
            self.assertEqual(updates.read_ledger(Path(directory), DAY), [])

    def test_wrong_forecast_date_and_issue_time_are_rejected(self):
        current, forecast = fixture()
        self.assertIsNone(updates.make_issue(current, forecast, '2026-10-26T01:05:00+06:00'))
        forecast['issued_at'] = DAY+'T04:00:00+06:00'
        self.assertIsNone(updates.make_issue(current, forecast, DAY+'T03:05:00+06:00'))
        forecast['date'] = '2026-10-24'
        self.assertIsNone(updates.make_issue(current, forecast, DAY+'T05:05:00+06:00'))

    def test_replay_has_an_observation_delay_and_does_not_optimize_on_target(self):
        current, forecast = fixture()
        current['demand_hourly'] = [dict(time=t, demand_mw=900.) for t in updates.HOURS]
        result = updates.replay(forecast, current['demand_hourly'], [])['demand']
        self.assertEqual(result['count'], 21)
        self.assertEqual(result['hourly'][0]['time'], '03:00')
        before = result['hourly'][0]['forecast_mw']
        current['demand_hourly'][3]['demand_mw'] = 99999
        changed = updates.replay(forecast, current['demand_hourly'], [])['demand']
        self.assertEqual(changed['hourly'][0]['forecast_mw'], before)
        self.assertLess(result['updated_mae_mw'], result['original_mae_mw'])

    def test_replay_excludes_retrospective_daily_forecasts(self):
        current, forecast = fixture()
        forecast['publication_kind'] = 'retrospective'
        report = evaluate(current)
        self.assertEqual(report['scores']['demand']['count'], 0)
        self.assertIn(DAY, report['skipped'])


if __name__ == '__main__':
    unittest.main()
