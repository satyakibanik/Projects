import datetime as dt
import importlib.util
import pathlib
import unittest


SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "collect_legacy_insight.py"
SPEC = importlib.util.spec_from_file_location("collect_legacy_insight", SCRIPT)
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)


class LegacyInsightCollectorTests(unittest.TestCase):
    def test_fuel_assumptions_normalize_dual_fuel_order(self):
        self.assertEqual(collector.clean_fuel("Gas / HFO"), ("Dual fuel", 5.5))
        self.assertEqual(collector.clean_fuel("HSD/Gas"), ("Dual fuel", 5.5))
        self.assertEqual(collector.clean_fuel("Furnace Oil"), ("HFO", 0.7))
        self.assertEqual(collector.clean_fuel("Hydro"), ("Hydro", 3.5))

    def test_hour_labels_keep_day_end_and_drop_half_hour_points(self):
        self.assertEqual(collector.time_label("24:00"), "24:00")
        self.assertEqual(collector.time_label(dt.time(1, 0)), "01:00")
        self.assertIsNone(collector.time_label(dt.time(18, 30)))

    def test_archive_title_date_is_publication_date(self):
        url = "https://erp.powergrid.gov.bd/file?title=Daily%20Report%2025-01-18"
        date, title = collector.parse_published_date(url)
        self.assertEqual(date, dt.date(2018, 1, 25))
        self.assertIn("Daily Report", title)

    def test_compact_rows_keep_fixed_fuel_category_order(self):
        point = dict(time="01:00", plants=2, h=4.5, capacity=200,
                     fuelCounts={"Gas": 1, "Coal": 1},
                     fuelCapacity={"Gas": 100, "Coal": 100})
        row = collector.compact([point])[0]
        self.assertEqual(row[:4], ["01:00", 2, 4.5, 200])
        self.assertEqual(row[4][0:2], [1, 1])
        self.assertEqual(row[5][0:2], [100, 100])


if __name__ == "__main__":
    unittest.main()
