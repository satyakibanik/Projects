"""Fit issue-time residual corrections while preserving original BEGD curves."""
import datetime as dt
import math
from zoneinfo import ZoneInfo

BST = ZoneInfo('Asia/Dhaka')
MIN_TRAINING_DAYS = 10


def timestamp(value):
    try:
        instant = dt.datetime.fromisoformat(value)
        return instant.astimezone(BST) if instant.tzinfo else None
    except (TypeError, ValueError):
        return None


def valid_mw(value):
    return type(value) in (float, int) and math.isfinite(value) and value >= 0


def weekday_features(day, hour):
    weekday = dt.date.fromisoformat(day).weekday()
    evening = hour >= '17:00'
    return [weekday == 4, weekday == 5, weekday == 4 and evening, weekday == 5 and evening]


def demand_features(current, previous, older, issued):
    captured = timestamp(current.get('fetched_at'))
    if (not captured or captured > issued or captured.date().isoformat() != previous
            or current.get('source_dates', {}).get('demand') != previous):
        return None
    actual = {r['time']: r.get('demand') for r in older.get('actual', [])}
    latest = {}
    for row in current.get('demand_hourly', []):
        hour, mw = row['time'], row.get('demand_mw')
        stamp = timestamp(previous+'T'+hour+'+06:00')
        if stamp and stamp <= captured and valid_mw(mw) and valid_mw(actual.get(hour)):
            latest[hour] = (mw, mw-actual[hour])
    if len(latest) < 3:
        return None
    last_three = [latest[hour] for hour in sorted(latest)[-3:]]
    return [sum(values)/3 for values in zip(*last_three)]


def apply_adjustments(forecast, current, records, archive):
    issued = timestamp(forecast['issued_at'])
    day = dt.date.fromisoformat(forecast['date'])
    if not issued or issued.date() != day-dt.timedelta(days=1):
        return
    previous = issued.date().isoformat()
    older = (day-dt.timedelta(days=2)).isoformat()
    by_day = {r['operating_date']:r for r in records if r['published_date'] <= previous}
    features = demand_features(current, previous, by_day.get(older, {}), issued)
    if features is not None:
        forecast['captured_demand_inputs'] = dict(values=features, fetched_at=current['fetched_at'])
    for target in ('demand', 'generation'):
        if target == 'demand' and features is None:
            continue
        x, y, days = [], [], set()
        for date, earlier in archive.items():
            origin = timestamp(earlier.get('issued_at'))
            if date >= previous or not origin or origin.date().isoformat() >= date or date not in by_day:
                continue
            capture = earlier.get('captured_demand_inputs', {})
            stamp = timestamp(capture.get('fetched_at'))
            values = capture.get('values', [])
            if target == 'demand' and (
                not stamp or stamp > origin or stamp.date() != origin.date() or
                len(values) != 2 or not all(type(v) in (float, int) and math.isfinite(v) for v in values)
            ):
                continue
            actual = {r['time']:r.get(target) for r in by_day[date]['actual']}
            for row in earlier['hourly']:
                hour = row['time']
                if not valid_mw(actual.get(hour)):
                    continue
                x.append(values if target == 'demand' else weekday_features(date,hour))
                y.append(actual[hour]-row[target+'_mw'])
                days.add(date)
        if len(days) < MIN_TRAINING_DAYS:
            continue
        import numpy as np
        x, y = np.array(x,dtype=float), np.array(y)
        center, scale = x.mean(axis=0), x.std(axis=0)
        scale[scale == 0] = 1
        z = (x-center)/scale
        bias = y.mean()
        weights = np.linalg.solve(z.T @ z+10*np.eye(z.shape[1]), z.T @ (y-bias))
        for row in forecast['hourly']:
            values = features if target == 'demand' else weekday_features(day.isoformat(),row['time'])
            correction = bias + ((values-center)/scale) @ weights
            row['adjusted_'+target+'_mw'] = max(0., float(row[target+'_mw']+correction))
        forecast.setdefault('adjustments', {})[target] = dict(
            method='captured_erp' if target == 'demand' else 'weekend',
            training_days=len(days))
