"""Immutable independent 24-hour forecasts for the static realtime dashboard.

ERP substation-demand and generation history are the targets. Lagged workbook
metadata and nominal 48h-lead weather are auxiliary inputs. Historical ERP
availability is assumed on D+1. Today's observations never enter model fitting.
"""
import datetime as dt
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlencode
from urllib.request import urlopen

from forecast_catalog import CATALOG, TOP_MODELS, DEFAULT_MODELS

VERSION = 'erp-independent-top3-v3'
TARGET_BASIS = dict(demand='ERP substation side', generation='ERP generation including imports')
FIELDS = ('temperature_2m', 'relative_humidity_2m', 'precipitation',
          'cloud_cover', 'shortwave_radiation')
CITIES = ((23.81, 90.41), (22.36, 91.78), (24.37, 88.60), (22.82, 89.55))
HOURS = [f'{h:02}:00' for h in range(24)]


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def shift(day, n):
    return (dt.date.fromisoformat(day) - dt.timedelta(days=n)).isoformat()


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, allow_nan=False, separators=(',', ':')))
    temporary.replace(path)


def valid_forecast(value, day):
    if not isinstance(value, dict):
        return False
    if (day <= shift(CATALOG['window']['end'], -1) or value.get('version') != VERSION or
            value.get('date') != day or value.get('status') != 'ready'):
        return False
    if value.get('input_cutoff_date') != shift(day, 1):
        return False
    if value.get('target_basis') != TARGET_BASIS:
        return False
    if (value.get('max_actual_input_date', day) > shift(day, 2) or
            value.get('max_training_publication', day) > shift(day, 1) or
            value.get('models') != DEFAULT_MODELS):
        return False
    try:
        issue = dt.datetime.fromisoformat(value.get('issued_at', ''))
        if issue.tzinfo is None or issue.astimezone(dt.timezone(dt.timedelta(hours=6))).date().isoformat() < value['max_training_publication']:
            return False
    except (ValueError, TypeError):
        return False
    rows = value.get('hourly', [])
    return (isinstance(rows, list) and all(isinstance(r, dict) for r in rows) and
            [r.get('time') for r in rows] == HOURS and
            all(type(r.get(k)) in (float, int) and math.isfinite(r[k]) and r[k] >= 0
                for r in rows for k in ('generation_mw', 'demand_mw')) and
            all(isinstance(r.get(t+'_models'), dict) and set(r[t+'_models'])==set(names) and
                all(type(r[t+'_models'][n]) in (float, int) and math.isfinite(r[t+'_models'][n]) and r[t+'_models'][n]>=0 for n in names) and
                r[t+'_mw']==r[t+'_models'][names[0]]
                for r in rows for t,names in TOP_MODELS.items()))


