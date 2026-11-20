"""Daily plant and station histories, published as small on-demand entity files."""
import datetime as dt
import hashlib
import json
import re
import unicodedata

from trends import number


def key(name):
    text = unicodedata.normalize('NFKD', str(name)).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]', '', text)


def first(*values):
    return next((value for value in values if number(value) is not None), None)


def plant_rows(report):
    p2 = {key(row['name']): row for row in report.get('plants', [])}
    matched = set()
    for unit in report.get('plant_units', []):
        name = unit['name']
        base = re.sub(r'\s*\((?:gas|hsd|hfo|diesel|coal)\)\s*$', '', name, flags=re.I)
        p2_key = next((value for value in (key(name), key(base)) if value in p2), None)
        other = p2.get(p2_key, {})
        matched.add(p2_key)
        yield plant_day(unit, other)
    for name, plant in p2.items():
        # P2 also lists cross-border routes; those are not domestic plants.
        if name not in matched and not any(token in plant['name'].lower() for token in ('hvdc', 'tripura', 'adani', 'nepal')):
            yield plant_day(plant, {})


def plant_day(plant, other):
    installed = number(first(plant.get('installed_capacity_mw'), other.get('installed_capacity_mw')))
    present = number(first(plant.get('present_capacity_mw'), other.get('present_capacity_mw'),
                           plant.get('capacity_mw'), other.get('capacity_mw')))
    peak = number(first(plant.get('peak_generation_mw'), plant.get('peak_mw'), other.get('peak_mw')))
    energy = number(first(plant.get('energy_mwh'), other.get('energy_mwh')))
    # Running-hour counts are estimates from hourly samples, never measured duration.
    hourly = {row['time']: number(row.get('mw')) for row in plant.get('hourly', [])
              if re.fullmatch(r'(?:[01]\d|2[0-3]):00', str(row.get('time', '')))}
    complete = len(hourly) == 24 and all(value is not None for value in hourly.values())
    hours = sum(value > 0 for value in hourly.values()) if complete else None
    return dict(name=plant['name'], installed_capacity_mw=installed, present_capacity_mw=present,
                peak_generation_mw=peak,
                capacity_factor_pct=number(energy / (installed * 24) * 100) if installed and energy is not None else None,
                puf_pct=number(energy / (installed * hours) * 100) if installed and hours and energy is not None else None,
                utilization_ratio_pct=number(peak / installed * 100) if installed and peak is not None else None,
                operating_hours_estimate=hours)


def station_rows(report):
    rows = {}
    for voltage in report.get('voltages', []):
        identity = key(voltage['name']) + '|' + voltage.get('voltage_class', 'Unknown')
        low, high = number(voltage.get('min_kv')), number(voltage.get('max_kv'))
        valid = low is not None and high is not None and 0 < low <= high
        rows[identity] = dict(name=voltage['name'], voltage_class=voltage.get('voltage_class', 'Unknown'),
                              load_mw=None, min_kv=low if valid else None, max_kv=high if valid else None)
    for load in report.get('substations', []):
        matches = [row for row in rows.values() if key(row['name']) == key(load['name'])]
        if not matches:
            row = dict(name=load['name'], voltage_class='', min_kv=None, max_kv=None)
            rows[key(load['name']) + '|'] = row
            matches = [row]
        for row in matches:
            row['load_mw'] = number(load.get('load_mw'))
    return rows.values()


def write_entity_history(reports, output, generated_at, end_date=None):
    """Select one authoritative full report per date; national-only reports add no entities."""
    reports = list(reports)
    end_date = end_date or max((report['date'] for report in reports), default=None)
    selected = {}
    if end_date:
        start = (dt.date.fromisoformat(end_date) - dt.timedelta(days=364)).isoformat()
        for report in reports:
            if report.get('_trends_only') or not start <= report['date'] <= end_date:
                continue
            day = dt.date.fromisoformat(report['date'])
            published = dt.date.fromisoformat(report.get('published_date') or report['date'])
            score = (abs((published - day).days - 1), -int(report.get('report_id') or 0))
            if report['date'] not in selected or score < selected[report['date']][0]:
                selected[report['date']] = (score, report)
    entities = {'plants': {}, 'substations': {}}
    sources = {}
    for date, (_, report) in sorted(selected.items()):
        sources[date] = dict(report_id=report.get('report_id'), source_url=report.get('source_url'))
        for kind, rows in [('plants', plant_rows(report)), ('substations', station_rows(report))]:
            for row in rows:
                identity = key(row['name']) + ('|' + row.get('voltage_class', '') if kind == 'substations' else '')
                entity = entities[kind].setdefault(identity, dict(name=row['name'], voltage_class=row.get('voltage_class'), days=[]))
                entity['name'] = row.pop('name')  # latest spelling for display; no fuzzy unit merges
                row.pop('voltage_class', None)
                entity['days'].append(dict(date=date, **row))
    output.mkdir(parents=True, exist_ok=True)
    index = dict(version=1, generated_at=generated_at, end_date=end_date, sources=sources, plants=[], substations=[])
    for kind, catalog in entities.items():
        (output / kind).mkdir(exist_ok=True)
        for identity, entity in sorted(catalog.items(), key=lambda item: item[1]['name'].casefold()):
            entity_id = hashlib.sha256(identity.encode()).hexdigest()[:16]
            meta = dict(id=entity_id, name=entity['name'], voltage_class=entity['voltage_class'],
                        first_date=entity['days'][0]['date'], last_date=entity['days'][-1]['date'], latest=entity['days'][-1])
            meta['available_through'] = {}
            for row in entity['days']:
                for field, value in row.items():
                    if number(value) is not None:
                        meta['available_through'][field] = row['date']
            index[kind].append(meta)
            (output / kind / f'{entity_id}.json').write_text(json.dumps(entity, allow_nan=False, separators=(',', ':')), encoding='utf-8')
    (output / 'index.json').write_text(json.dumps(index, allow_nan=False, separators=(',', ':')), encoding='utf-8')
    return index
