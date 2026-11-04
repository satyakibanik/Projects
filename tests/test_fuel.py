import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fuel

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'tests/fixtures/fuel'


class FuelTests(unittest.TestCase):
    def test_conflicting_archive_dates_are_not_arbitrarily_selected(self):
        first = dict(date='2026-06-20', total=2703.8, url='https://one.pdf', sha256='a')
        second = dict(first, total=2702.5, url='https://two.pdf', sha256='b')
        rows, conflicts = fuel.merge_reports([], [first, second])
        self.assertEqual(rows, [])
        self.assertEqual(conflicts, [{'date': '2026-06-20', 'urls': ['https://one.pdf', 'https://two.pdf']}])
        rows, conflicts = fuel.merge_reports([first], [second])
        self.assertEqual(rows, [first])
        self.assertEqual(len(conflicts), 1)

    def test_identical_values_from_duplicate_pdfs_keep_one_provenance(self):
        first = dict(date='2026-06-20', total=2703.8, url='https://one.pdf', sha256='a')
        second = dict(first, url='https://two.pdf', sha256='b')
        rows, conflicts = fuel.merge_reports([], [first, second])
        self.assertEqual(rows, [first])
        self.assertEqual(conflicts, [])

    def report(self, name, source):
        return fuel.parse_text((FIXTURES / name).read_text(), source)

    def test_supplied_report_pairs_and_components(self):
        for name, date, total, gtcl, power in [
            ('27-oct', '2026-10-27', 2539.1, 2539.0713, 830.8),
            ('2-nov', '2026-11-02', 2561.9, 2561.8610, 932.1),
        ]:
            p = self.report(f'petrobangla-{name}.txt', 'petrobangla')
            g = self.report(f'gtcl-{name}.txt', 'gtcl')
            self.assertEqual((p['date'], g['date']), (date, date))
            self.assertEqual(p['total'], total)
            self.assertEqual(g['total'], gtcl)
            self.assertLess(abs(p['total'] - g['total']), .05)
            self.assertEqual(p['power_supply'], power)
            self.assertEqual(g['power_supply'], 838.110 if name == '27-oct' else 880.057)
            self.assertAlmostEqual(p['total'], p['domestic'] + p['lng'], delta=.11)
        p = self.report('petrobangla-27-oct.txt', 'petrobangla')
        g = self.report('gtcl-27-oct.txt', 'gtcl')
        # National agreement must not erase real component discrepancies.
        self.assertGreater(abs(p['domestic'] - g['domestic']), .09)

    def test_month_boundary_uses_period_end_not_upload_date(self):
        text = (FIXTURES / 'petrobangla-2-nov.txt').read_text()
        text = text.replace('01-02Nov, 2026', '31 Oct - 01 Nov 2026')
        self.assertEqual(fuel.parse_text(text, 'petrobangla')['date'], '2026-11-01')

    def test_missing_columns_and_bad_totals_are_rejected(self):
        text = (FIXTURES / 'petrobangla-2-nov.txt').read_text()
        with self.assertRaises(ValueError):
            fuel.parse_text(text.replace('2561.9', '3561.9'), 'petrobangla')
        with self.assertRaises(ValueError):
            fuel.parse_text('A new unsupported report format', 'petrobangla')

    def test_coal_bengali_digits_and_annual_units(self):
        rows = fuel.parse_coal('<td>২০২৫-২০২৬</td><td>৭,৬২,৭৫২.৬৩০</td>')
        self.assertEqual(rows, [{'year':'2025–2026', 'tonnes':762752.630}])

    def test_failed_collection_keeps_seed_with_visible_failure(self):
        seed = ROOT / 'begd/fuel-data.json'
        original = json.loads(seed.read_text())
        with tempfile.TemporaryDirectory() as tmp, patch.object(fuel, 'fetch', side_effect=OSError('offline')):
            result = fuel.collect(seed, Path(tmp))
        self.assertEqual(result['gas'], original['gas'])
        self.assertEqual(result['checks'], original['checks'])
        self.assertTrue(all(r['status']=='failed' for r in result['source_status']))
        self.assertEqual(result['last_successful_refresh_at'], original['last_successful_refresh_at'])

    def test_saved_data_has_unique_dates_provenance_and_reconciles(self):
        bundle = json.loads((ROOT / 'begd/fuel-data.json').read_text())
        rows = bundle['gas']
        self.assertEqual(len(rows), len({r['date'] for r in rows}))
        self.assertGreaterEqual(len(rows), 365)
        self.assertEqual([r['date'] for r in rows], sorted(r['date'] for r in rows))
        self.assertLess(rows[0]['date'], '2026-01-01')
        for r in rows:
            self.assertAlmostEqual(r['total'], r['domestic']+r['lng'], delta=.3)
            self.assertTrue(r['url'].startswith('https://objectstorage.'))
            self.assertEqual(len(r['sha256']),64)


if __name__ == '__main__':
    unittest.main()
