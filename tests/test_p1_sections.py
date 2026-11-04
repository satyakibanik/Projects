"""P1 section movement must preserve region identity, measured zero, and missingness."""
from pathlib import Path
import sys
import unittest

import openpyxl
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from p1_sections import regional_snapshot,east_west_totals,p1_sections_cache_current
from test_scripts import workbook,parse


def sections(sheet, offset=0):
    sheet.cell(59+offset,4,'Zone-wise Load-shed and Demand Summary (MW) at evening peak Hour (19:30 Hr.)')
    for col,label in [(5,'Zone'),(7,'Load-Shed'),(9,'Demand')]:sheet.cell(60+offset,col,label)
    # Deliberately shuffled: the generation table's first region must match by name.
    for row,name,shed,demand in [(61,'Region 18',0,250),(62,'Region 17',2,500),(63,'Total',2,750)]:
        for col,value in [(5,name),(7,shed),(9,demand)]:sheet.cell(row+offset,col,value)
    for row,label,unit,value in [(54,'Energy Flow from East to West:','KWHr:',0),(55,'Energy Flow from West to East:','KWHr:',45199472.73),(56,'Power Flow during Peak Demand (W-E):','MW:',1680),(57,'Maximum Power Flow (W-E):','MW:',2454)]:
        for col,v in [(1,label),(4,unit),(5,value),(7,'Import through another circuit'),(10,'MKWHr:'),(11,99)]:sheet.cell(row+offset,col,v)


class P1SectionsTests(unittest.TestCase):
    def test_full_parser_handles_shifted_rows_and_matches_region_names(self):
        for offset in [0,1,5]:
            with self.subTest(offset=offset):
                book=workbook();sections(book['P1'],offset)
                r=parse(book)
                self.assertEqual(r['regions'][0]['demand_mw'],500)
                self.assertEqual(r['regions'][0]['shed_mw'],2)
                self.assertEqual(r['regions'][1]['demand_mw'],250)
                self.assertEqual(r['regions'][1]['shed_mw'],0)
                self.assertIsNone(r['regions'][2]['demand_mw'])
                self.assertEqual(r['regional_snapshot']['time'],'19:30')
                self.assertEqual(r['operations']['east_west']['energy_east_to_west_kwh'],0)
                self.assertEqual(r['operations']['east_west']['energy_west_to_east_kwh'],45199472.73)
                self.assertEqual(r['operations']['east_west']['peak_west_to_east_mw'],1680)
                self.assertEqual(r['operations']['east_west']['max_west_to_east_mw'],2454)
                self.assertEqual(r['operations']['east_west']['cells']['energy_west_to_east_kwh'],f'E{55+offset}')

    def test_missing_energy_never_reads_a_neighboring_import_value(self):
        sheet=openpyxl.Workbook().active;sections(sheet);sheet['E55']=None
        self.assertIsNone(east_west_totals(sheet)['energy_west_to_east_kwh'])
        sheet['D54']='MWh:';sheet['E54']=12
        self.assertEqual(east_west_totals(sheet)['energy_east_to_west_kwh'],12000)

    def test_missing_sections_are_unavailable(self):
        sheet=openpyxl.Workbook().active
        self.assertEqual(regional_snapshot(sheet)['readings'],{})
        self.assertIsNone(east_west_totals(sheet)['energy_west_to_east_kwh'])

    def test_cache_migration_reparses_affected_nuclear_layout(self):
        self.assertFalse(p1_sections_cache_current({'fuels':{'Nuclear':0}}))
        self.assertTrue(p1_sections_cache_current({'fuels':{'Nuclear':0},'p1_sections_version':2}))
        self.assertTrue(p1_sections_cache_current({'fuels':{'Gas':1000}}))
