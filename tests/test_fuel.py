import json
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fuel

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'tests/fixtures/fuel'


class FuelTests(unittest.TestCase):
    def test_fetch_preserves_curl_exit_and_complete_stderr(self):
        url = fuel.SOURCES['petrobangla']
        message = b'curl: (60) SSL certificate problem: unable to get local issuer certificate\n' + b'diagnostic ' * 30
        with patch.object(fuel.subprocess, 'run', side_effect=subprocess.CalledProcessError(60, ['curl'], stderr=message)) as run:
            with self.assertRaises(fuel.FuelFetchError) as caught:
                fuel.fetch(url)
        error = caught.exception
        self.assertEqual(error.details(), {'url':url, 'curl_exit_code':60, 'stderr':message.decode()})
        self.assertIn('unable to get local issuer certificate', str(error))
        args = run.call_args.args[0]
        self.assertIn('--show-error', args)
        self.assertIn('=https', args)
        self.assertNotIn('--insecure', args)
        self.assertNotIn('-k', args)

    def test_collection_retains_structured_timeout_and_saved_reports(self):
        seed = ROOT / 'begd/fuel-data.json'
        original = json.loads(seed.read_text())
        message = 'curl: (28) Connection timed out after 35000 milliseconds\n'
        with tempfile.TemporaryDirectory() as tmp, patch.object(fuel, 'fetch', side_effect=fuel.FuelFetchError(fuel.SOURCES['gtcl'],28,message)):
            result = fuel.collect(seed, Path(tmp))
            persisted = json.loads((Path(tmp)/'fuel-data.json').read_text())
        self.assertEqual(result['gas'], original['gas'])
        self.assertEqual(result['last_successful_refresh_at'], original['last_successful_refresh_at'])
        for row in persisted['source_status']:
            self.assertEqual(row['error_details'][0]['curl_exit_code'],28)
            self.assertEqual(row['error_details'][0]['stderr'],message)
            self.assertIn('Connection timed out',row['errors'][0])

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
        self.assertEqual(len(rows), 100)
        for r in rows:
            self.assertAlmostEqual(r['total'], r['domestic']+r['lng'], delta=.3)
            self.assertTrue(r['url'].startswith('https://objectstorage.'))
            self.assertEqual(len(r['sha256']),64)


if __name__ == '__main__':
    unittest.main()
