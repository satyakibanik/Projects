#!/usr/bin/env python3
"""Export the ERP independent-model comparison to a local dashboard only."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]


def build_bundle(study, current):
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
    dates = sorted(set(d for c in summary['champions'] for d in c['evaluation_dates']) | set(summary['forecast_dates']))
    days = {}
    for day in dates:
        if day not in predictions:
            raise ValueError(f'Missing model predictions for {day}')
        live_demand = {r['time']:r for r in current.get('demand_hourly',[])} if current.get('today_date')==day else {}
        live_generation = {r['time']:r for r in current.get('generation_hourly',[])} if current.get('today_date')==day else {}
        observed = actuals.get(day)
        rows = []
        for h in range(24):
            clock=f'{h:02}:00'; d=live_demand.get(clock,{}); g=live_generation.get(clock,{})
            models={target:{name:predictions[day][target][name][h] for name in methods} for target in ('demand','generation')}
            rows.append(dict(time=clock,demand_mw=observed['demand'][h] if observed else d.get('demand_mw'),
                supply_mw=observed['supply'][h] if observed else d.get('supply_mw',d.get('generation_mw')),
                generation_mw=observed['generation'][h] if observed else g.get('total_mw'),
                demand_models=models['demand'],generation_models=models['generation']))
        days[day]=rows
    defaults={target:next(c['model'] for c in summary['champions'] if c['window']=='development' and c['target']==target)
              for target in ('demand','generation')}
    return dict(dates=dates,default_date=dates[-1],default_models=defaults,
        models=dict(demand=methods,generation=methods),days=days,scores=scores,
        windows=summary['windows'],champions=summary['champions'],
        availability=summary['availability'],issued_at=summary['completed_at'],
        forward_dates=summary['forecast_dates'],model_count=summary['model_count'])


def write_preview(study, output, current_path=None):
    live=output/'live-data.js'
    if not live.is_file():
        raise FileNotFoundError('An existing ERP local preview live-data.js is required')
    source=live.read_text()
    if not source.startswith('window.BEGD_STATIC_DATA='):
        raise ValueError('Unexpected local ERP bundle')
    data=json.loads(source.removeprefix('window.BEGD_STATIC_DATA=').strip().removesuffix(';'))
    current=json.loads(current_path.read_text()) if current_path else data['current_day']
    bundle=build_bundle(study,current)
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
    args=parser.parse_args();write_preview(args.study,args.output,args.current_day)


if __name__=='__main__':main()
