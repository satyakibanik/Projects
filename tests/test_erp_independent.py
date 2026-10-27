"""Measurement-basis, chronological selection and independent-model contracts."""
import copy
import datetime as dt
import importlib.util
from pathlib import Path
import sys
import unittest
import tempfile
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import erp_history as erp
import daily_forecast as daily

HAS_MODELS = all(importlib.util.find_spec(m) for m in ('numpy','sklearn','catboost'))


class ERPTests(unittest.TestCase):
    def test_substation_supply_is_not_generation_and_repeated_clock_is_normalized(self):
        body=b'''<tr><th>Date</th><th>Time</th><th>Demand Substation Side</th><th>Supply</th><th>Loadshed</th><th>Remarks</th></tr>
        <tr><td>21-10-2026</td><td>19:00:00 19:00</td><td>14,804</td><td>14771</td><td>33</td><td>Peak</td></tr><a href="?page=90">90</a>'''
        rows,pages=erp.parse_table(body,'demand')
        self.assertEqual(pages,90)
        self.assertEqual(rows,[dict(date='2026-10-21',time='19:00',demand_mw=14804.,supply_mw=14771.,shed_mw=33.)])
        with self.assertRaises(ValueError):erp.parse_table(body.replace(b'Substation Side',b'Generation Side'),'demand')

    def test_alignment_uses_both_erp_targets_preserving_auxiliary_provenance(self):
        day='2026-10-21'
        records=[dict(operating_date=day,published_date='2026-10-22',actual=[dict(demand=99999,generation=88888)],sha256='workbook-hash')]
        demand=dict(days={day:[dict(date=day,time=t,demand_mw=100+i,supply_mw=99+i,shed_mw=1) for i,t in enumerate(daily.HOURS)]})
        generation=dict(days={day:[dict(date=day,time=t,generation_mw=200+i) for i,t in enumerate(daily.HOURS)]})
        result,rejected=erp.align_records(records,demand,generation)
        self.assertFalse(rejected)
        self.assertEqual(result[0]['actual'][0],dict(time='00:00',demand=100,generation=200,supply_mw=99,shed_mw=1))
        self.assertEqual(result[0]['label_basis'],daily.TARGET_BASIS)
        self.assertEqual(records[0]['actual'][0]['demand'],99999)
        generation['days'][day].pop()
        self.assertEqual(erp.align_records(records,demand,generation)[0],[])

    def test_duplicate_conflicts_rejected_and_zero_is_a_valid_label(self):
        rows=[dict(time=t,demand_mw=0) for t in daily.HOURS]
        self.assertTrue(erp.complete(rows,'demand'))
        self.assertFalse(erp.complete(rows+[rows[0]],'demand'))
        rows[0]['demand_mw']=None;self.assertFalse(erp.complete(rows,'demand'))

    def test_range_fetches_only_missing_dates_and_isolates_conflicting_old_rows(self):
        header = '<tr><th>Date</th><th>Time</th><th>Demand Substation Side</th><th>Supply</th><th>Loadshed</th><th>Remarks</th></tr>'
        rows = ''.join(f'<tr><td>23-10-2026</td><td>{t}</td><td>100</td><td>99</td><td>1</td><td></td></tr>' for t in daily.HOURS)
        irrelevant = '<tr><td>12-05-2026</td><td>21:00</td><td>1</td><td>1</td><td>0</td><td></td></tr><tr><td>12-05-2026</td><td>21:00</td><td>2</td><td>2</td><td>0</td><td></td></tr>'
        with tempfile.TemporaryDirectory() as directory, patch.object(erp, 'download', return_value=(header+rows+irrelevant).encode()) as fetch:
            cache = Path(directory)
            result = erp.load_range('demand', '2026-10-23', '2026-10-23', cache)
            self.assertTrue(erp.complete(result['days']['2026-10-23'], 'demand'))
            self.assertEqual(set(result['days']), {'2026-10-23'})
            self.assertIn('search=23-10-2026', fetch.call_args.args[0])
            erp.load_range('demand', '2026-10-23', '2026-10-23', cache)
            self.assertEqual(fetch.call_count, 1)

    def test_bad_day_does_not_abort_other_dates_and_is_retried(self):
        header = '<tr><th>Date</th><th>Time</th><th>Demand Substation Side</th><th>Supply</th><th>Loadshed</th><th>Remarks</th></tr>'
        def body(day, value):
            return f'<tr><td>{day}-10-2026</td><td>00:00</td><td>{value}</td><td>1</td><td>0</td><td></td></tr>'
        def fetch(url):
            return (header+body('22',1)+body('22',2)+body('23',3)).encode()
        with tempfile.TemporaryDirectory() as directory, patch.object(erp, 'download', side_effect=fetch):
            result = erp.load_range('demand', '2026-10-22', '2026-10-23', Path(directory))
        self.assertIn('Conflicting demand rows', result['failures']['2026-10-22'])
        self.assertNotIn('2026-10-22', result['days'])
        self.assertEqual(result['days']['2026-10-23'][0]['demand_mw'],3)

    def test_searched_day_follows_pagination_before_accepting_complete_history(self):
        header = '<tr><th>Date</th><th>Time</th><th>Demand Substation Side</th><th>Supply</th><th>Loadshed</th><th>Remarks</th></tr>'
        def fetch(url):
            hours = daily.HOURS[12:] if 'page=2' in url else daily.HOURS[:12]
            return (header+''.join(f'<tr><td>23-10-2026</td><td>{t}</td><td>100</td><td>99</td><td>1</td><td></td></tr>' for t in hours)+'<a href="?page=2">2</a>').encode()
        with tempfile.TemporaryDirectory() as directory, patch.object(erp, 'download', side_effect=fetch) as download:
            result = erp.load_range('demand', '2026-10-23', '2026-10-23', Path(directory))
        self.assertEqual(download.call_count,2)
        self.assertTrue(erp.complete(result['days']['2026-10-23'],'demand'))


