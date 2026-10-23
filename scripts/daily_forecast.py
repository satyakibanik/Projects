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
import warnings
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlencode
from urllib.request import urlopen

VERSION = 'erp-independent-seven-v2'
TARGET_BASIS = dict(demand='ERP substation side', generation='ERP generation including imports')
MEMBERS = ('Ridge enriched', 'Boosted weather MAE', 'CatBoost MAE',
           'Extra Trees weather', 'SVR weather', 'MLP weather', 'Daily PCA ridge')
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
    if value.get('version') != VERSION or value.get('date') != day or value.get('status') != 'ready':
        return False
    if value.get('input_cutoff_date') != shift(day, 1):
        return False
    if value.get('target_basis') != TARGET_BASIS:
        return False
    if (value.get('max_actual_input_date', day) > shift(day, 2) or
            value.get('max_training_publication', day) > shift(day, 1) or
            value.get('models') != dict(generation='Independent median ensemble', demand='Independent mean ensemble')):
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
            all(isinstance(r.get(k), (float, int)) and math.isfinite(r[k]) and r[k] >= 0
                for r in rows for k in ('generation_mw', 'demand_mw')))


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


def fit_forecast(records, weather, target_day):
    import numpy as np
    from catboost import CatBoostRegressor
    from sklearn.compose import TransformedTargetRegressor
    from sklearn.decomposition import PCA
    from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import Ridge
    from sklearn.neural_network import MLPRegressor
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    from sklearn.svm import SVR
    from threadpoolctl import threadpool_limits
    from forecast_features import Dataset, features

    if not records or any(record.get('label_basis') != TARGET_BASIS for record in records):
        raise ValueError('Forecast labels must be ERP substation demand and ERP generation')
    data = Dataset(records, weather['hourly'])
    training = data.training_days(target_day)
    if len(training) < 35 or not data.eligible(target_day):
        raise ValueError('At least 35 eligible days and every required published lag are needed')
    fit_started = utc_now()
    issued = fit_started
    # A precomputed forecast must not use a report published on a later calendar date.
    issue_date = dt.datetime.fromisoformat(issued).astimezone(dt.timezone(dt.timedelta(hours=6))).date().isoformat()
    if max(data.days[d]['published_date'] for d in training) > min(shift(target_day, 1), issue_date):
        raise ValueError('Training label unavailable at issue time')
    output, diagnostics = {}, []
    def normalized(model):
        return TransformedTargetRegressor(regressor=make_pipeline(SimpleImputer(), StandardScaler(), model), transformer=StandardScaler())
    with threadpool_limits(limits=2):
        for target in ('generation', 'demand'):
            x = np.concatenate([data.strict(d, target) for d in training])
            test = data.strict(target_day, target)
            y = np.concatenate([data.days[d][target] for d in training])
            def compact(day):
                return np.c_[features(data.days, day, target), data.weather_day(day).reshape(24, 4, 5).mean(axis=1)]
            compact_x = np.concatenate([compact(d) for d in training])
            compact_test = compact(target_day)
            # A wholly missing availability column has no training information.
            # Drop only these columns for histogram binning; retain native partial-NaN handling.
            nonempty = np.isfinite(x).any(axis=0)
            estimators = {
                'Ridge enriched': (make_pipeline(SimpleImputer(), StandardScaler(), Ridge(alpha=100)), x, test),
                'Boosted weather MAE': (HistGradientBoostingRegressor(loss='absolute_error', max_iter=160, max_leaf_nodes=10, min_samples_leaf=30, l2_regularization=20, early_stopping=False, random_state=42), x[:, nonempty], test[:, nonempty]),
                'CatBoost MAE': (CatBoostRegressor(loss_function='MAE', depth=4, iterations=350, learning_rate=.05, l2_leaf_reg=10, random_seed=42, thread_count=2, verbose=False, allow_writing_files=False), x, test),
                'Extra Trees weather': (make_pipeline(SimpleImputer(), ExtraTreesRegressor(n_estimators=150, max_depth=14, min_samples_leaf=6, max_features=.8, n_jobs=2, random_state=42)), x, test),
                'SVR weather': (normalized(SVR(C=5, epsilon=.08)), compact_x, compact_test),
                'MLP weather': (normalized(MLPRegressor(hidden_layer_sizes=(32, 16), activation='tanh', alpha=1, max_iter=2000, n_iter_no_change=30, early_stopping=False, shuffle=False, random_state=42)), compact_x, compact_test),
            }
            predictions = {}
            for name, (model, train_x, predict_x) in estimators.items():
                with warnings.catch_warnings(record=True) as caught:
                    warnings.simplefilter('always')
                    predictions[name] = np.maximum(0, model.fit(train_x, y).predict(predict_x))
                diagnostics.append(dict(target=target, model=name, warnings=[str(w.message) for w in caught]))
            daily_x = np.array([data.daily(d, target) for d in training])
            daily_y = np.array([data.days[d][target] for d in training])
            means = daily_y.mean(axis=1)
            pca = PCA(n_components=5).fit(daily_y - means[:, None])
            latent = np.c_[means, pca.transform(daily_y - means[:, None])]
            daily = make_pipeline(StandardScaler(), Ridge(alpha=100)).fit(daily_x, latent).predict(data.daily(target_day, target)[None, :])
            predictions['Daily PCA ridge'] = np.maximum(0, pca.inverse_transform(daily[:, 1:])[0] + daily[0, 0])
            combined = np.array([predictions[name] for name in MEMBERS])
            output[target] = (np.median(combined, axis=0) if target == 'generation' else combined.mean(axis=0)).tolist()
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
                  training_days=len(training), members=list(MEMBERS),
                  models=dict(generation='Independent median ensemble', demand='Independent mean ensemble'),
                  issue_timing='before operating day' if issue_date < target_day else 'after operating day began',
                  inputs_sha256=hashlib.sha256(json.dumps(records_used, sort_keys=True).encode()).hexdigest(),
                  weather={k: v for k, v in weather.items() if k != 'hourly'},
                  sources=[dict(report_id=r['report_id'], date=r['operating_date'], published_date=r['published_date'], source_url=r['source_url'], sha256=r.get('sha256')) for r in records_used],
                  diagnostics=diagnostics,
                  hourly=[dict(time=clock, generation_mw=output['generation'][i], demand_mw=output['demand'][i]) for i, clock in enumerate(HOURS)])
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
            forecast = fit_forecast(records, weather, target)
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
