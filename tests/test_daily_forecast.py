"""Offline checks for issue timing, leakage, frozen publication and model outputs."""
import copy
import datetime as dt
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import daily_forecast as daily
import build_pages_data as build
from test_scripts import workbook, parse

HAS_MODELS = all(importlib.util.find_spec(m) for m in ('numpy', 'sklearn', 'catboost'))


def ready(day='2026-10-23'):
    return dict(version=daily.VERSION, status='ready', date=day,
                target_basis=daily.TARGET_BASIS,
                issued_at=daily.shift(day, 1) + 'T12:00:00+00:00',
                input_cutoff_date=daily.shift(day, 1), max_actual_input_date=daily.shift(day, 2),
                max_training_publication=daily.shift(day, 1),
                models=dict(generation='Independent median ensemble', demand='Independent mean ensemble'),
                hourly=[dict(time=t, generation_mw=14000., demand_mw=14500.) for t in daily.HOURS])


class PublicationTests(unittest.TestCase):
    def test_forecast_requires_complete_finite_correctly_dated_output(self):
        value = ready()
        self.assertTrue(daily.valid_forecast(value, '2026-10-23'))
        for key, wrong in [('date', '2026-10-22'), ('max_training_publication', '2026-10-23'),
                           ('max_actual_input_date', '2026-10-22')]:
            changed = dict(value, **{key: wrong})
            self.assertFalse(daily.valid_forecast(changed, '2026-10-23'))
        value['hourly'][0]['demand_mw'] = float('nan')
        self.assertFalse(daily.valid_forecast(value, '2026-10-23'))

    def test_cached_predictions_remain_unchanged_when_live_readings_arrive(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            for day in ('2026-10-23', '2026-10-24'):
                daily.atomic_json(cache / daily.VERSION / (day + '.json'), ready(day))
            with patch.object(daily, 'load_history', side_effect=AssertionError('Should not refit')):
                one = daily.prepare_forecasts([], dict(today_date='2026-10-23', generation_hourly=[]), cache)
                two = daily.prepare_forecasts([], dict(today_date='2026-10-23', generation_hourly=[dict(time='00:00', total_mw=99999)]), cache)
            self.assertEqual(one, two)

    def test_local_api_reads_frozen_forecast_without_training_on_live_data(self):
        import server
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            daily.atomic_json(root / '.cache/daily-forecasts' / daily.VERSION / '2026-10-23.json', ready())
            with patch.object(server, 'ROOT', root), patch.object(server, 'current_day_cache', None), patch.object(server, 'fetch_current_day', return_value=dict(today_date='2026-10-23', generation_hourly=[dict(time='00:00', total_mw=99999)])), patch.object(daily, 'fit_forecast', side_effect=AssertionError('Realtime polling must not fit')):
                result = server.get_current_day()
            self.assertEqual(result['independent_forecast'], ready())

    def test_prepare_today_and_tomorrow_retries_failures_without_reusing_yesterday(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {}, clear=True), patch.object(daily, 'load_history', return_value=([], [])) as history:
            result = daily.prepare_forecasts([], dict(today_date='2026-10-23'), Path(directory))
            self.assertEqual(set(result), {'2026-10-23', '2026-10-24'})
            self.assertTrue(all(v['status'] == 'unavailable' for v in result.values()))
            self.assertEqual(history.call_count, 2)
            self.assertFalse(list(Path(directory).rglob('*.json')))

    def test_restore_previously_published_forecast_if_actions_cache_was_evicted(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {'BEGD_PUBLISHED_FORECAST_BASE_URL': 'https://example.test/daily-forecasts'}), patch.object(daily, 'urlopen', side_effect=lambda url, **kw: io.StringIO(json.dumps(ready(Path(url).stem)))), patch.object(daily, 'load_history', side_effect=AssertionError('Must preserve published forecast')):
            result = daily.prepare_forecasts([], dict(today_date='2026-10-23'), Path(directory))
            self.assertTrue(daily.valid_forecast(result['2026-10-23'], '2026-10-23'))

    def test_pgcb_selection_requires_explicit_scenario_date_not_availability_header(self):
        report = dict(report_id='22', report_name='22 October', published_date='2026-10-22',
                      source_url='https://example.test/22.xlsx',
                      forecast=dict(date='2026-10-23', scenario_date='2026-10-22', demand_hourly=[]))
        current = dict(today_date='2026-10-23')
        forecasts = {'2026-10-23': ready()}
        with patch.object(daily, 'prepare_forecasts', return_value=forecasts):
            build.attach_forecasts([], {'22': report}, current, Path('/unused'))
            self.assertIsNone(current['pgcb_forecast'])
            report['forecast']['scenario_date'] = '2026-10-23'
            report['forecast']['demand_hourly'] = [dict(time='00:00', demand_mw=15000)]
            build.attach_forecasts([], {'22': report}, current, Path('/unused'))
        self.assertEqual(current['pgcb_forecast']['date'], '2026-10-23')
        self.assertEqual(current['independent_forecast'], ready())

    def test_parser_keeps_hourly_scenario_date_separate_from_plant_availability(self):
        book = workbook()
        f = book['Forecast']
        f['E25'] = 'Forecast Scenario for 16-10-2026'
        f['E26'], f['J26'] = 'Hour', 'Demand'
        f['E27'], f['F27'], f['H27'], f['J27'] = '00:00', 100, 0, 100
        report = parse(book)
        self.assertEqual(report['forecast']['date'], '2026-10-15')
        self.assertEqual(report['forecast']['scenario_date'], '2026-10-16')
        self.assertEqual(report['forecast']['demand_hourly'][0]['demand_mw'], 100)

    def test_static_build_publishes_one_live_point_and_both_full_day_forecasts_together(self):
        current = dict(today_date='2026-10-23', generation_hourly=[dict(time='00:00', total_mw=14000)],
                       demand_hourly=[dict(time='00:00', demand_mw=14500)], imports=[])
        with tempfile.TemporaryDirectory() as directory, patch.object(build, 'ROOT', Path(directory)), patch.object(build, 'available_reports', return_value=[]), patch.object(build.server, 'get_highest_generation_day', side_effect=LookupError), patch.object(build.server, 'get_current_day', return_value=current), patch.object(daily, 'prepare_forecasts', return_value={'2026-10-23': ready()}):
            output = Path(directory) / 'site'
            build.write_data_bundle(output)
            snapshot = json.loads((output / 'current-day.json').read_text())
            frozen = json.loads((output / 'daily-forecasts/2026-10-23.json').read_text())
        self.assertEqual(len(snapshot['generation_hourly']), 1)
        self.assertEqual(len(snapshot['independent_forecast']['hourly']), 24)
        self.assertEqual(snapshot['independent_forecast'], frozen)


@unittest.skipUnless(HAS_MODELS, 'Install requirements-forecast.txt for scientific model tests')
class ModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import numpy as np
        cls.records, cls.weather = [], dict(hourly={})
        start = dt.date(2026, 6, 1)
        for i in range(100):
            day = (start + dt.timedelta(days=i)).isoformat()
            for h in range(24):
                cls.weather['hourly'][day + f'T{h:02}:00'] = [28 + 3 * np.sin(h / 24 * 6.28), 70, 0, 30, max(0, 500 * np.sin((h - 6) / 24 * 6.28))] * 4
            cls.records.append(dict(operating_date=day, published_date=daily.shift(day, -1), report_id=str(i), source_url='https://example.test/' + day,
                label_basis=daily.TARGET_BASIS,
                actual=[dict(time=f'{h:02}:00', demand=14000 + i * 3 + 500 * np.cos(h / 24 * 6.28), generation=13900 + i * 3 + 500 * np.cos(h / 24 * 6.28)) for h in range(24)],
                temperature_c=30, energy_mwh=330000, availability={}, availability_forecast_date=daily.shift(day, -1)))
        cls.origin = cls.records[-2]['operating_date']

    def test_unpublished_actuals_cannot_affect_any_feature_or_training_labels(self):
        import numpy as np
        from forecast_features import Dataset
        original = Dataset(self.records, self.weather['hourly'])
        changed = copy.deepcopy(self.records)
        for r in changed:
            if r['operating_date'] >= daily.shift(self.origin, 1):
                for row in r['actual']: row['demand'] = row['generation'] = 1e9
        other = Dataset(changed, self.weather['hourly'])
        for target in ('demand', 'generation'):
            np.testing.assert_array_equal(original.strict(self.origin, target), other.strict(self.origin, target))
            np.testing.assert_array_equal(original.daily(self.origin, target), other.daily(self.origin, target))
        self.assertEqual(original.training_days(self.origin), other.training_days(self.origin))
        self.assertLessEqual(max(original.days[d]['published_date'] for d in original.training_days(self.origin)), daily.shift(self.origin, 1))

    def test_seven_models_produce_both_complete_targets_without_pgcb_or_live_data(self):
        before = daily.shift(self.origin, 1) + 'T17:59:59+00:00'
        after = daily.shift(self.origin, 1) + 'T18:00:01+00:00'
        with patch.object(daily, 'utc_now', side_effect=[before, after]):
            result = daily.fit_forecast(self.records, self.weather, self.origin)
        self.assertTrue(daily.valid_forecast(result, self.origin))
        self.assertEqual(result['members'], list(daily.MEMBERS))
        self.assertEqual(len(result['diagnostics']), 12)
        self.assertGreaterEqual(result['training_days'], 35)
        self.assertEqual(result['max_actual_input_date'], daily.shift(self.origin, 2))
        self.assertEqual(result['fit_started_at'], before)
        self.assertEqual(result['issued_at'], after)
        self.assertEqual(result['issue_timing'], 'after operating day began')


if __name__ == '__main__':
    unittest.main()
