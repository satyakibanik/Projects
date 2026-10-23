#!/usr/bin/env python3
"""Export the ERP independent-model comparison to a local dashboard only."""
import argparse
import hashlib
import json
import math
from datetime import date
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]


def pgcb_scenarios(records, current, reports=()):
    """Display-only scenarios, keyed by the date printed in the forecast header."""
    scenarios = {}
    candidates = [dict(date=r.get('forecast_date'), hourly=r.get('pgcb_scenario'),
        published_date=r.get('published_date'), source_url=r.get('source_url'),
        report_id=r.get('report_id'), sha256=r.get('sha256')) for r in records]
    candidates += [dict(date=r.get('forecast', {}).get('scenario_date'),
        hourly=r.get('forecast', {}).get('demand_hourly'), published_date=r.get('published_date'),
        source_url=r.get('source_url'), report_id=r.get('report_id')) for r in reports]
    if current.get('pgcb_forecast'):
        candidates.append(current['pgcb_forecast'])
    for scenario in candidates:
        day = scenario.get('date')
        try:
            if not isinstance(day, str) or date.fromisoformat(day).isoformat() != day:
                continue
        except ValueError:
            continue
        hourly = {}
        for row in scenario.get('hourly') or []:
            clock = row.get('time', '')
            if not re.fullmatch(r'(?:[01]\d|2[0-3]):00', clock):
                continue
            values = {}
            for target in ('demand', 'generation'):
                value = row.get(target+'_mw', row.get(target))
                values[target+'_mw'] = value if type(value) in (int, float) and math.isfinite(value) else None
            if any(value is not None for value in values.values()):
                hourly[clock] = dict(time=clock, **values)
        if not hourly:
            continue
        # Keep each report intact; never combine revisions or borrow another day's curve.
        if day in scenarios and (scenario.get('published_date') or '') < (scenarios[day].get('published_date') or ''):
            continue
        scenarios[day] = {**scenario, 'hourly':list(hourly.values())}
    return scenarios


def build_bundle(study, current, pgcb_records=(), reports=()):
    summary = json.loads((study/'summary.json').read_text())
    predictions = json.loads((study/'predictions.json').read_text())
    actuals = json.loads((study/'actuals.json').read_text())
    import csv
    with (study/'scores.csv').open() as stream:
        scores = list(csv.DictReader(stream))
    for score in scores:
        for key in ('mae_mw','rmse_mw','wape_pct','bias_mw','selection_mae_mw','improvement_vs_weekly_pct'):
            score[key] = float(score[key])
        score['selected'] = score['selected'] == 'True'
    methods = list(summary['model_registry'])
    scenarios = pgcb_scenarios(pgcb_records, current, reports)
    dates = sorted(set(d for c in summary['champions'] for d in c['evaluation_dates']) | set(summary['forecast_dates']))
    days = {}
    for day in dates:
        if day not in predictions:
            raise ValueError(f'Missing model predictions for {day}')
        live_demand = {r['time']:r for r in current.get('demand_hourly',[])} if current.get('today_date')==day else {}
        live_generation = {r['time']:r for r in current.get('generation_hourly',[])} if current.get('today_date')==day else {}
        observed = actuals.get(day)
        pgcb = {r['time']:r for r in scenarios.get(day, {}).get('hourly', [])}
        rows = []
        for h in range(24):
            clock=f'{h:02}:00'; d=live_demand.get(clock,{}); g=live_generation.get(clock,{})
            models={target:{name:predictions[day][target][name][h] for name in methods} for target in ('demand','generation')}
            rows.append(dict(time=clock,demand_mw=observed['demand'][h] if observed else d.get('demand_mw'),
                supply_mw=observed['supply'][h] if observed else d.get('supply_mw',d.get('generation_mw')),
                generation_mw=observed['generation'][h] if observed else g.get('total_mw'),
                pgcb_demand_mw=pgcb.get(clock, {}).get('demand_mw'),
                pgcb_generation_mw=pgcb.get(clock, {}).get('generation_mw'),
                demand_models=models['demand'],generation_models=models['generation']))
        days[day]=rows
    defaults={target:min((s for s in scores if s['window']=='development' and s['target']==target),
                         key=lambda s:(s['mae_mw'],s['model']))['model']
              for target in ('demand','generation')}
    return dict(dates=dates,default_date=dates[-1],default_models=defaults,
        models=dict(demand=methods,generation=methods),days=days,scores=scores,
        windows=summary['windows'],champions=summary['champions'],
        pgcb_forecasts={day:{k:v for k,v in scenarios[day].items() if k!='hourly'} for day in dates if day in scenarios},
        availability=summary['availability'],issued_at=summary['completed_at'],
        forward_dates=summary['forecast_dates'],model_count=summary['model_count'])