def history_record(body, item):
    """Read national history without plant reconciliation or PGCB scenarios."""
    import openpyxl
    book = openpyxl.load_workbook(io.BytesIO(body), data_only=True)
    try:
        p1, p4, forecast = book['P1'], book['P4'], book['Forecast']
        def date(value):
            if isinstance(value, dt.datetime): return value.date().isoformat()
            if isinstance(value, dt.date): return value.isoformat()
            return dt.datetime.strptime(str(value).strip(), '%d-%m-%Y').date().isoformat()
        def number(value):
            return float(value) if isinstance(value, (float, int)) and math.isfinite(value) else None
        operating = date(p1['D6'].value)
        if date(p4['C7'].value) != operating:
            raise ValueError('P1/P4 operating dates disagree')
        actual = []
        for row in p4.iter_rows(min_row=9, max_row=40):
            clock = row[1].value
            clock = clock.strftime('%H:%M') if hasattr(clock, 'strftime') else str(clock)[:5]
            if clock in HOURS:
                actual.append(dict(time=clock, generation=number(row[2].value), demand=number(row[6].value)))
        actual.sort(key=lambda r: r['time'])
        if [r['time'] for r in actual] != HOURS or any(r[t] is None for r in actual for t in ('demand', 'generation')):
            raise ValueError('Incomplete exact-hour national history')
        date_columns = [c.column for c in forecast[6] if str(c.value).strip() == 'Date :']
        availability, availability_date = {}, None
        if len(date_columns) == 1:
            column = date_columns[0]
            try: availability_date = date(forecast.cell(6, column + 1).value)
            except (ValueError, TypeError): pass
            for row in range(11, forecast.max_row + 1):
                if any(forecast.cell(row, c).value == 'System Total' for c in range(1, 5)):
                    availability = {name: number(forecast.cell(row, col + column - 2).value)
                                    for name, col in (('forecast_day_mw', 10), ('forecast_evening_mw', 11),
                                                      ('effective_day_mw', 12), ('effective_evening_mw', 13))}
                    break
        energy = number(p1['K8'].value)
        return dict(operating_date=operating, published_date=item['published_date'],
                    report_id=str(item['id']), source_url=item['download_url'],
                    sha256=hashlib.sha256(body).hexdigest(), actual=actual,
                    temperature_c=number(p1['K11'].value), energy_mwh=energy * 1000 if energy is not None else None,
                    availability=availability, availability_forecast_date=availability_date)
    finally:
        book.close()


def load_history(listing, cache, target):
    import server
    # 160 days leave room for 28-day lags plus the 100-day training window.
    selected = [r for r in listing if shift(target, 165) <= r['published_date'] <= shift(target, 1)]
    def load(item):
        path = cache / 'history' / (str(item['id']) + '.json')
        if path.exists():
            record = json.loads(path.read_text())
            if record.get('published_date') == item['published_date']:
                return record
        body = server.fetch_bytes(item['download_url'], limit=server.MAX_REPORT_BYTES)
        record = history_record(body, item)
        atomic_json(path, record)
        return record
    records, failures = [], []
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [(r, pool.submit(load, r)) for r in selected]
        for item, future in futures:
            try: records.append(future.result())
            except Exception as error: failures.append(f"{item['published_date']}: {type(error).__name__}")
    return records, failures


def load_weather(start, end, cache):
    """Fetch fixed-lead forecasts, not observed or reanalysis weather."""
    path = cache / 'weather.json'
    if path.exists():
        existing = json.loads(path.read_text())
        stamps = [shift(end, n) + f'T{h:02}:00'
                  for n in range((dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days + 1)
                  for h in range(24)]
        def complete(stamp):
            values = existing.get('hourly', {}).get(stamp, [])
            return len(values) == 20 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in values)
        if existing['start'] <= start and existing['end'] >= end and all(complete(s) for s in stamps):
            return existing
    locations = []
    for latitude, longitude in CITIES:
        query = urlencode(dict(latitude=latitude, longitude=longitude, start_date=start,
                               end_date=end, timezone='Asia/Dhaka', models='gfs_global',
                               hourly=','.join(f + '_previous_day2' for f in FIELDS)))
        with urlopen('https://previous-runs-api.open-meteo.com/v1/forecast?' + query, timeout=60) as response:
            raw = response.read(5 * 1024 * 1024)
        data = json.loads(raw)
        if data.get('timezone') != 'Asia/Dhaka':
            raise ValueError('Unexpected forecast weather timezone')
        locations.append(data)
    hourly = {}
    for location in locations:
        for i, stamp in enumerate(location['hourly']['time']):
            values = [location['hourly'][f + '_previous_day2'][i] for f in FIELDS]
            # API can include unavailable future hours; reject these if a model needs them.
            hourly.setdefault(stamp, []).extend(values)
    value = dict(start=start, end=end, hourly=hourly, lead_hours=48,
                 source='https://open-meteo.com/en/docs/previous-runs-api', model='gfs_global',
                 retrieved_at=dt.datetime.now(dt.timezone.utc).isoformat(),
                 sha256=hashlib.sha256(json.dumps(locations, sort_keys=True).encode()).hexdigest())
    atomic_json(path, value)
    return value


