"""Entity histories must retain measurement bases, missing data and archive precedence."""
import datetime as dt
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from entity_history import plant_rows, station_rows, write_entity_history


def unit(**changes):
    row = dict(name='Example Unit 1 (Gas)', installed_capacity_mw=200, present_capacity_mw=180,
               peak_generation_mw=150, energy_mwh=2400,
               hourly=[dict(time=f'{hour:02}:00', mw=100 if hour < 12 else 0) for hour in range(24)])
    row.update(changes)
    return row


class EntityHistoryTests(unittest.TestCase):
    def test_metrics_use_installed_capacity_and_sample_based_operating_hours(self):
        row = list(plant_rows(dict(plant_units=[unit()])))[0]
        self.assertEqual(row['installed_capacity_mw'], 200)
        self.assertEqual(row['present_capacity_mw'], 180)
        self.assertEqual(row['capacity_factor_pct'], 50)
        self.assertEqual(row['puf_pct'], 100)
        self.assertEqual(row['operating_hours_estimate'], 12)
        self.assertEqual(row['utilization_ratio_pct'], 75)

    def test_no_substitution_for_installed_capacity_and_partial_puf_is_missing(self):
        row = list(plant_rows(dict(plant_units=[unit(installed_capacity_mw=None)])))[0]
        for field in ['installed_capacity_mw', 'capacity_factor_pct', 'puf_pct', 'utilization_ratio_pct']:
            self.assertIsNone(row[field])
        row = list(plant_rows(dict(plant_units=[unit(hourly=unit()['hourly'][:-1])])))[0]
        self.assertIsNone(row['puf_pct'])
        self.assertIsNone(row['operating_hours_estimate'])
        self.assertEqual(row['capacity_factor_pct'], 50)

    def test_real_zero_is_preserved_and_zero_hours_have_no_puf(self):
        row = list(plant_rows(dict(plant_units=[unit(peak_generation_mw=0, energy_mwh=0,
            hourly=[dict(time=f'{hour:02}:00', mw=0) for hour in range(24)])])))[0]
        self.assertEqual(row['capacity_factor_pct'], 0)
        self.assertEqual(row['utilization_ratio_pct'], 0)
        self.assertIsNone(row['puf_pct'])

    def test_p2_join_keeps_dual_fuel_units_separate_and_includes_p2_only_plants(self):
        rows = list(plant_rows(dict(plants=[dict(name='Example Unit 1', installed_capacity_mw=200),
            dict(name='P2 only', present_capacity_mw=50)],
            plant_units=[unit(), unit(name='Example Unit 1 (HFO)', installed_capacity_mw=None)])))
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[1]['installed_capacity_mw'], 200)
        self.assertEqual(rows[2]['name'], 'P2 only')
        self.assertIsNone(rows[2]['peak_generation_mw'])

    def test_p2_import_routes_are_not_listed_as_plants(self):
        rows = list(plant_rows(dict(plants=[dict(name=name) for name in
            ['Adani Power Jharkhanda Ltd', 'Bheramara (HVDC)', 'Import (Tripura)', 'HVDC(Nepal)', 'Domestic Plant']])))
        self.assertEqual([row['name'] for row in rows], ['Domestic Plant'])

    def test_voltage_classes_are_separate_and_load_only_stations_remain(self):
        rows = list(station_rows(dict(voltages=[dict(name='Alpha', voltage_class=klass, min_kv=low, max_kv=high)
            for klass, low, high in [('132 kV', 120, 135), ('230 kV', 215, 235)]],
            substations=[dict(name='Alpha', load_mw=0), dict(name='Load only', load_mw=30)])))
        self.assertEqual(len(rows), 3)
        self.assertEqual([row['min_kv'] for row in rows], [120, 215, None])
        self.assertEqual([row['load_mw'] for row in rows], [0, 0, 30])

    def test_invalid_voltage_and_missing_load_are_not_fabricated(self):
        row = list(station_rows(dict(voltages=[dict(name='Alpha', voltage_class='132 kV', min_kv=140, max_kv=130)])))[0]
        self.assertIsNone(row['min_kv'])
        self.assertIsNone(row['max_kv'])
        self.assertIsNone(row['load_mw'])

    def test_calendar_window_duplicate_precedence_and_national_only_exclusion(self):
        end = dt.date(2026, 10, 24)
        reports = [dict(date=end.isoformat(), published_date=date, report_id=report_id,
                        plant_units=[unit(peak_generation_mw=peak)])
                   for date, report_id, peak in [('2026-10-26', '3', 130), ('2026-10-25', '1', 140), ('2026-10-25', '2', 150)]]
        reports += [dict(date=(end-dt.timedelta(days=365)).isoformat(), report_id='4', plant_units=[unit(name='Too old')]),
                    dict(date=(end-dt.timedelta(days=1)).isoformat(), report_id='5', _trends_only=True, plant_units=[unit(name='Invalid recovery')])]
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            index = write_entity_history(reports, root, 'now')
            self.assertEqual(len(index['plants']), 1)
            self.assertEqual(index['sources'][end.isoformat()]['report_id'], '2')
            entity = json.loads((root/'plants'/f'{index["plants"][0]["id"]}.json').read_text())
            self.assertEqual(len(entity['days']), 1)
            self.assertEqual(entity['days'][0]['peak_generation_mw'], 150)
            self.assertEqual(index['plants'][0]['available_through']['peak_generation_mw'], end.isoformat())
            self.assertEqual(json.loads((root/'index.json').read_text())['version'], 1)

    def test_empty_history_is_a_valid_index(self):
        with tempfile.TemporaryDirectory() as folder:
            index = write_entity_history([], Path(folder), 'now')
            self.assertIsNone(index['end_date'])
            self.assertEqual(index['plants'], [])

    def test_availability_keeps_last_valid_metric_day_when_latest_reading_is_missing(self):
        reports = [dict(date='2026-10-01', report_id='1', plant_units=[unit()]),
                   dict(date='2026-10-24', report_id='2', plant_units=[unit(peak_generation_mw=None, hourly=[])])]
        with tempfile.TemporaryDirectory() as folder:
            meta = write_entity_history(reports, Path(folder), 'now')['plants'][0]
            self.assertIsNone(meta['latest']['peak_generation_mw'])
            self.assertIsNone(meta['latest']['puf_pct'])
            self.assertEqual(meta['available_through']['peak_generation_mw'], '2026-10-01')
            self.assertEqual(meta['available_through']['puf_pct'], '2026-10-01')
            self.assertEqual(meta['available_through']['installed_capacity_mw'], '2026-10-24')


if __name__ == '__main__':
    unittest.main()
