"""Verified ERP table snapshots for substation demand and national generation.

ERP has no historical issue timestamps: D+1 availability is an explicit
retrospective assumption. Raw captures and their retrieval times are retained.
"""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlencode

from daily_forecast import HOURS, atomic_json, shift, utc_now

URLS = dict(demand='https://erp.powergrid.gov.bd/web/generations/view_demand_supply_loadshed',
            generation='https://erp.powergrid.gov.bd/w/generations/view_generations')
AVAILABILITY = 'ERP historical issue/revision timestamps are unavailable; availability on D+1 is assumed for retrospective evaluation.'


def parse_table(body, kind):
    from server import DataTableParser, parse_number
    parser = DataTableParser()
    text = body.decode('utf-8', errors='replace')
    parser.feed(text)
    headers = ' '.join(' '.join(row) for row in parser.rows if 'Demand' in ' '.join(row) or 'Generation' in ' '.join(row))
    if kind == 'demand' and ('Substation Side' not in headers or 'Supply' not in headers):
        raise ValueError('Expected explicitly identified substation-side demand/supply table')
    if kind == 'generation' and 'Generation' not in headers:
        raise ValueError('Expected national generation table')
    records = {}
    for row in parser.rows:
        if len(row) < (6 if kind == 'demand' else 13):
            continue
        try:
            day = dt.datetime.strptime(row[0], '%d-%m-%Y').date().isoformat()
        except ValueError:
            continue
        clock = re.match(r'^(\d{1,2}:\d{2})(?::\d{2})?\b', row[1])
        if not clock:
            continue
        time = clock[1].zfill(5)
        record = dict(date=day, time=time)
        fields = [('demand_mw', 2), ('supply_mw', 3), ('shed_mw', 4)] if kind == 'demand' else [('generation_mw', 2)]
        for name, index in fields:
            value = parse_number(row[index])
            record[name] = value if value is not None and value >= 0 else None
        key = (day, time)
        if key in records and records[key] != record:
            raise ValueError(f'Conflicting {kind} rows at {day} {time}')
        records[key] = record
    if not records:
        raise ValueError(f'No ERP {kind} records')
    return list(records.values()), max([int(p) for p in re.findall(r'[?&]page=(\d+)', text)] or [1])


def download(url):
    if os.environ.get('BEGD_ERP_USE_CURL') == '1':
        return subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location',
                               '--retry', '2', '--max-time', '45', url], check=True, capture_output=True).stdout
    import server
    return server.fetch_bytes(url, limit=8 * 1024 * 1024)


def complete(rows, kind):
    exact = sorted((r for r in rows if r['time'] in HOURS), key=lambda r: r['time'])
    key = 'demand_mw' if kind == 'demand' else 'generation_mw'
    return [r['time'] for r in exact] == HOURS and all(r.get(key) is not None for r in exact)


def load_range(kind, start, end, cache):
    folder = Path(cache) / 'erp-history' / kind
    manifest_path = folder / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else dict(source=URLS[kind], captures=[], days={})
    folder.mkdir(parents=True, exist_ok=True)

    def fetch(params):
        url = URLS[kind] + '?' + urlencode(params)
        body = download(url)
        rows, pages = parse_table(body, kind)
        digest = hashlib.sha256(body).hexdigest()
        raw = folder / 'raw' / (digest + '.html')
        raw.parent.mkdir(exist_ok=True)
        if not raw.exists():
            raw.write_bytes(body)
        return rows, pages, dict(url=url, retrieved_at=utc_now(), sha256=digest, raw=str(raw.relative_to(folder)))

    def merge(result):
        rows, pages, capture = result
        manifest['captures'].append(capture)
        grouped = {}
        for row in rows:
            grouped.setdefault(row['date'], []).append(row)
        for day, observed in grouped.items():
            existing = {r['time']: r for r in manifest['days'].get(day, [])}
            existing.update({r['time']: r for r in observed})
            manifest['days'][day] = sorted(existing.values(), key=lambda r: r['time'])
        manifest.update(availability=AVAILABILITY, updated_at=utc_now())
        atomic_json(manifest_path, manifest)
        return pages, min(r['date'] for r in rows)

    # First capture paginated history once. Subsequent runs fetch only missing dates.
    if not manifest['days']:
        pages, oldest = merge(fetch(dict(page=1)))
        with ThreadPoolExecutor(max_workers=3) as pool:
            for first in range(2, pages + 1, 3):
                for result in pool.map(fetch, [dict(page=p) for p in range(first, min(first+3, pages+1))]):
                    _, day = merge(result)
                    oldest = min(oldest, day)
                print(f'ERP {kind}: {len(manifest["captures"])} pages; oldest {oldest}', flush=True)
                if oldest < start:
                    break
    wanted = [(dt.date.fromisoformat(start) + dt.timedelta(days=n)).isoformat()
              for n in range((dt.date.fromisoformat(end)-dt.date.fromisoformat(start)).days+1)]
    missing = [d for d in wanted if not complete(manifest['days'].get(d, []), kind)]
    with ThreadPoolExecutor(max_workers=3) as pool:
        for result in pool.map(fetch, [dict(search=dt.date.fromisoformat(d).strftime('%d-%m-%Y')) for d in missing]):
            merge(result)
    return manifest


def align_records(records, demand, generation):
    """ERP labels only; workbook P1/availability remain lagged auxiliary inputs."""
    aligned, rejected = [], []
    for original in records:
        day = original['operating_date']
        d, g = demand['days'].get(day, []), generation['days'].get(day, [])
        if not complete(d, 'demand') or not complete(g, 'generation'):
            rejected.append(dict(date=day, reason='Incomplete exact-hour ERP demand or generation'))
            continue
        ds, gs = {r['time']: r for r in d}, {r['time']: r for r in g}
        aligned.append(dict(original, published_date=max(original['published_date'], shift(day, -1)),
                            label_basis=dict(demand='ERP substation side', generation='ERP generation including imports'),
                            actual=[dict(time=t, demand=ds[t]['demand_mw'], generation=gs[t]['generation_mw'],
                                         supply_mw=ds[t].get('supply_mw'), shed_mw=ds[t].get('shed_mw')) for t in HOURS]))
    return aligned, rejected


def load_erp_history(records, start, end, cache):
    demand = load_range('demand', start, end, cache)
    generation = load_range('generation', start, end, cache)
    aligned, rejected = align_records(records, demand, generation)
    return aligned, dict(demand=demand, generation=generation, rejected=rejected)
