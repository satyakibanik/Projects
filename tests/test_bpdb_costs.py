"""BPDB date, units and reconciliation are financial-data correctness checks."""
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
from bpdb_costs import parse_pdf, parse_cost_text, ArchiveParser, collect

SOURCE = 'https://misc.bpdb.gov.bd/storage/daily_archive/page_1_20261026_20261027094839.pdf'


class CostsTests(unittest.TestCase):
    def test_real_pdf_uses_printed_date_not_filename_and_preserves_taka(self):
        content = (pathlib.Path(__file__).parent/'fixtures/bpdb/page_1_20261026.pdf').read_bytes()
        row = parse_pdf(content, SOURCE, '2026-10-26')
        self.assertEqual(row['date'], '2026-10-25')
        self.assertEqual(row['total_bdt'], 2490660278)
        self.assertEqual(row['costs_bdt']['HSD'], 0)
        self.assertEqual(row['costs_bdt']['Gas'], 400216748.7)
        self.assertEqual(row['production_cost_per_kwh'], 7.45341)
        self.assertEqual(row['generation_kwh']['Gas'], 112060000)
        self.assertEqual(row['generation_kwh']['HSD'], 0)
        self.assertIn('0.01 MKWh', row['generation_basis'])
        self.assertEqual(row['currency'], 'BDT')
        self.assertEqual(row['source_url'], SOURCE)

    def test_overprinted_pdf_characters_are_deduplicated_before_parsing(self):
        # The source draws the HFO and import text twice at the same coordinates.
        content = (pathlib.Path(__file__).parent/'fixtures/bpdb/page_1_20260320.pdf').read_bytes()
        row = parse_pdf(content, archive_date='2026-03-20')
        self.assertEqual(row['date'], '2026-03-19')
        self.assertEqual(row['costs_bdt']['HFO'], 46899454.04)
        self.assertEqual(row['total_bdt'], 1193996748)

    def test_all_heading_aliases_and_indian_digit_grouping(self):
        for heading in ['Cost of the Consumed Fuel (PDB+Pvt):', 'Fuel cost :']:
            row = parse_cost_text('Actual data of 25.10.26(Yesterday)\n'+heading+'\nGas : Tk10 Coal : Tk20 Oil : Tk0\nTotal : Tk30', archive_date='2026-10-26')
            self.assertEqual(row['total_bdt'], 30)
            self.assertEqual(row['date'], '2026-10-25')
            self.assertEqual(row['costs_bdt']['Oil'], 0)
            self.assertNotIn('HFO', row['costs_bdt'])
            self.assertEqual(row['generation_kwh'], {})
        row = parse_cost_text('Date : 25-10-2026\nProduction Cost (Tk.)\nGas 100 Hydro 0\nCoal 100 Solar 0\nHFO 1234367 Import 0\nHSD 0 Wind 0\nTotal: 12,34,567 Tk.')
        self.assertEqual(row['total_bdt'], 1234567)

    def test_energy_table_without_grand_total_column_keeps_its_explicit_units(self):
        text = ('Date : 25-10-2026\nZone-wise Generation Summary (MKWHr.)\n'
                'Gas Coal HFO HSD Hydro Solar Import Wind\nTotal 1 2 3 0 1 1 1 1\n'
                'Production Cost (Tk.)\nGas 10 Hydro 10\nCoal 20 Solar 10\nHFO 30 Import 10\nHSD 0 Wind 10\nTotal: 100 Tk.')
        row = parse_cost_text(text)
        self.assertEqual(row['generation_kwh']['Coal'], 2000000)
        self.assertEqual(row['generation_kwh']['HSD'], 0)
        row = parse_cost_text('Energy Generated 100 MKWHr.\n'+text)
        self.assertEqual(row['generation_kwh'], {})

    def test_invalid_dates_incomplete_breakdowns_and_bad_totals_rejected(self):
        base = 'Actual data of 25.10.26(Yesterday)\nFuel cost :\nGas=10 Coal=20 Oil=30 Total=60 Taka'
        for text in [base.replace('25.10.26','31.02.26'),base.replace('Actual data of 25.10.26(Yesterday)','Date:26-10-2026'),base.replace('Oil=30',''),base.replace('Total=60','Total=600'),base.replace('Gas=10','Gas=#REF!')]:
            with self.assertRaises(ValueError): parse_cost_text(text)
        with self.assertRaises(ValueError): parse_cost_text(base, archive_date='2026-10-20')

    def test_archive_discovers_only_page_one_links_and_explicit_dates(self):
        parser=ArchiveParser()
        parser.feed('<tr><td>1</td><td>26/10/2026</td><td><a href="/storage/daily_archive/a.pdf">Download</a></td><td><a href="/storage/daily_archive/page2.pdf">Download</a></td></tr>')
        self.assertEqual(parser.rows, [dict(archive_date='2026-10-26', source_url='https://misc.bpdb.gov.bd/storage/daily_archive/a.pdf')])

    def test_archive_outage_preserves_validated_costs_and_retries(self):
        with tempfile.TemporaryDirectory() as tmp:
            previous=dict(days=[dict(date='2026-10-25',total_bdt=10)],parser_version=1,refreshed_at=0)
            pathlib.Path(tmp,'costs.json').write_text(json.dumps(previous))
            with patch('bpdb_costs.fetch',side_effect=RuntimeError('offline')):
                result=collect(tmp)
            self.assertEqual(result['days'],previous['days'])
            self.assertEqual(result['refreshed_at'],0)
            self.assertEqual(len(result['errors']),1)

if __name__ == '__main__': unittest.main()
