"""Causal intraday bias updates, separate from the frozen daily forecast.

Each saved issue contains future hours only. Evaluation uses the most recent
issue strictly before an hour, with the original forecast on those same hours.
No historical issues are reconstructed from subsequently observed actuals.
"""
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
from statistics import median
from urllib.request import urlopen

VERSION = 'erp-bias-update-v1'
BST = dt.timezone(dt.timedelta(hours=6))
HOURS = [f'{h:02}:00' for h in range(24)]
METHOD = dict(window=3, minimum_readings=2, weight=0.8, half_life_hours=6,
              max_fraction=0.15, max_age_hours=3)


def number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def stamp(value):
    parsed = dt.datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError('An issue timestamp must include its timezone')
    return parsed


def hour_stamp(day, hour):
    return dt.datetime.fromisoformat(day + 'T' + hour).replace(tzinfo=BST)


def signature(forecast):
    return hashlib.sha256(json.dumps(forecast, sort_keys=True, allow_nan=False).encode()).hexdigest()


def read_ledger(cache, day):
    """Restore published issues if the disposable Actions cache is lost."""
    path = cache / (day + '.json')
    def checked(value):
        if value.get('date') != day or value.get('version') != VERSION or not isinstance(value.get('issues'), list):
            raise ValueError('Wrong update ledger')
        for item in value['issues']:
            if (item.get('date') != day or item.get('version') != VERSION or
                    stamp(item['issued_at']).astimezone(BST).date().isoformat() != day or
                    item.get('method') != METHOD or not isinstance(item.get('targets'), dict) or
                    not isinstance(item.get('baseline_sha256'), str)):
                raise ValueError('Invalid update issue')
            for target, revised in item['targets'].items():
                if target not in ('demand', 'generation') or revised.get('input_through') not in HOURS:
                    raise ValueError('Invalid update target')
                rows = revised['hourly']
                if len(rows) > 24 or len({r['time'] for r in rows}) != len(rows):
                    raise ValueError('Invalid update hours')
                for row in rows:
                    if (row.get('time') not in HOURS or stamp(item['issued_at']) >= hour_stamp(day, row['time']) or
                            not number(row.get('forecast_mw')) or not number(row.get('original_mw'))):
                        raise ValueError('Invalid update prediction')
        return value['issues']
    try:
        return checked(json.loads(path.read_text()))
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        pass
    base = os.environ.get('BEGD_PUBLISHED_UPDATE_BASE_URL', '').rstrip('/')
    if base.startswith('https://'):
        try:
            with urlopen(base + '/' + day + '.json', timeout=8) as response:
                value = json.loads(response.read(2 * 1024 * 1024))
            issues = checked(value)
            cache.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(value, allow_nan=False))
            return issues
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            pass
    return []


def observations(current, target, issued):
    day = current['today_date']
    if current.get('source_dates', {}).get(target) != day:
        return {}
    field = 'demand_mw' if target == 'demand' else 'total_mw'
    values = {}
    for row in current.get(target + '_hourly', []):
        time = row.get('time')
        if (time in HOURS and row.get('date', day) == day and
                hour_stamp(day, time) <= issued and number(row.get(field))):
            if time in values and values[time] != row[field]:
                return {}  # Ambiguous ERP revisions cannot be correction inputs.
            values[time] = row[field]
    return values


def make_issue(current, forecast, issued_at):
    """Apply a fixed, untuned residual correction to unobserved future hours."""
    day = current['today_date']
    issued = stamp(issued_at)
    if (forecast.get('status') != 'ready' or forecast.get('date') != day or
            issued.astimezone(BST).date().isoformat() != day or
            stamp(forecast['issued_at']) > issued):
        return None
    base = {r['time']: r for r in forecast.get('hourly', []) if r.get('time') in HOURS}
    if set(base) != set(HOURS):
        return None
    result = dict(version=VERSION, date=day, issued_at=issued_at,
                  baseline_sha256=signature(forecast), method=METHOD, targets={})
    for target in ('demand', 'generation'):
        observed = observations(current, target, issued)
        if not observed:
            continue
        cutoff = max(observed)
        cutoff_index = HOURS.index(cutoff)
        # Require a recent, contiguous tail; do not bridge missing hours.
        tail = []
        for index in range(cutoff_index, max(-1, cutoff_index - METHOD['window']), -1):
            time = HOURS[index]
            if time not in observed or not number(base[time].get(target + '_mw')):
                break
            tail.append(time)
        if (len(tail) < METHOD['minimum_readings'] or
                (issued - hour_stamp(day, cutoff)).total_seconds() > METHOD['max_age_hours'] * 3600):
            continue
        bias = median(observed[t] - base[t][target + '_mw'] for t in tail)
        rows = []
        for time in HOURS:
            original = base[time].get(target + '_mw')
            if hour_stamp(day, time) <= issued or time in observed or not number(original):
                continue
            horizon = HOURS.index(time) - cutoff_index
            correction = METHOD['weight'] * bias * 2 ** (-horizon / METHOD['half_life_hours'])
            bound = METHOD['max_fraction'] * original
            correction = max(-bound, min(bound, correction))
            rows.append(dict(time=time, forecast_mw=max(0, original + correction), original_mw=original))
        if rows:
            result['targets'][target] = dict(input_through=cutoff,
                inputs=[dict(time=t, actual_mw=observed[t], original_mw=base[t][target+'_mw']) for t in sorted(tail)],
                bias_mw=bias, hourly=rows)
    return result if result['targets'] else None


