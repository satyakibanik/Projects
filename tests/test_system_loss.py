"""Annual source parsing, slow refresh and last successful snapshot contracts."""
import datetime as dt
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
import system_loss as loss

HTML = '<table><tr><th>অর্থবছর</th>' + '<th>Loss</th>' * 9 + '</tr><tr><td>২০২৪-২৫</td>' + ''.join('<td>' + v + '</td>' for v in ['৬.৬৮%', '8.51%', '5.6', '5.48', '7.26', '', '7.38', '3.04', '10.13']) + '</tr></table>'
NOW = dt.datetime(2026, 10, 30, tzinfo=dt.timezone.utc)

class SystemLossTests(unittest.TestCase):
    def test_bengali_years_digits_percent_and_missing_values(self):
        row = loss.parse_system_loss(HTML)[0]
        self.assertEqual(row['fiscal_year'], '2024-25')
        self.assertEqual(row['BPDB'], 6.68)
        self.assertIsNone(row['NESCO'])
        self.assertEqual(row['TRANSMISSION & DISTRIBUTION'], 10.13)

    def test_rejects_wrong_layout_and_invalid_percentages(self):
        for html in [HTML.replace('অর্থবছর', 'unrelated'), HTML.replace('8.51%', '101%'), HTML.replace('8.51%', 'NaN'), HTML.replace('<td>8.51%</td>', '')]:
            with self.assertRaises(ValueError):
                loss.parse_system_loss(html)

    def test_collect_fetches_once_per_30_days_and_retains_good_data_on_failure(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(loss, 'SEED', pathlib.Path(directory) / 'missing'), patch.object(loss, 'fetch_system_loss', return_value=loss.parse_system_loss(HTML)) as fetch:
            first = loss.collect(directory, NOW)
            self.assertEqual(first['status'], 'ok')
            self.assertEqual(loss.collect(directory, NOW + dt.timedelta(days=29)), first)
            self.assertEqual(fetch.call_count, 1)
            fetch.side_effect = TimeoutError('offline')
            stale = loss.collect(directory, NOW + dt.timedelta(days=30))
            self.assertEqual(stale['data'], first['data'])
            self.assertEqual(stale['fetched_at'], first['fetched_at'])
            self.assertEqual(stale['status'], 'stale')
            self.assertEqual(loss.collect(directory, NOW + dt.timedelta(days=31)), stale)
            self.assertEqual(fetch.call_count, 2)

    def test_invalid_refresh_cannot_replace_last_successful_data(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(loss, 'SEED', pathlib.Path(directory) / 'missing'), patch.object(loss, 'fetch_system_loss', return_value=loss.parse_system_loss(HTML)) as fetch:
            first = loss.collect(directory, NOW)
            fetch.return_value = []
            stale = loss.collect(directory, NOW + dt.timedelta(days=31))
            self.assertEqual(stale['data'], first['data'])
            self.assertEqual(stale['status'], 'stale')

    def test_failure_without_snapshot_is_explicit(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(loss, 'SEED', pathlib.Path(directory) / 'missing'), patch.object(loss, 'fetch_system_loss', side_effect=TimeoutError):
            result = loss.collect(directory, NOW)
            self.assertEqual(result['status'], 'unavailable')
            self.assertEqual(result['data'], [])

    def test_build_and_workflow_include_independent_monthly_bundle(self):
        root = pathlib.Path(__file__).resolve().parents[1]
        build = (root / 'scripts/build_pages_data.py').read_text()
        self.assertIn('write_system_loss_bundle(output / "begd")', build)
        self.assertIn('path: .cache/system-loss', (root / '.github/workflows/pages.yml').read_text())

if __name__ == '__main__':
    unittest.main()