@unittest.skipUnless(HAS_MODELS,'Install requirements-forecast.txt')
class IndependentTests(unittest.TestCase):
    def test_registry_has_all_19_base_methods_and_eight_independent_ensembles(self):
        from independent_models import REGISTRY,BASE_MODELS
        self.assertEqual((len(BASE_MODELS),len(REGISTRY)),(19,27))
        self.assertTrue(all(info['track']=='Independent' for info in REGISTRY.values()))
        self.assertTrue(all('PGCB' not in name for name in REGISTRY))

    def test_all_base_methods_fit_complete_nonnegative_hourly_profiles(self):
        from test_daily_forecast import ModelTests
        from forecast_features import Dataset
        from independent_models import BASE_MODELS,fit_origin
        from threadpoolctl import threadpool_limits
        import numpy as np
        ModelTests.setUpClass()
        data=Dataset(ModelTests.records,ModelTests.weather['hourly'])
        with threadpool_limits(limits=1):pred,audit,diagnostics=fit_origin(data,ModelTests.origin,'demand')
        self.assertEqual(set(pred),set(BASE_MODELS))
        self.assertTrue(all(np.asarray(v).shape==(24,) and np.isfinite(v).all() and min(v)>=0 for v in pred.values()))
        self.assertLessEqual(audit['max_label_publication'],audit['cutoff'])

    def test_ensemble_calibration_ignores_future_and_unavailable_labels(self):
        import numpy as np
        from independent_models import BASE_MODELS,add_ensembles
        from forecast_features import Dataset
        from test_daily_forecast import ModelTests
        ModelTests.setUpClass();data=Dataset(ModelTests.records,ModelTests.weather['hourly'])
        origins=sorted(data.days)[-14:]
        original={(d,t):{name:np.full(24,14000+i*10+j) for j,name in enumerate(BASE_MODELS)}
                  for i,d in enumerate(origins) for t in ('demand','generation')}
        other=copy.deepcopy(data); other.days[origins[-1]]['demand'][:]=1e8
        one,two=copy.deepcopy(original),copy.deepcopy(original)
        audit=add_ensembles(data,one,origins);add_ensembles(other,two,origins)
        for target in ('demand','generation'):
            for name in one[origins[-2],target]:
                np.testing.assert_array_equal(one[origins[-2],target][name],two[origins[-2],target][name])
        self.assertTrue(all(r['max_calibration_publication'] is None or r['max_calibration_publication']<=daily.shift(r['origin'],1) for r in audit))

    def test_champion_selection_does_not_use_evaluation_ranking(self):
        import numpy as np
        from independent_models import REGISTRY
        from independent_study import score
        from types import SimpleNamespace
        origins=[(dt.date(2026,8,1)+dt.timedelta(days=i)).isoformat() for i in range(82)]
        data=SimpleNamespace(days={d:dict(demand=np.full(24,10000.),generation=np.full(24,10000.),published_date=daily.shift(d,-1)) for d in origins})
        predictions={}
        for d in origins:
            for target in ('demand','generation'):
                predictions[d,target]={n:np.full(24,10010.) for n in REGISTRY}
                if '2026-09-09'<=d<='2026-09-22':predictions[d,target]['Ridge enriched']=np.full(24,10001.)
                if '2026-09-24'<=d<='2026-10-21':
                    predictions[d,target]['Ridge enriched']=np.full(24,10050.)
                    predictions[d,target]['Nearest neighbors']=np.full(24,10000.)
        scores,champions=score(data,predictions,origins)
        chosen=[r for r in champions if r['window']=='development']
        self.assertTrue(all(r['model']=='Ridge enriched' and r['mae_mw']==50 for r in chosen))


