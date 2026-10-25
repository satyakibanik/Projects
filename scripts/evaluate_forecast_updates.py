"""Replay bias updates with a one-hour observation delay, without fitting.

Usage: python scripts/evaluate_forecast_updates.py current-day.json --output report.json
Also accepts the published live-data.js bundle. Results are diagnostic replay,
never the prospective saved-update MAE shown on the dashboard.
"""
import argparse
import datetime as dt
import json
from pathlib import Path

from forecast_updates import BST, replay, stamp


def evaluate(data):
    current = data.get('current_day', data)
    days = dict(current.get('forecast_history', {}))
    days[current['today_date']] = dict(forecast=current.get('independent_forecast'),
        demand_hourly=current.get('demand_hourly', []), generation_hourly=current.get('generation_hourly', []))
    results, skipped = {}, {}
    for day, value in sorted(days.items()):
        forecast = value.get('forecast')
        # No post-hoc daily reconstructions, even in this diagnostic replay.
        if (not forecast or forecast.get('status') != 'ready' or forecast.get('date') != day or
                forecast.get('publication_kind') == 'retrospective' or
                stamp(forecast['issued_at']) >= dt.datetime.fromisoformat(day).replace(tzinfo=BST)):
            skipped[day] = 'No daily forecast issued before the operating day'
            continue
        scores = replay(forecast, value.get('demand_hourly', []), value.get('generation_hourly', []))
        if any(score['count'] for score in scores.values()):
            results[day] = scores
    totals = {}
    for target in ('demand', 'generation'):
        scores = [day[target] for day in results.values() if day[target]['count']]
        count = sum(s['count'] for s in scores)
        totals[target] = dict(count=count, **{key:sum(s[key]*s['count'] for s in scores)/count if count else None
            for key in ('updated_mae_mw', 'original_mae_mw')})
    return dict(kind='diagnostic replay; not recorded live issues',
        availability_assumption='At hh:05, only readings through (hh-1):00 are supplied. ERP historical publication timestamps are unavailable.',
        parameters='Fixed before replay: last 3 residuals, minimum 2 consecutive readings, 80% median bias, 6-hour half-life, 15% cap.',
        scores=totals, days=results, skipped=skipped)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    text = args.input.read_text()
    if text.startswith('window.BEGD_STATIC_DATA='):
        text = text.split('=', 1)[1].strip().rstrip(';')
    report = evaluate(json.loads(text))
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    print(json.dumps(report['scores'], indent=2))


if __name__ == '__main__':
    main()
