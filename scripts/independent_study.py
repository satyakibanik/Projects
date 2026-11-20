#!/usr/bin/env python3
"""Chronological ERP-only target evaluation of every independent challenge model.

Nineteen base methods and eight ensembles; no target-day PGCB scenario inputs.
Historical ERP availability is assumed on D+1 and is not vintage-verified.
"""
import argparse
import concurrent.futures
import csv
import hashlib
import json
import multiprocessing
from pathlib import Path
import time

import numpy as np
from threadpoolctl import threadpool_limits
from daily_forecast import atomic_json, shift, utc_now
from erp_history import AVAILABILITY
from forecast_features import Dataset
from independent_models import REGISTRY, BASE_MODELS, add_ensembles, fit_origin

WINDOWS = dict(
    confirmation=dict(selection_start='2026-08-14', selection_end='2026-08-27', start='2026-08-29', end='2026-09-09'),
    development=dict(selection_start='2026-09-09', selection_end='2026-09-22', start='2026-09-24', end='2026-10-21'))
worker_data = worker_cache = worker_limits = None


def weather_hourly(path):
    raw = json.loads(path.read_text())
    if isinstance(raw, dict) and 'hourly' in raw:
        return raw['hourly']
    hourly = {}
    for location in raw:
        for i, stamp in enumerate(location['hourly']['time']):
            hourly.setdefault(stamp, []).extend(location['hourly'][field+'_previous_day2'][i]
                for field in ('temperature_2m', 'relative_humidity_2m', 'precipitation', 'cloud_cover', 'shortwave_radiation'))
    return hourly


def initialize(records, weather, cache):
    global worker_data, worker_cache, worker_limits
    worker_limits = threadpool_limits(limits=1)
    worker_data = Dataset(json.loads(Path(records).read_text()), weather_hourly(Path(weather)))
    worker_cache = Path(cache)


def job(day, target):
    path = worker_cache / f'{day}_{target}.json'
    if path.exists():
        return json.loads(path.read_text())
    predictions, audit, diagnostics = fit_origin(worker_data, day, target)
    result = dict(origin=day, target=target, predictions=predictions, audit=audit, diagnostics=diagnostics)
    atomic_json(path, result)
    return result


def metrics(a, p):
    a, p = np.asarray(a), np.asarray(p)
    error = p-a
    return dict(mae_mw=float(np.mean(abs(error))), rmse_mw=float(np.sqrt(np.mean(error**2))),
                wape_pct=float(100*np.sum(abs(error))/np.sum(abs(a))), bias_mw=float(np.mean(error)))


def score(data, predictions, origins):
    scores, champions = [], []
    for window, limits in WINDOWS.items():
        selection = [d for d in origins if limits['selection_start'] <= d <= limits['selection_end']]
        evaluation = [d for d in origins if limits['start'] <= d <= limits['end']]
        if len(selection) != 14 or len(evaluation) != (12 if window == 'confirmation' else 28):
            raise ValueError(f'Incomplete fixed selection/evaluation window: {window}')
        if any(data.days[d]['published_date'] > shift(evaluation[0], 1) for d in selection):
            raise ValueError('Selection label unavailable at first evaluation cutoff')
        for target in ('demand', 'generation'):
            validation = {name: float(np.mean(np.concatenate([abs(predictions[d, target][name]-data.days[d][target])
                          for d in selection]))) for name in REGISTRY}
            selected = min(validation, key=validation.get)
            actual = np.concatenate([data.days[d][target] for d in evaluation])
            naive = np.concatenate([predictions[d, target]['Weekly naive'] for d in evaluation])
            baseline = metrics(actual, naive)['mae_mw']
            for name, info in REGISTRY.items():
                p = np.concatenate([predictions[d, target][name] for d in evaluation])
                result = dict(window=window, target=target, model=name, family=info['family'],
                    selected=name == selected, selection_mae_mw=validation[name], days=len(evaluation),
                    hours=len(evaluation)*24, **metrics(actual, p),
                    improvement_vs_weekly_pct=100*(1-metrics(actual,p)['mae_mw']/baseline),
                    daily_peak_mae_mw=float(np.mean([abs(max(predictions[d,target][name])-max(data.days[d][target])) for d in evaluation])))
                scores.append(result)
                if name == selected:
                    champions.append(dict(result, selection_dates=selection, evaluation_dates=evaluation,
                        last_selection_availability=max(data.days[d]['published_date'] for d in selection),
                        first_evaluation_cutoff=shift(evaluation[0], 1)))
    return scores, champions