def fit_forecast(records, weather, target_day, cache=None):
    from threadpoolctl import threadpool_limits
    from forecast_features import Dataset
    from independent_models import BASE_MODELS, add_ensembles, fit_origin

    if target_day <= shift(CATALOG['window']['end'], -1):
        raise ValueError('Ranked publication requires evaluation labels to be available by D-1')
    if not records or any(record.get('label_basis') != TARGET_BASIS for record in records):
        raise ValueError('Forecast labels must be ERP substation demand and ERP generation')
    data = Dataset(records, weather['hourly'])
    training = data.training_days(target_day)
    if len(training) < 35 or not data.eligible(target_day):
        raise ValueError('At least 35 eligible days and every required published lag are needed')
    fit_started = utc_now()
    issue_date = dt.datetime.fromisoformat(fit_started).astimezone(dt.timezone(dt.timedelta(hours=6))).date().isoformat()
    if max(data.days[d]['published_date'] for d in training) > min(shift(target_day, 1), issue_date):
        raise ValueError('Training label unavailable at issue time')
    # Up to 28 warm-up origins precede the 28-date calibration window, so
    # nested fixed-pool ensembles also receive their full earlier calibration. Cache base
    # predictions separately; a new live observation never refits an issued day.
    origins = [d for d in sorted(data.days) if d < target_day and
               data.days[d]['published_date'] <= shift(target_day, 1) and
               data.eligible(d) and len(data.training_days(d)) >= 35][-56:] + [target_day]
    if len(origins)<8:
        raise ValueError('At least seven earlier out-of-sample calibration origins are required')
    all_predictions, diagnostics = {}, []
    record_keys = ('operating_date','published_date','actual','label_basis','temperature_c',
                   'energy_mwh','availability','availability_forecast_date')
    with threadpool_limits(limits=2):
        for origin in origins:
            inputs = dict(records=[{k:r.get(k) for k in record_keys} for r in records
                                   if r['operating_date'] <= shift(origin, 2)],
                          weather={k:v for k,v in weather['hourly'].items() if k[:10] <= origin})
            digest = hashlib.sha256(json.dumps(inputs,sort_keys=True).encode()).hexdigest()
            for target in ('demand','generation'):
                path = Path(cache)/VERSION/'origins'/f'{origin}-{target}.json' if cache else None
                saved = None
                if path and path.exists():
                    try:
                        candidate = json.loads(path.read_text())
                        if candidate.get('inputs_sha256')==digest:
                            values = candidate.get('predictions',{})
                            if set(values)==set(BASE_MODELS) and all(len(values[n])==24 and
                                all(type(v) in (int,float) and math.isfinite(v) and v>=0 for v in values[n]) for n in BASE_MODELS):
                                saved = candidate
                    except (OSError,ValueError,TypeError):
                        pass
                if saved is None:
                    predictions,audit,found = fit_origin(data,origin,target)
                    saved = dict(inputs_sha256=digest,predictions=predictions,audit=audit,diagnostics=found)
                    if path: atomic_json(path,saved)
                all_predictions[origin,target] = dict(saved['predictions'])
                if origin==target_day:
                    diagnostics.extend(dict(target=target,**d) for d in saved['diagnostics'])
        calibration = add_ensembles(data,all_predictions,origins)
    output = {target:{name:[float(v) for v in all_predictions[target_day,target][name]] for name in names}
              for target,names in TOP_MODELS.items()}
    record_fields = ('operating_date', 'published_date', 'report_id', 'source_url', 'sha256',
                     'actual', 'label_basis', 'temperature_c', 'energy_mwh', 'availability', 'availability_forecast_date')
    records_used = [{k: data.by_day[d].get(k) for k in record_fields}
                    for d in sorted(data.days) if d <= shift(target_day, 2)]
    # Record completion, not the start of a fit that might cross midnight.
    issued = utc_now()
    issue_date = dt.datetime.fromisoformat(issued).astimezone(dt.timezone(dt.timedelta(hours=6))).date().isoformat()
    from erp_history import URLS, AVAILABILITY
    result = dict(version=VERSION, status='ready', date=target_day, issued_at=issued, fit_started_at=fit_started,
                  target_basis=TARGET_BASIS, target_sources=URLS, availability_assumption=AVAILABILITY,
                  timezone='Asia/Dhaka', input_cutoff_date=shift(target_day, 1),
                  max_actual_input_date=shift(target_day, 2),
                  max_training_label_date=max(training),
                  max_training_publication=max(data.days[d]['published_date'] for d in training),
                  training_days=len(training), members=list(BASE_MODELS),
                  models=DEFAULT_MODELS, model_catalog=CATALOG,
                  calibration=[a for a in calibration if a['origin']==target_day],
                  issue_timing='before operating day' if issue_date < target_day else 'after operating day began',
                  inputs_sha256=hashlib.sha256(json.dumps(records_used, sort_keys=True).encode()).hexdigest(),
                  weather={k: v for k, v in weather.items() if k != 'hourly'},
                  sources=[dict(report_id=r['report_id'], date=r['operating_date'], published_date=r['published_date'], source_url=r['source_url'], sha256=r.get('sha256')) for r in records_used],
                  diagnostics=diagnostics,
                  hourly=[dict(time=clock, generation_mw=output['generation'][DEFAULT_MODELS['generation']][i],
                    demand_mw=output['demand'][DEFAULT_MODELS['demand']][i],
                    generation_models={n:v[i] for n,v in output['generation'].items()},
                    demand_models={n:v[i] for n,v in output['demand'].items()}) for i, clock in enumerate(HOURS)])
    if not valid_forecast(result, target_day):
        raise ValueError('Forecast output failed validation')
    return result