def matched_scores(issues, day, target, actuals):
    """One prediction per hour: latest saved issue strictly before that hour."""
    candidates = {}
    for issue in issues:
        if issue.get('version') != VERSION or issue.get('date') != day:
            continue
        issued = stamp(issue['issued_at'])
        for row in issue.get('targets', {}).get(target, {}).get('hourly', []):
            time = row.get('time')
            if (time not in HOURS or issued >= hour_stamp(day, time) or
                    not number(row.get('forecast_mw')) or not number(row.get('original_mw'))):
                continue
            if time not in candidates or issued > candidates[time][0]:
                candidates[time] = (issued, row)
    pairs = [dict(row, issued_at=issue.isoformat(), actual_mw=actuals[time])
             for time, (issue, row) in sorted(candidates.items()) if number(actuals.get(time))]
    count = len(pairs)
    return dict(count=count,
        updated_mae_mw=sum(abs(r['actual_mw']-r['forecast_mw']) for r in pairs)/count if count else None,
        original_mae_mw=sum(abs(r['actual_mw']-r['original_mw']) for r in pairs)/count if count else None,
        hourly=pairs)


def attach_updates(current, cache_dir, issued_at=None):
    """Persist real issues in the existing Actions cache, then score prior issues."""
    issued_at = issued_at or dt.datetime.now(dt.timezone.utc).isoformat()
    day = current.get('today_date')
    if not isinstance(day, str):
        return
    issued = stamp(issued_at)
    cache = Path(cache_dir) / VERSION
    path = cache / (day + '.json')
    issues = read_ledger(cache, day)
    forecast = current.get('independent_forecast') or {}
    issue = make_issue(current, forecast, issued_at)
    if issue:
        # Polling without new inputs must not manufacture another issue.
        fingerprint = lambda item: (item['baseline_sha256'], json.dumps(item['targets'], sort_keys=True))
        if not any(fingerprint(item) == fingerprint(issue) for item in issues):
            issues.append(issue)
            cache.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix('.tmp')
            temporary.write_text(json.dumps(dict(version=VERSION, date=day, issues=issues), allow_nan=False))
            temporary.replace(path)
    latest = max((item for item in issues if stamp(item['issued_at']) <= issued),
                 key=lambda item: stamp(item['issued_at']), default=None)
    scores = {target: matched_scores(issues, day, target, observations(current, target, issued))
              for target in ('demand', 'generation')}
    # Hide stale or wrong-baseline curves while retaining all previously issued scores.
    if latest and (not issue or latest['baseline_sha256'] != issue['baseline_sha256']):
        latest = None
    current['forecast_update'] = dict(version=VERSION, date=day, latest=latest, scores=scores)


def archived_update(day, actuals, cache_dir):
    """Read saved issues for a completed date without creating historical ones."""
    try:
        ledger = json.loads((Path(cache_dir) / VERSION / (day + '.json')).read_text())
        if ledger['version'] != VERSION or ledger['date'] != day:
            return None
        return dict(version=VERSION, date=day, latest=None,
            scores={target: matched_scores(ledger['issues'], day, target,
                {r['time']: r[field] for r in actuals.get(target+'_hourly', []) if number(r.get(field))})
                for target, field in [('demand','demand_mw'), ('generation','total_mw')]})
    except (OSError, ValueError, KeyError, TypeError):
        return None


def replay(forecast, demand_rows, generation_rows):
    """Diagnostic next-hour replay, explicitly assuming a one-hour ERP delay.

    This is not a record of issues published in the past. Fixed parameters are
    not selected on replay results; even the latest reading has aged an hour.
    """
    day = forecast['date']
    issues = []
    current = dict(today_date=day, source_dates=dict(demand=day, generation=day))
    for h in range(1, 23):
        # At hh:05, assume only readings through (hh-1):00 were available.
        through = HOURS[h-1]
        current['demand_hourly'] = [r for r in demand_rows if r.get('time') in HOURS and r['time'] <= through]
        current['generation_hourly'] = [r for r in generation_rows if r.get('time') in HOURS and r['time'] <= through]
        issue = make_issue(current, forecast, hour_stamp(day, HOURS[h]).replace(minute=5).isoformat())
        if issue:
            issues.append(issue)
    return {target: matched_scores(issues, day, target,
                {r['time']: r[field] for r in rows if number(r.get(field))})
            for target, rows, field in [('demand', demand_rows, 'demand_mw'),
                                        ('generation', generation_rows, 'total_mw')]}
