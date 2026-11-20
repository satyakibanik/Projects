"""Water-level units, historical archive compatibility, and shifted columns."""
import io
from pathlib import Path
import sys
import unittest

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from water_level import extract_water_level, water_level_summary
from trends import daily_summary, extract_trend_workbook
from test_scripts import workbook, parse


class WaterLevelTests(unittest.TestCase):
    def test_full_parser_separates_water_from_power_plants(self):
        book = workbook()
        sheet = book['GenLog']
        sheet['FG11'] = 'Water Level'
        sheet['FG13'] = 102.47
        sheet['FG14'] = 102.46
        report = parse(book)
        self.assertNotIn('Water Level', [p['name'] for p in report['plant_units']])
        self.assertEqual(report['water_level']['source_range'], 'GenLog!FG13:FG37')
        summary = daily_summary(report)['water_level']
        self.assertEqual(summary['mean_ft_msl'], 102.465)
        self.assertEqual(summary['hours'], 2)

    def test_moved_columns_case_insensitive_sheet_and_recovery_parser(self):
        for column in ['FG', 'FI']:
            book = workbook()
            sheet = book['GenLog']
            sheet.title = 'temporary'
            sheet.title = 'genlog'
            sheet[f'{column}11'] = ' Water Level '
            sheet[f'{column}13'] = 100
            sheet[f'{column}14'] = 102
            sheet[f'{column}15'] = True
            sheet[f'{column}16'] = '103'
            sheet[f'{column}17'] = -1
            output = io.BytesIO()
            book.save(output)
            report = extract_trend_workbook(output.getvalue(), {'id':'1', 'published_date':'2026-10-15', 'download_url':'source'})
            self.assertEqual(daily_summary(report)['water_level']['mean_ft_msl'], 101)
            self.assertEqual(daily_summary(report)['water_level']['hours'], 2)
            self.assertEqual(report['water_level']['source_range'], f'genlog!{column}13:{column}37')

    def test_archive_compatibility_and_half_hour_not_double_weighted(self):
        hourly = [{'time':'00:00', 'mw':100}, {'time':'01:00','mw':104}, {'time':'19:30','mw':999},
                  {'time':'02:00','mw':None}, {'time':'03:00','mw':float('inf')}, {'time':'04:00','mw':False}]
        old = {'date':'2026-10-24','plant_units':[{'name':'Water Level','hourly':hourly}, {'name':'Hydro','hourly':[{'time':'00:00','mw':230}]}]}
        summary = water_level_summary(old)
        self.assertEqual(summary['mean_ft_msl'], 102)
        self.assertEqual(summary['hours'], 2)
        modern = {'date':old['date'], 'water_level':{'hourly':[{'time':r['time'],'level_ft_msl':r['mw']} for r in hourly]}}
        self.assertEqual(water_level_summary(modern), summary)

    def test_missing_zero_and_original_anomaly_remain_distinct(self):
        self.assertIsNone(water_level_summary({'date':'2026-10-24'})['mean_ft_msl'])
        self.assertIsNone(extract_water_level(openpyxl.Workbook()))
        report = {'date':'2026-09-24','water_level':{'hourly':[{'time':'21:00','level_ft_msl':106.02}, {'time':'22:00','level_ft_msl':160.02}]}}
        result = water_level_summary(report)
        self.assertEqual(result['mean_ft_msl'], 133.02)
        self.assertEqual(result['max_ft_msl'], 160.02)
        self.assertIn('retained unchanged', result['source_notes'][0])
        report['water_level']['hourly'] = [{'time':'00:00','level_ft_msl':0}]
        self.assertEqual(water_level_summary(report)['mean_ft_msl'], 0)
        self.assertEqual(water_level_summary(report)['hours'], 1)


if __name__ == '__main__':
    unittest.main()
