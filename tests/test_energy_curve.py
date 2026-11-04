"""En-Curve layout changes must preserve published energy and source readings."""
import datetime as dt
import io
from pathlib import Path
import sys
import unittest

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from energy_curve import extract_energy_curve, energy_curve_cache_current
from test_scripts import workbook, parse


def curve(book, nuclear=False, total_column=21, unit='MKWHr', date='30-10-2026'):
    sheet = book.create_sheet('En-Curve')
    sheet['B2'] = date
    headers = ['Gas-Public', 'Gas-Pvt', 'HVDC', 'Nepal', 'Tripura', 'Adani', 'Hydro', 'Coal', 'Solar', 'HFO-Public', 'HFO-Pvt', 'HSD-Public', 'HSD-Pvt', 'Wind']
    if nuclear:
        headers.append('Nuclear')
    headers.append('Shortage')
    sheet['A3'] = 'TIME'
    for column, name in enumerate(headers, 2):
        sheet.cell(3, column, name)
        for index in range(48):
            sheet.cell(4 + index, column, 1 if name == 'Shortage' else 100 if name == 'Gas-Public' else 0)
    for index in range(48):
        sheet.cell(4 + index, 1, f'{index // 2:02}:{index % 2 * 30:02}')
    for row, label, total in [(7, 'Energy Generated', 2.4), (8, 'Energy not Served', .024), (9, 'Total Energy Requirement', 2.424)]:
        sheet.cell(row, total_column - 3, label)
        sheet.cell(row, total_column, total)
        sheet.cell(row, total_column + 4, unit)
    return sheet


class EnergyCurveTests(unittest.TestCase):
    def test_old_and_new_layouts_through_full_parser(self):
        for date, nuclear, column in [('30-10-2026', False, 21), ('31-10-2026', True, 22), ('01-11-2026', True, 22), ('02-11-2026', True, 22)]:
            with self.subTest(date=date):
                book = workbook()
                book['P1']['D6'] = dt.datetime.strptime(date, '%d-%m-%Y')
                curve(book, nuclear=nuclear, total_column=column, date=date)
                result = parse(book)['en_curve']
                self.assertEqual(result['totals'], dict(energy_generated_mwh=2400, energy_not_served_mwh=24, total_requirement_mwh=2424))
                self.assertEqual(len(result['hourly']), 48)
                self.assertEqual(result['hourly'][0]['gas_public_mw'], 100)
                self.assertEqual(result['hourly'][0]['shortage_mw'], 1)
                self.assertEqual(result['total_cells']['energy_generated_mwh'], f'{openpyxl.utils.get_column_letter(column)}7')
                self.assertEqual(any(s['key'] == 'nuclear_mw' for s in result['sources']), nuclear)

    def test_labels_can_move_and_units_are_explicit(self):
        for unit, factor in [('MKWHr', 1000), ('GWh', 1000), ('MWh', 1), ('kWh', .001)]:
            book = openpyxl.Workbook()
            result = extract_energy_curve(curve(book, total_column=26, unit=unit))
            self.assertAlmostEqual(result['totals']['energy_generated_mwh'], 2.4 * factor)

    def test_another_inserted_source_moves_totals_without_losing_columns(self):
        book = openpyxl.Workbook(); sheet = curve(book, nuclear=True, total_column=22)
        sheet.insert_cols(3)
        sheet['C3'] = 'New source'
        for row in range(4, 52):
            sheet.cell(row, 3, 0)
        result = extract_energy_curve(sheet)
        self.assertEqual(result['sources'][1]['key'], 'new_source_mw')
        self.assertEqual(result['hourly'][0]['gas_public_mw'], 100)
        self.assertEqual(result['total_cells']['energy_generated_mwh'], 'W7')
        self.assertEqual(result['totals']['energy_generated_mwh'], 2400)

    def test_missing_or_inconsistent_totals_fail_validation(self):
        for value in [None, 'unavailable', -1, 3.0]:
            with self.subTest(value=value):
                book = openpyxl.Workbook(); sheet = curve(book)
                sheet['U9'] = value
                with self.assertRaises(ValueError):
                    extract_energy_curve(sheet)

    def test_missing_source_reading_is_not_fabricated_as_zero(self):
        book = openpyxl.Workbook(); sheet = curve(book)
        sheet['B4'] = None
        result = extract_energy_curve(sheet)
        self.assertIsNone(result['hourly'][0]['gas_public_mw'])
        self.assertIsNone(result['hourly'][0]['total_generation_mw'])

    def test_affected_cache_is_reparsed_and_zero_totals_remain_valid(self):
        self.assertFalse(energy_curve_cache_current({'en_curve': {'totals': {'energy_generated_mwh': None}}}))
        self.assertTrue(energy_curve_cache_current({'en_curve': {'totals': dict.fromkeys(['energy_generated_mwh', 'energy_not_served_mwh', 'total_requirement_mwh'], 0)}}))
        self.assertTrue(energy_curve_cache_current({}))