def write_csv(path, rows):
    if rows:
        with path.open('w', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
            writer.writeheader(); writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--records', type=Path, required=True)
    parser.add_argument('--weather', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--forecast-date', help='Also fit an unscored local preview for this operating day')
    args = parser.parse_args()
    started = time.monotonic(); args.output.mkdir(parents=True, exist_ok=True)
    data = Dataset(json.loads(args.records.read_text()), weather_hourly(args.weather))
    source_files = ['independent_study.py', 'independent_models.py', 'forecast_features.py', 'erp_history.py']
    fingerprint = hashlib.sha256(args.records.read_bytes()+args.weather.read_bytes()+b''.join(
        (Path(__file__).parent/name).read_bytes() for name in source_files)).hexdigest()
    cache = args.output / 'cache' / fingerprint[:16]; cache.mkdir(parents=True, exist_ok=True)
    origins = [d for d in sorted(data.days) if '2026-08-01' <= d <= '2026-10-21' and data.eligible(d)]
    if len(origins) != 82:
        raise ValueError(f'Expected all 82 fixed historical origins, found {len(origins)}')
    forecast_dates = [args.forecast_date] if args.forecast_date else []
    for day in forecast_dates:
        if day in data.days or not data.eligible(day):
            raise ValueError('Forward preview must have no label and every required lag')
        data.weather_day(day)
    all_dates = origins + forecast_dates
    protocol = dict(fingerprint=fingerprint, windows=WINDOWS, model_registry=REGISTRY,
        base_models=len(BASE_MODELS), ensembles=len(REGISTRY)-len(BASE_MODELS),
        targets=dict(demand='ERP substation-side demand', generation='ERP generation including imports'),
        availability=AVAILABILITY, raw_inputs_sha256=hashlib.sha256(args.records.read_bytes()).hexdigest(),
        weather_sha256=hashlib.sha256(args.weather.read_bytes()).hexdigest(),
        weather='Four-location GFS forecasts at nominal 48-hour lead, not observed/reanalysis weather.',
        selection='14 earlier selection origins, one-day embargo, fixed evaluation window; no evaluation labels select each window champion.',
        scope='Independent models only. Prior-day workbook P1 and generation-availability fields are lagged auxiliary inputs; no target-day PGCB scenario.',
        forecast_dates=forecast_dates, saved_before_fitting=utc_now(),
        interpretation='Retrospective development evidence on current ERP snapshots; neither window is a fresh prospective or vintage-verified holdout.')
    atomic_json(args.output/'protocol.json', protocol)
    predictions, audits, diagnostics = {}, [], []
    jobs = [(d,t) for d in all_dates for t in ('demand','generation')]
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers, initializer=initialize,
        initargs=(str(args.records),str(args.weather),str(cache)), mp_context=multiprocessing.get_context('spawn')) as pool:
        pending = [pool.submit(job,*item) for item in jobs]
        for i, future in enumerate(concurrent.futures.as_completed(pending), 1):
            result = future.result(); day,target = result['origin'],result['target']
            predictions[day,target] = {name:np.asarray(v) for name,v in result['predictions'].items()}
            audits.append(result['audit'])
            diagnostics.extend(dict(origin=day,target=target,**r) for r in result['diagnostics'])
            if i%4==0 or i==len(jobs):
                print(f'Independent ERP fits {i}/{len(jobs)} ({time.monotonic()-started:.0f}s)',flush=True)
    ensemble_audit = add_ensembles(data,predictions,all_dates)
    for key, values in predictions.items():
        if set(values)!=set(REGISTRY) or any(v.shape!=(24,) or not np.isfinite(v).all() for v in values.values()):
            raise ValueError(f'Invalid model coverage/output: {key}')
    scores, champions = score(data,predictions,origins)
    serial = {d:{t:{name:v.tolist() for name,v in predictions[d,t].items()} for t in ('demand','generation')} for d in all_dates}
    actuals = {d:dict(demand=data.days[d]['demand'].tolist(),generation=data.days[d]['generation'].tolist(),
        supply=[r.get('supply_mw') for r in sorted(data.by_day[d]['actual'],key=lambda r:r['time'])]) for d in origins}
    summary = dict(protocol,champions=champions,origin_days=len(origins),model_count=len(REGISTRY),
        duration_seconds=round(time.monotonic()-started,1),completed_at=utc_now(),
        forecast_issue_timing='Recorded at fit completion; forward preview is experimental and may be issued after the operating day began.')
    write_csv(args.output/'scores.csv',scores)
    write_csv(args.output/'cutoff_audit.csv',sorted(audits,key=lambda r:(r['origin'],r['target'])))
    atomic_json(args.output/'summary.json',summary);atomic_json(args.output/'predictions.json',serial)
    atomic_json(args.output/'actuals.json',actuals);atomic_json(args.output/'ensemble_audit.json',ensemble_audit)
    atomic_json(args.output/'fit_diagnostics.json',diagnostics)
    print(json.dumps(champions,indent=2),flush=True)


if __name__ == '__main__':
    main()
