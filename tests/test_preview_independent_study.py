import csv
import json
from pathlib import Path
import tempfile
import unittest

from scripts.preview_independent_study import build_bundle, pgcb_scenarios


class IndependentPreviewTests(unittest.TestCase):
    def study(self, root):
        methods = ['Earlier choice', 'Evaluation winner']
        summary = dict(model_registry=methods, champions=[dict(window='development', target=t,
            model=methods[0], evaluation_dates=['2026-10-21']) for t in ('demand', 'generation')],
            forecast_dates=['2026-10-23'], windows={}, availability='D+1 assumed',
            completed_at='2026-10-23T02:00:00Z', model_count=2)
        (root/'summary.json').write_text(json.dumps(summary))
        predictions = {day:{t:{m:[100+i for i in range(24)] for m in methods}
            for t in ('demand', 'generation')} for day in ('2026-10-21', '2026-10-23')}
        (root/'predictions.json').write_text(json.dumps(predictions))
        (root/'actuals.json').write_text(json.dumps({'2026-10-21':dict(demand=[110]*24,
            supply=[109]*24, generation=[120]*24)}))
        with (root/'scores.csv').open('w') as stream:
            writer = csv.DictWriter(stream, fieldnames=['window', 'target', 'model', 'selected',
                'mae_mw', 'rmse_mw', 'wape_pct', 'bias_mw', 'selection_mae_mw', 'improvement_vs_weekly_pct'])
            writer.writeheader()
            for target in ('demand', 'generation'):
                for i, model in enumerate(methods):
                    writer.writerow(dict(window='development', target=target, model=model,
                        selected=i==0, mae_mw=20-i*10, rmse_mw=25, wape_pct=2, bias_mw=1,
                        selection_mae_mw=5+i, improvement_vs_weekly_pct=3))
        return root

    def test_pgcb_uses_forecast_header_date_not_workbook_actual_or_availability_date(self):
        records = [dict(operating_date='2026-10-20', forecast_date='2026-10-21',
            availability_forecast_date='2026-10-22', published_date='2026-10-21',
            source_url='https://erp.powergrid.gov.bd/report.xlsx', sha256='source-hash',
            pgcb_scenario=[dict(time='00:00', demand=130, generation=129),
                dict(time='00:30', demand=131, generation=130), dict(time='01:00', demand=0)])]
        before = json.dumps(records)
        with tempfile.TemporaryDirectory() as directory:
            root = self.study(Path(directory))
            bundle = build_bundle(root, {}, records)
            first, second = bundle['days']['2026-10-21'][:2]
            self.assertEqual((first['pgcb_demand_mw'], first['pgcb_generation_mw']), (130, 129))
            self.assertEqual((second['pgcb_demand_mw'], second['pgcb_generation_mw']), (0, None))
            self.assertIsNone(bundle['days']['2026-10-21'][2]['pgcb_demand_mw'])
            self.assertEqual(first['demand_mw'], 110)
            self.assertEqual(first['demand_models']['Evaluation winner'], 100)
            self.assertEqual(bundle['pgcb_forecasts']['2026-10-21']['sha256'], 'source-hash')
            self.assertNotIn('2026-10-23', bundle['pgcb_forecasts'])
            self.assertTrue(all(r['pgcb_demand_mw'] is None for r in bundle['days']['2026-10-23']))
        self.assertEqual(json.dumps(records), before)

    def test_defaults_follow_evaluation_rank_without_rewriting_earlier_selection(self):
        with tempfile.TemporaryDirectory() as directory:
            bundle = build_bundle(self.study(Path(directory)), {})
            self.assertEqual(bundle['default_models'], dict(demand='Evaluation winner', generation='Evaluation winner'))
            self.assertTrue(all(r['model']=='Earlier choice' for r in bundle['scores'] if r['selected']))
            self.assertTrue(all(r['demand_mw'] is None for r in bundle['days']['2026-10-23']))

    def test_missing_invalid_or_undated_scenarios_do_not_borrow_dates_or_values(self):
        rows = [dict(time='00:00', demand=1)]
        records = [dict(operating_date='2026-10-21', availability_forecast_date='2026-10-21', pgcb_scenario=rows),
            dict(forecast_date='2026-02-30', pgcb_scenario=rows),
            dict(forecast_date='2026-10-21', pgcb_scenario=[dict(time='24:00', demand=1),
                dict(time='00:00', demand=float('nan'), generation=True)])]
        self.assertEqual(pgcb_scenarios(records, {}), {})

    def test_explicit_current_snapshot_scenario_preserves_missing_generation(self):
        current = dict(today_date='2026-10-23', pgcb_forecast=dict(date='2026-10-22',
            hourly=[dict(time='00:00', demand_mw=140)], published_date='2026-10-22'))
        scenarios = pgcb_scenarios([], current)
        self.assertNotIn('2026-10-23', scenarios)
        self.assertEqual(scenarios['2026-10-22']['hourly'], [dict(time='00:00', demand_mw=140, generation_mw=None)])

    def test_static_report_scenario_date_is_separate_from_availability_date(self):
        report = dict(published_date='2026-10-21', forecast=dict(date='2026-10-22',
            scenario_date='2026-10-21', demand_hourly=[dict(time='00:00', demand_mw=130, generation_mw=129)]))
        self.assertEqual(list(pgcb_scenarios([], {}, [report])), ['2026-10-21'])
        del report['forecast']['scenario_date']
        self.assertEqual(pgcb_scenarios([], {}, [report]), {})


if __name__ == '__main__':
    unittest.main()