if __name__=='__main__':unittest.main()

class RealtimeHistoryTests(unittest.TestCase):
    def test_detail_parser_retains_fuel_and_routes_without_changing_model_generation_schema(self):
        body = b'<tr><th>Generation</th></tr><tr><td>27-10-2026</td><td>00:00</td><td>100</td><td>30</td><td>20</td><td>30</td><td>10</td><td>0</td><td>0</td><td>1</td><td>2</td><td>3</td><td>4</td></tr>'
        rows, _ = erp.parse_table(body, 'generation_detail', '2026-10-27')
        self.assertEqual(rows[0]['total_mw'], 100)
        self.assertEqual(rows[0]['solar_mw'], 0)
        self.assertEqual(rows[0]['nepal_mw'], 4)
        model_rows, _ = erp.parse_table(body, 'generation')
        self.assertEqual(set(model_rows[0]), {'date', 'time', 'generation_mw'})
        self.assertFalse(erp.complete(rows, 'generation_detail'))
        full = [dict(rows[0], time=t) for t in daily.HOURS]
        self.assertTrue(erp.complete(full, 'generation_detail'))
        full[0]['wind_mw'] = None
        self.assertFalse(erp.complete(full, 'generation_detail'))

    def test_history_keeps_india_import_page_authoritative_and_nepal_from_generation(self):
        generation = [dict(date='2025-12-31', time='00:00', total_mw=100, nepal_mw=4, adani_mw=999)]
        india_body = b'<tr><td>31-12-2025</td><td>00:00</td><td>1</td><td>999</td><td>2</td><td>999</td><td>3</td><td>999</td></tr>'
        india, _ = erp.parse_table(india_body, 'imports', '2025-12-31')
        current = dict(today_date='2026-01-01')
        def load(kind, start, end, cache):
            self.assertEqual((start, end), ('2025-12-31', '2025-12-31'))
            return dict(days={'2025-12-31': generation if kind == 'generation_detail' else india})
        with patch.object(erp, 'load_range', side_effect=load):
            erp.attach_realtime_history(current, Path('/unused'))
        history = current['realtime_history']['2025-12-31']
        self.assertEqual([r['hourly'][0]['mw'] for r in history['imports']], [1, 2, 3, 4])
        self.assertEqual(history['generation_hourly'], generation)

    def test_source_outage_stays_missing_without_borrowing_another_day_or_generation_india_routes(self):
        current = dict(today_date='2026-01-01')
        def load(kind, *args):
            if kind == 'imports':
                raise TimeoutError('Offline')
            return dict(days={'2025-12-31': [dict(date='2025-12-30', time='00:00', total_mw=999)]})
        with patch.object(erp, 'load_range', side_effect=load):
            erp.attach_realtime_history(current, Path('/unused'))
        history = current['realtime_history']['2025-12-31']
        self.assertEqual(history['generation_hourly'], [])
        self.assertTrue(all(not route['hourly'] for route in history['imports']))
        self.assertIn('TimeoutError', history['errors']['imports'])
