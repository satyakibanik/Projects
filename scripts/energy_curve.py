"""Read the En-Curve table and its labelled daily energy totals."""
import datetime as dt
import math
import re


def number(value):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def normalized(value):
    return re.sub(r'[^a-z0-9]', '', str(value or '').lower())


def extract_energy_curve(sheet):
    raw_date = sheet['B2'].value
    date = (raw_date.date() if isinstance(raw_date, dt.datetime) else raw_date).isoformat() if isinstance(raw_date, (dt.date, dt.datetime)) else dt.datetime.strptime(str(raw_date), '%d-%m-%Y').date().isoformat()
    headers = list(sheet[3])
    shortage = next((cell.column for cell in headers if normalized(cell.value) == 'shortage'), None)
    if shortage is None:
        raise ValueError('En-Curve source table has no Shortage header')
    columns = [(cell.column, str(cell.value).strip()) for cell in headers[1:shortage] if cell.value]
    sources = [dict(key=re.sub(r'[^a-z0-9]+', '_', label.lower()).strip('_') + '_mw', name=label) for _, label in columns]
    if len({source['key'] for source in sources}) != len(sources):
        raise ValueError('Duplicate En-Curve source header')
    hourly = []
    for row in range(4, sheet.max_row + 1):
        raw_time = sheet.cell(row, 1).value
        time = raw_time.strftime('%H:%M') if hasattr(raw_time, 'strftime') else str(raw_time or '').strip()
        if not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d|24:00', time):
            continue
        values = {source['key']: number(sheet.cell(row, column).value) for source, (column, _) in zip(sources, columns)}
        generation = [value for key, value in values.items() if key != 'shortage_mw']
        hourly.append(dict(time=time, **values, total_generation_mw=sum(generation) if all(value is not None for value in generation) else None))
    labels = {'energygenerated': 'energy_generated_mwh', 'energynotserved': 'energy_not_served_mwh', 'totalenergyrequirement': 'total_requirement_mwh'}
    units = {'mkwhr': 1000, 'mkwh': 1000, 'gwh': 1000, 'gwhr': 1000, 'mwh': 1, 'mwhr': 1, 'kwh': .001, 'kwhr': .001}
    totals = {key: None for key in labels.values()}
    source_cells = {}
    for row in sheet.iter_rows():
        for cell in row:
            key = labels.get(normalized(cell.value))
            if key is None:
                continue
            following = row[cell.column:]
            values = [item for item in following if number(item.value) is not None]
            multipliers = [units[normalized(item.value)] for item in following if normalized(item.value) in units]
            if len(values) != 1 or len(multipliers) != 1:
                raise ValueError(f'En-Curve {cell.value}: expected one daily total and an energy unit')
            if key in source_cells:
                raise ValueError(f'Duplicate En-Curve daily total: {cell.value}')
            totals[key] = number(values[0].value) * multipliers[0]
            source_cells[key] = values[0].coordinate
    if any(value is None or value < 0 for value in totals.values()):
        raise ValueError('Missing or invalid labelled En-Curve daily energy totals')
    if abs(totals['energy_generated_mwh'] + totals['energy_not_served_mwh'] - totals['total_requirement_mwh']) > .1:
        raise ValueError('En-Curve daily energy totals do not reconcile')
    return dict(date=date, sources=sources, hourly=hourly, totals=totals, total_cells=source_cells)


def energy_curve_cache_current(report):
    """Reparse affected cached reports instead of preserving missing daily totals."""
    curve = report.get('en_curve')
    return not curve or all(number(curve.get('totals', {}).get(key)) is not None for key in ('energy_generated_mwh', 'energy_not_served_mwh', 'total_requirement_mwh'))
