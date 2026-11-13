import json
import io
from datetime import datetime
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
        self.assertEqual(args[args.index('--retry')+1], '3')
        self.assertIn('--retry-all-errors', args)
        self.assertEqual(args[args.index('--retry-max-time')+1], '150')
        self.assertEqual(args[args.index('--connect-timeout')+1], '15')
        self.assertIn('--ipv4', args)
        self.assertIn('--http1.1', args)
        self.assertNotIn('--insecure', args)
        self.assertNotIn('-k', args)

    def test_collection_reports_latest_parsed_date_and_new_rows(self):
        seed = ROOT / 'begd/fuel-data.json'
        original = json.loads(seed.read_text())
        latest = original['gas'][-1]
        next_day = dict(latest, date='2099-01-02', url='https://objectstorage.ap-dcc-gazipur-1.oraclecloud15.com/new.pdf')
        listing = f'<a href="{next_day["url"]}">report</a>'.encode()

        def fetched(url):
            if url == fuel.SOURCES['coal']:
                return '<td>2025-2026</td><td>762,752.630</td>'.encode()
            if url.endswith('.pdf'):
                return b'pdf'
            return listing

        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(fuel, 'fetch', side_effect=fetched), \
                patch.object(fuel, 'parse_report', return_value=next_day):
            result = fuel.collect(seed, Path(tmp))
        gas = next(row for row in result['source_status'] if row['source']=='petrobangla')
        self.assertEqual(gas['latest_report_date'], '2099-01-02')
        self.assertEqual(gas['new_reports'], 1)

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

    def test_historical_report_and_changed_ioc_well_counts(self):
        text = (FIXTURES/'petrobangla-13-oct-2020.txt').read_text()
        row = fuel.parse_text(text, 'petrobangla')
        self.assertEqual((row['date'], row['total'], row['state'], row['ioc'], row['lng']),
                         ('2020-10-13', 3163.6, 846.6, 1615.0, 702.0))
        changed = text.replace('Sub-Total 43 1615 1615.0', 'Sub-Total 44 1700 1615.0')
        self.assertEqual(fuel.parse_text(changed, 'petrobangla'), row)

    def test_explicit_two_digit_period_year_and_month_boundary(self):
        text = (FIXTURES/'petrobangla-2-nov.txt').read_text()
        text = text.replace('01-02Nov, 2026', '30 April - 1 May-26')
        self.assertEqual(fuel.parse_text(text, 'petrobangla')['date'], '2026-05-01')

    def test_full_dates_across_year_boundary_and_missing_year(self):
        text = (FIXTURES/'petrobangla-2-nov.txt').read_text()
        full = text.replace('01-02Nov, 2026', '31 Dec 2025 - 01 Jan 2026')
        self.assertEqual(fuel.parse_text(full, 'petrobangla')['date'], '2026-01-01')
        with self.assertRaisesRegex(ValueError, 'reporting period'):
            fuel.parse_text(text.replace('01-02Nov, 2026', '30 June - 1 July'), 'petrobangla')

    def test_reordered_explicit_month_year_in_old_heading(self):
        text = (FIXTURES/'petrobangla-2-nov.txt').read_text()
        text = text.replace('01-02Nov, 2026', '29 - 30 2021 April')
        self.assertEqual(fuel.parse_text(text, 'petrobangla')['date'], '2021-04-30')

    def test_missing_heading_parts_require_matching_internal_pdf_evidence(self):
        text = 'Date : 29 - 30 From 8.00 to 8.00'
        metadata = dict(Title='10.October 2020.xlsx', CreationDate="D:20201030144043+06'00'")
        evidence = fuel.metadata_period(text, metadata)
        self.assertEqual((evidence['start'],evidence['end']), ('2020-10-29','2020-10-30'))
        crossing = fuel.metadata_period('Date : 30 June - 1 July From 8.00 to 8.00',
                                       dict(Title='6. June 2025.xlsx', CreationDate='D:20250701163413'))
        self.assertEqual(crossing['end'],'2025-07-01')
        self.assertIsNone(fuel.metadata_period(text, dict(metadata, CreationDate='D:20201130144043')))
        self.assertIsNone(fuel.metadata_period(text, dict(Title='Generic report', CreationDate='D:20201030144043')))
        self.assertIsNone(fuel.metadata_period('Date : 29 September - 30 October From 8.00 to 8.00', metadata))

    def test_gtcl_four_column_layout_uses_daily_supply_not_instantaneous_flow(self):
        text = (FIXTURES/'gtcl-2-nov.txt').read_text()
        import re
        text = re.sub(r'^(Total Gas Consumption for Power[^\n]*?\)\s*[\d.]+\s+[\d.]+)$', r'\1 881.100 882.200', text, flags=re.M)
        row = fuel.parse_text(text, 'gtcl')
        self.assertEqual(row['power_supply'],880.057)
        self.assertNotEqual(row['power_supply'],881.1)

    def test_truncated_gtcl_report_keeps_national_total_with_missing_power_values(self):
        import re
        text = (FIXTURES/'gtcl-2-nov.txt').read_text()
        text = re.sub(r'^Total Gas Consumption for Power.*$', '', text, flags=re.M)
        row = fuel.parse_text(text, 'gtcl')
        self.assertEqual(row['total'],2561.861)
        self.assertIsNone(row['power_supply'])
        self.assertIsNone(row['power_demand'])

    def spreadsheet(self, cached_total=2642.093, end=None):
        from openpyxl import Workbook
        book = Workbook()
        sheet = book.active
        sheet.title = 'Gas Report'
        for address, value in {
            'B10': datetime(2025,11,9), 'C10': datetime(2025,11,10),
            'F11': ' Reporting Date:', 'H11': end or datetime(2025,11,10),
            'E13': 'Production MMSCF', 'B46': ' H. RLNG Intake: a) MLNG', 'E46':522.145,
            'B47': ' b) SLNG', 'E47':361.127, 'B48':'Total Production (A ... H)', 'E48':cached_total,
            'B284': 'Total Gas Consumption for Power (A..F)', 'C284':2516.1, 'D284':883.4917,
            'F284':884.42018, 'H284':885.34866,
        }.items():
            sheet[address] = value
        stream = io.BytesIO()
        book.save(stream)
        book.close()
        return stream.getvalue()

    def test_gtcl_spreadsheet_uses_named_worksheet_period_and_published_columns(self):
        row = fuel.parse_xlsx(self.spreadsheet(), 'gtcl', 'https://source.xlsx')
        self.assertEqual((row['date'],row['total'],row['lng'],row['power_supply']),
                         ('2025-11-10',2642.093,883.272,883.4917))
        self.assertEqual(row['power_demand'],2516.1)
        self.assertEqual(row['domestic'],1758.821)

    def test_spreadsheet_missing_formula_cache_or_conflicting_dates_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'cached numeric'):
            fuel.parse_xlsx(self.spreadsheet(cached_total='=1+2'), 'gtcl', 'https://source.xlsx')
        with self.assertRaisesRegex(ValueError, 'Inconsistent'):
            fuel.parse_xlsx(self.spreadsheet(end=datetime(2025,11,11)), 'gtcl', 'https://source.xlsx')

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
        self.assertGreaterEqual(len(rows), 2300)
        self.assertEqual([r['date'] for r in rows], sorted(r['date'] for r in rows))
        self.assertLessEqual(rows[0]['date'], '2020-01-12')
        for r in rows:
            self.assertAlmostEqual(r['total'], r['domestic']+r['lng'], delta=.3)
            self.assertTrue(r['url'].startswith('https://objectstorage.'))
            self.assertEqual(len(r['sha256']),64)


if __name__ == '__main__':
    unittest.main()