def prepare_forecasts(listing, current_day, cache):
    """Cache once per date; prepare tomorrow before its first live reading arrives."""
    day = current_day['today_date']
    result = {}
    for target in (day, shift(day, -1)):
        path = cache / VERSION / (target + '.json')
        try:
            if path.exists():
                try: saved = json.loads(path.read_text())
                except (OSError, ValueError): saved = {}
                if valid_forecast(saved, target):
                    result[target] = saved
                    continue
            # Pages retains published forecasts even if GitHub evicts an Actions cache.
            published = os.environ.get('BEGD_PUBLISHED_FORECAST_BASE_URL')
            if published:
                try:
                    with urlopen(published.rstrip('/') + '/' + target + '.json', timeout=20) as response:
                        saved = json.load(response)
                    if valid_forecast(saved, target):
                        atomic_json(path, saved)
                        result[target] = saved
                        continue
                except (OSError, ValueError, KeyError, TypeError):
                    pass
            records, failures = load_history(listing, cache, target)
            if not records:
                raise ValueError('No published training history')
            from erp_history import load_erp_history
            records, provenance = load_erp_history(records, min(r['operating_date'] for r in records), shift(target, 2), cache)
            if not records:
                raise ValueError('No complete paired ERP demand/generation history')
            weather = load_weather(shift(min(r['operating_date'] for r in records), 2), target, cache)
            forecast = fit_forecast(records, weather, target, cache=cache)
            forecast['history_failures'] = failures
            forecast['erp_snapshots'] = {kind: dict(source=provenance[kind]['source'],
                captures=provenance[kind]['captures']) for kind in ('demand', 'generation')}
            forecast['erp_rejected_days'] = provenance['rejected']
            atomic_json(path, forecast)
            result[target] = forecast
        except Exception as error:
            # Fail explicitly, without substituting yesterday's curve or fabricated zeros.
            result[target] = dict(date=target, version=VERSION, status='unavailable',
                                  reason=f'{type(error).__name__}: {error}')
            print(f'Independent forecast unavailable for {target}: {error}', flush=True)
    return result
