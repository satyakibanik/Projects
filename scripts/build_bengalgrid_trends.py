#!/usr/bin/env python3
"""Build attributed daily/monthly display aggregates; never modify BengalGrid CSV."""
import argparse
import collections
import csv
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import statistics

SOURCE = 'https://data.mendeley.com/datasets/xx9dhmy9rj/2'
# Figure 7b / Table 9: historical Generation_MW IQR display bounds, not a general operating limit.
LOWER, UPPER = 756.0, 17468.0


def aggregate(path):
    daily, monthly = collections.defaultdict(list), collections.defaultdict(list)
    raw_counts = collections.Counter()
    excluded = []
    with path.open(newline='', encoding='utf-8-sig') as stream:
        rows = list(csv.DictReader(stream))
    # Match the dataset's duplicate policy, if a future export includes duplicates.
    unique = {row['datetime']: row for row in rows}
    for timestamp, row in sorted(unique.items()):
        date = dt.datetime.fromisoformat(timestamp).date().isoformat()
        try:
            value = float(row['Generation_MW'])
        except (ValueError, TypeError):
            continue
        if not math.isfinite(value):
            continue
        raw_counts[date] += 1
        if not LOWER <= value <= UPPER:
            excluded.append({'datetime': timestamp, 'generation_mw': value})
            continue
        daily[date].append(value)
        monthly[date[:7]].append(value)
    days = [{'date':date, 'mean_mw':round(statistics.mean(values), 6),
             'observations':len(values), 'excluded':raw_counts[date]-len(values)}
            for date, values in sorted(daily.items())]
    return {
        'source':SOURCE, 'doi':'10.17632/xx9dhmy9rj.2', 'license':'CC BY 4.0',
        'attribution':'BengalGrid v2 · Md Abir Rahman and Rafi Ahamed · Mendeley Data (2026)',
        'source_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
        'method':'Arithmetic daily mean of all retained observations, including source half-hour readings. Seven historical IQR-flagged generation records are excluded for display only. Raw CSV unchanged; missing dates remain gaps.',
        'display_bounds_mw':[LOWER, UPPER], 'excluded_records':excluded,
        'start_date':min(raw_counts), 'end_date':max(raw_counts), 'days':days,
        'months':[{'month':month, 'median_mw':round(statistics.median(values), 6),
                   'observations':len(values), 'days':sum(date.startswith(month) for date in daily)}
                  for month, values in sorted(monthly.items())],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'begd/bengalgrid-trends.json')
    args = parser.parse_args()
    data = aggregate(args.csv)
    args.output.write_text(json.dumps(data, ensure_ascii=False, separators=(',',':'))+'\n')
    print(f"Built {len(data['days'])} daily means, {len(data['months'])} months; {len(data['excluded_records'])} display exclusions")


if __name__ == '__main__':
    main()
