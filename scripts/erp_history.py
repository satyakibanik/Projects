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
            generation='https://erp.powergrid.gov.bd/w/generations/view_generations',
            generation_detail='https://erp.powergrid.gov.bd/w/generations/view_generations',
            imports='https://erp.powergrid.gov.bd/w/generations/imported_power_india',
            generation_demand='https://erp.powergrid.gov.bd/web/generations/view_demand_supply_loadshed?d_gen=1')
AVAILABILITY = 'ERP historical issue/revision timestamps are unavailable; availability on D+1 is assumed for retrospective evaluation.'


def parse_table(body, kind, expected_date=None):
    from server import DataTableParser, parse_number
    parser = DataTableParser()
    text = body.decode('utf-8', errors='replace')
    parser.feed(text)
    headers = ' '.join(' '.join(row) for row in parser.rows if 'Demand' in ' '.join(row) or 'Generation' in ' '.join(row))
    if kind == 'demand' and ('Substation Side' not in headers or 'Supply' not in headers):
        raise ValueError('Expected explicitly identified substation-side demand/supply table')
    if kind == 'generation_demand' and ('Generation Side' not in headers or 'Demand' not in headers):
        raise ValueError('Expected explicitly identified generation-side demand table')
    if kind in ('generation', 'generation_detail') and 'Generation' not in headers:
        raise ValueError('Expected national generation table')
    records = {}
    for row in parser.rows:
        if len(row) < (13 if kind in ('generation', 'generation_detail') else 8 if kind == 'imports' else 6):
            continue
        try:
            day = dt.datetime.strptime(row[0], '%d-%m-%Y').date().isoformat()
        except ValueError:
            continue
        if expected_date is not None and day != expected_date:
            continue
        clock = re.match(r'^(\d{1,2}:\d{2})(?::\d{2})?\b', row[1])
        if not clock:
            continue
        time = clock[1].zfill(5)
        record = dict(date=day, time=time)
        fields = [('demand_mw', 2), ('supply_mw', 3), ('shed_mw', 4)] if kind == 'demand' else [('generation_mw', 2)]
        if kind == 'generation_demand':
            fields = [('demand_mw', 2), ('generation_mw', 3), ('shed_mw', 4)]
        if kind == 'generation_detail':
            fields = [('total_mw', 2), ('gas_mw', 3), ('liquid_mw', 4), ('coal_mw', 5), ('hydro_mw', 6), ('solar_mw', 7), ('wind_mw', 8), ('bheramara_mw', 9), ('tripura_mw', 10), ('adani_mw', 11), ('nepal_mw', 12)]
        if kind == 'imports':
            fields = [('bheramara_mw', 2), ('tripura_mw', 4), ('adani_mw', 6)]
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
    keys = ['demand_mw'] if kind in ('demand', 'generation_demand') else ['generation_mw']
    if kind == 'generation_detail':
        keys = ['total_mw', 'gas_mw', 'liquid_mw', 'coal_mw', 'hydro_mw', 'solar_mw', 'wind_mw', 'bheramara_mw', 'tripura_mw', 'adani_mw', 'nepal_mw']
    if kind == 'imports':
        keys = ['bheramara_mw', 'tripura_mw', 'adani_mw']
    return [r['time'] for r in exact] == HOURS and all(r.get(key) is not None for r in exact for key in keys)


def load_range(kind, start, end, cache):
    folder = Path(cache) / 'erp-history' / kind
    manifest_path = folder / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else dict(source=URLS[kind], captures=[], days={})
    folder.mkdir(parents=True, exist_ok=True)

    def fetch(day):
        params = dict(search=dt.date.fromisoformat(day).strftime('%d-%m-%Y'))
        observed, captures = {}, []
        page, pages = 1, 1
        while page <= pages:
            url = URLS[kind] + ('&' if '?' in URLS[kind] else '?') + urlencode(dict(params, page=page))
            body = download(url)
            rows, pages = parse_table(body, kind, expected_date=day)
            digest = hashlib.sha256(body).hexdigest()
            raw = folder / 'raw' / (digest + '.html')
            raw.parent.mkdir(exist_ok=True)
            if not raw.exists():
                raw.write_bytes(body)
            captures.append(dict(url=url, retrieved_at=utc_now(), sha256=digest,
                                 raw=str(raw.relative_to(folder))))
            for row in rows:
                if row['time'] in observed and observed[row['time']] != row:
                    raise ValueError(f"Conflicting {kind} rows at {day} {row['time']}")
                observed[row['time']] = row
            page += 1
        return sorted(observed.values(), key=lambda r: r['time']), captures

    wanted = [(dt.date.fromisoformat(start) + dt.timedelta(days=n)).isoformat()
              for n in range((dt.date.fromisoformat(end)-dt.date.fromisoformat(start)).days+1)]
    missing = [d for d in wanted if not complete(manifest['days'].get(d, []), kind)]
    # Query only needed dates. A duplicate on an unrelated old archive page must
    # not abort every forecast, and one failed day must not discard other days.
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [(day, pool.submit(fetch, day)) for day in missing]
        for day, future in futures:
            try:
                rows, captures = future.result()
                manifest['captures'].extend(captures)
                existing = {r['time']: r for r in manifest['days'].get(day, [])}
                existing.update({r['time']: r for r in rows})
                manifest['days'][day] = sorted(existing.values(), key=lambda r: r['time'])
                manifest.setdefault('failures', {}).pop(day, None)
            except Exception as error:
                manifest.setdefault('failures', {})[day] = f'{type(error).__name__}: {error}'
                print(f'ERP {kind} unavailable for {day}: {error}', flush=True)
            manifest.update(availability=AVAILABILITY, updated_at=utc_now())
            atomic_json(manifest_path, manifest)

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


def attach_realtime_history(current_day, cache):
    """Publish yesterday's display-only fuel and route readings separately from model inputs."""
    today = current_day.get('today_date')
    if not today:
        return
    yesterday = (dt.date.fromisoformat(today)-dt.timedelta(days=1)).isoformat()
    histories, errors = {}, {}
    for kind in ('generation_detail', 'imports'):
        try:
            manifest = load_range(kind, yesterday, yesterday, cache)
            histories[kind] = [row for row in manifest.get('days', {}).get(yesterday, []) if row.get('date', yesterday) == yesterday]
            if manifest.get('failures'):
                errors[kind] = manifest['failures']
        except Exception as error:
            histories[kind] = []
            errors[kind] = f'{type(error).__name__}: {error}'
    generation = histories['generation_detail']
    india = histories['imports']
    routes = [dict(name=name, date=yesterday, hourly=[dict(time=row['time'], mw=row.get(key)) for row in source])
              for name, key, source in [('Bheramara HVDC', 'bheramara_mw', india), ('Tripura', 'tripura_mw', india), ('Adani', 'adani_mw', india), ('Nepal', 'nepal_mw', generation)]]
    current_day['realtime_history'] = {yesterday: dict(date=yesterday, generation_hourly=generation, imports=routes,
        source_urls=[URLS['generation_detail'], URLS['imports']], errors=errors)}