def write_preview(study, output, current_path=None, pgcb_path=None):
    live=output/'live-data.js'
    if not live.is_file():
        raise FileNotFoundError('An existing ERP local preview live-data.js is required')
    source=live.read_text()
    if not source.startswith('window.BEGD_STATIC_DATA='):
        raise ValueError('Unexpected local ERP bundle')
    data=json.loads(source.removeprefix('window.BEGD_STATIC_DATA=').strip().removesuffix(';'))
    current=json.loads(current_path.read_text()) if current_path else data['current_day']
    pgcb_path = pgcb_path or study.parent/'records.json'
    records = json.loads(pgcb_path.read_text()) if pgcb_path.is_file() else []
    bundle=build_bundle(study,current,records,data.get('reports_by_id', {}).values())
    shutil.copytree(ROOT/'begd',output,dirs_exist_ok=True)
    current.update(delivery='static')
    (output/'current-day.json').write_text(json.dumps(current,allow_nan=False))
    data['current_day']=current
    payload=json.dumps(data,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
    live.write_text('window.BEGD_STATIC_DATA='+payload+';\n')
    payload=json.dumps(bundle,ensure_ascii=False,separators=(',',':'),allow_nan=False).replace('<','\\u003c')
    (output/'independent-study-data.js').write_text('window.BEGD_INDEPENDENT_STUDY='+payload+';\n')
    index=(ROOT/'begd/index.html').read_text()
    scripts=''
    for name in ('live-data.js','static-api.js','independent-study-data.js','independent-study.js'):
        digest=hashlib.sha256((output/name).read_bytes()).hexdigest()[:12]
        scripts+=f'<script src="{name}?v={digest}"></script>'
    digest=hashlib.sha256((output/'app.js').read_bytes()).hexdigest()[:12]
    index=index.replace('<script src="app.js?v=',scripts+'<script src="app.js?v='+digest+'-',1)
    digest=hashlib.sha256((output/'independent-study.css').read_bytes()).hexdigest()[:12]
    index=index.replace('</head>',f'<link rel="stylesheet" href="independent-study.css?v={digest}"></head>',1)
    def version_asset(match):
        asset=output/match[2]
        digest=hashlib.sha256(asset.read_bytes()).hexdigest()[:12]
        return match[1]+match[2]+'?v='+digest+match[3]
    index=re.sub(r'((?:src|href)=")([\w./-]+\.(?:js|css))(?:\?[^"\s]*)?(\")',version_asset,index)
    (output/'index.html').write_text(index)
    print(f'Local independent comparison: {bundle["model_count"]} models per target; latest {bundle["default_date"]}')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--study',type=Path,default=ROOT/'.cache/erp-study/results')
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--current-day',type=Path)
    parser.add_argument('--pgcb-records',type=Path,help='Optional records with explicit forecast_date and pgcb_scenario; defaults to the study records.json')
    args=parser.parse_args();write_preview(args.study,args.output,args.current_day,args.pgcb_records)


if __name__=='__main__':main()
