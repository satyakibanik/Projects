"""Compact daily aggregates from authoritative operating-day workbooks.

No hourly MW sums or inferred load shedding; missing fields stay null.
"""
import datetime as dt
import math
from import_report import fuel_columns
from p1_sections import regional_snapshot, key as region_key
from water_level import extract_water_level, water_level_summary
from operational_events import extract_event_log


def number(value):
    return round(value, 6) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None


def daylight_times(date):
    """Estimated sunrise and sunset at Dhaka, returned as BST minutes after midnight."""
    if not isinstance(date, str):
        return None
    try:
        day = dt.date.fromisoformat(date)
    except ValueError:
        return None
    if day.isoformat() != date:
        return None
    year_start = dt.date(day.year, 1, 1)
    year_days = (dt.date(day.year + 1, 1, 1) - year_start).days
    ordinal = day.timetuple().tm_yday
    g = 2 * math.pi / year_days * (ordinal - 1)
    equation = 229.18 * (.000075 + .001868 * math.cos(g) - .032077 * math.sin(g)
                         - .014615 * math.cos(2*g) - .040849 * math.sin(2*g))
    decl = (.006918 - .399912 * math.cos(g) + .070257 * math.sin(g)
            - .006758 * math.cos(2*g) + .000907 * math.sin(2*g)
            - .002697 * math.cos(3*g) + .00148 * math.sin(3*g))
    radians = math.pi / 180
    lat = 23.8103 * radians
    argument = math.cos(90.833 * radians) / (math.cos(lat) * math.cos(decl)) - math.tan(lat) * math.tan(decl)
    if not -1 <= argument <= 1:
        return None
    hour_angle = math.degrees(math.acos(argument))
    noon = 720 - 4 * 90.4125 - equation + 360
    return noon - 4 * hour_angle, noon + 4 * hour_angle


def time_minute(value):
    try:
        parsed = dt.datetime.strptime(value, '%H:%M')
    except (TypeError, ValueError):
        return None
    return parsed.hour * 60 + parsed.minute


def peak_time_delta(actuals, forecasts, start, end):
    actual_rows = [(time_minute(row.get('time')), number(row.get('demand_mw')), row)
                   for row in actuals]
    forecast_rows = [(time_minute(row.get('time')), number(row.get('demand_mw')), row)
                     for row in forecasts]
    actual_rows = [(minute, demand, row) for minute, demand, row in actual_rows
                   if minute is not None and demand is not None and start <= minute < end]
    forecast_rows = [(minute, demand, row) for minute, demand, row in forecast_rows
                     if minute is not None and demand is not None and start <= minute < end]
    if not actual_rows or not forecast_rows:
        return None
    actual_peak = max(actual_rows, key=lambda item: item[1])
    forecast_peak = max(forecast_rows, key=lambda item: item[1])
    return actual_peak[0] - forecast_peak[0]


def temperature(value):
    """A signed Celsius reading; missing and non-finite values remain unavailable."""
    return round(value, 6) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def daily_summary(report, forecast=None):
    summary = report.get('summary') or {}
    curve = report.get('en_curve') or {}
    totals = curve.get('totals') or {} if curve.get('date') == report['date'] else {}
    requirement = number(totals.get('total_requirement_mwh'))
    basis = 'En-Curve published requirement' if requirement is not None else None
    generated, unserved = number(summary.get('energy_mwh')), number(summary.get('unserved_mwh'))
    if requirement is None and generated is not None and unserved is not None:
        requirement = round(generated + unserved, 6)
        basis = 'P1 generation + reported energy not served'
    shedding = [number(row.get('shed_mw')) for row in report.get('hourly', [])]
    shedding = [value for value in shedding if value is not None]
    hourly = report.get('hourly', [])
    demand_rows = sorted((row for row in hourly if number(row.get('demand_mw')) is not None),
                         key=lambda row: str(row.get('time', '')))
    def largest_ramp(direction):
        best = None
        for before, after in zip(demand_rows, demand_rows[1:]):
            try:
                a = dt.datetime.strptime(before['time'], '%H:%M')
                b = dt.datetime.strptime(after['time'], '%H:%M')
            except (KeyError, TypeError, ValueError):
                continue
            delta = number(after.get('demand_mw')) - number(before.get('demand_mw'))
            if (b - a).total_seconds() != 3600 or (delta > 0 if direction > 0 else delta < 0) is False:
                continue
            value = abs(delta)
            if best is None or value > best['value']:
                best = {'value': value, 'from': before['time'], 'to': after['time']}
        return best
    peak_demand = number(summary.get('peak_demand_mw'))
    peak_rows = [row for row in demand_rows if number(row.get('demand_mw')) == peak_demand]
    if peak_demand is None and demand_rows:
        peak_demand = max(number(row.get('demand_mw')) for row in demand_rows)
        peak_rows = [row for row in demand_rows if number(row.get('demand_mw')) == peak_demand]
    forecast = forecast or {}
    plant_energy = {}
    for plant in report.get('plants', []):
        name = ' '.join(str(plant.get('name') or '').split())
        energy = number(plant.get('energy_mwh'))
        if not name or energy is None:
            continue
        key = name.casefold()
        if key not in plant_energy:
            plant_energy[key] = {'name': name, 'energy_mwh': 0}
        plant_energy[key]['energy_mwh'] = round(plant_energy[key]['energy_mwh'] + energy, 6)
    return {
        'date': report['date'], 'report_id': report.get('report_id'),
        'source_url': report.get('source_url'),
        'quality_notes': report.get('quality_notes', []),
        'generation_mwh': number(summary.get('energy_mwh')),
        'peak_demand_mw': peak_demand,
        'peak_generation_mw': number(summary.get('peak_generation_mw')),
        'peak_demand_time': peak_rows[0].get('time') if peak_rows else None,
        'forecast_error_mw': forecast.get('error_mw'),
        'forecast_peak_time_delta_minutes': forecast.get('peak_time_delta_minutes'),
        'forecast_daytime_peak_time_delta_minutes': forecast.get('daytime_peak_time_delta_minutes'),
        'forecast_evening_peak_time_delta_minutes': forecast.get('evening_peak_time_delta_minutes'),
        'ramp_up_mw': (largest_ramp(1) or {}).get('value'),
        'ramp_up_interval': largest_ramp(1),
        'ramp_down_mw': (largest_ramp(-1) or {}).get('value'),
        'ramp_down_interval': largest_ramp(-1),
        'temperature_c': temperature(summary.get('temperature_c')),
        'water_level': water_level_summary(report),
        'demand_mwh': requirement, 'demand_basis': basis,
        'shed_peak_mw': max(shedding) if shedding else None,
        'regional_shed_mw': {region['name']: number(region.get('shed_mw')) for region in report.get('regions', [])},
        'unserved_mwh': number(summary.get('unserved_mwh')),
        'imports_mwh': number(summary.get('import_mwh')),
        'fuels': {key: number(value) for key, value in (report.get('fuels') or {}).items()},
        'routes': {route['name']: number(route.get('energy_mwh')) for route in report.get('imports', [])},
        '_plant_energy_mwh': plant_energy,
    }


def build_trends(reports, generated_at):
    # Same operating-day precedence as the archive: next-day publication, then newest ID.
    selected = {}
    for report in reports:
        day = dt.date.fromisoformat(report['date'])
        published = dt.date.fromisoformat(report.get('published_date') or report['date'])
        score = (abs((published - day).days - 1), -int(report.get('report_id') or 0))
        if day not in selected or score < selected[day][0]:
            selected[day] = (score, report)
    if not selected:
        return {'generated_at': generated_at, 'end_date': None, 'days': []}
    forecasts = {}
    for report in reports:
        forecast = report.get('forecast') or {}
        target = forecast.get('date')
        if not target:
            continue
        points = [row for row in forecast.get('demand_hourly', [])
                  if number(row.get('demand_mw')) is not None and row.get('time')]
        if points:
            source_day = dt.date.fromisoformat(report.get('date', target))
            target_day = dt.date.fromisoformat(target)
            published = dt.date.fromisoformat(report.get('published_date') or report.get('date', target))
            # Match the selected operating-date semantics and avoid future source reports.
            if source_day >= target_day:
                continue
            score = ((target_day - source_day).days,
                     abs((published - (source_day + dt.timedelta(days=1))).days),
                     -int(report.get('report_id') or 0))
            previous = forecasts.get(target)
            if previous is None or score < previous[0]:
                forecasts[target] = (score, points)
    forecast_metrics = {}
    for day, (_, report) in selected.items():
        points = forecasts.get(day.isoformat(), (None, []))[1]
        actuals = [row for row in report.get('hourly', [])
                   if number(row.get('demand_mw')) is not None and row.get('time')]
        if not points or not actuals:
            continue
        actual_peak = max(actuals, key=lambda row: number(row['demand_mw']))
        predicted = next((row for row in points if row['time'] == actual_peak['time']), None)
        predicted_peak = max(points, key=lambda row: number(row['demand_mw']))
        try:
            actual_time = time_minute(actual_peak.get('time'))
            forecast_time = time_minute(predicted_peak.get('time'))
        except (TypeError, ValueError):
            time_delta = None
        else:
            time_delta = actual_time - forecast_time if actual_time is not None and forecast_time is not None else None
        daylight = daylight_times(day.isoformat())
        daytime_delta = evening_delta = None
        if daylight:
            sunrise, sunset = daylight
            daytime_delta = peak_time_delta(actuals, points, sunrise, sunset)
            evening_delta = peak_time_delta(actuals, points, sunset, 1440)
        forecast_metrics[day.isoformat()] = {
            'error_mw': number(actual_peak['demand_mw']) - number(predicted['demand_mw']) if predicted else None,
            'peak_time_delta_minutes': time_delta,
            'daytime_peak_time_delta_minutes': daytime_delta,
            'evening_peak_time_delta_minutes': evening_delta,
        }
    end = max(selected)
    start = end - dt.timedelta(days=364)
    summaries = [daily_summary(selected[day][1], forecast_metrics.get(day.isoformat()))
                 for day in sorted(selected) if day >= start]
    for index, row in enumerate(summaries):
        previous = summaries[index - 1] if index else None
        current_imports, previous_imports = row.get('imports_mwh'), previous and previous.get('imports_mwh')
        row['imports_drop_mwh'] = (round(max(0, previous_imports - current_imports), 6)
                                   if previous_imports is not None and current_imports is not None else None)
        current_plants = row.get('_plant_energy_mwh', {})
        previous_plants = previous.get('_plant_energy_mwh', {}) if previous else {}
        changes = []
        for key in current_plants.keys() & previous_plants.keys():
            current = current_plants[key]
            before = previous_plants[key]
            changes.append({'name': current['name'], 'change_mwh': round(current['energy_mwh'] - before['energy_mwh'], 6),
                            'current_mwh': current['energy_mwh'], 'previous_mwh': before['energy_mwh']})
        rise = max((change for change in changes if change['change_mwh'] > 0),
                   key=lambda change: change['change_mwh'], default=None)
        drop = min((change for change in changes if change['change_mwh'] < 0),
                   key=lambda change: change['change_mwh'], default=None)
        row['plant_output_rise_mwh'] = rise['change_mwh'] if rise else 0 if previous else None
        row['plant_output_rise_detail'] = rise
        row['plant_output_drop_mwh'] = abs(drop['change_mwh']) if drop else 0 if previous else None
        row['plant_output_drop_detail'] = drop
    for row in summaries:
        row.pop('_plant_energy_mwh', None)
    return {'generated_at': generated_at, 'end_date': end.isoformat(), 'days': summaries}


def extract_trend_workbook(content, item):
    """Read national totals independently of unrelated plant/region reconciliation.

    Keep raw reported values and disclose inconsistent subtotals; do not repair them.
    Only the explicitly supported P1/P4 layout is accepted.
    """
    import io
    import openpyxl
    workbook = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    if not {'P1', 'P4'} <= set(workbook.sheetnames):
        raise ValueError('Unsupported national-trends workbook layout')
    sheet = workbook['P1']
    raw_date = sheet['D6'].value
    if isinstance(raw_date, dt.datetime):
        day = raw_date.date()
    elif isinstance(raw_date, dt.date):
        day = raw_date
    else:
        day = dt.datetime.strptime(str(raw_date).strip(), '%d-%m-%Y').date()
    def energy(value):
        value = number(value)
        return round(value * 1000, 6) if value is not None else None
    fuels = {fuel:energy(sheet.cell(26, col).value) for fuel, col in fuel_columns(sheet).items()}
    hourly = [{'time':str(row[1].value)[:5], 'generation_mw':number(row[2].value),
               'shed_mw':number(row[4].value), 'demand_mw':number(row[6].value)}
              for row in workbook['P4'].iter_rows(min_row=9, max_row=33, max_col=7)]
    routes = []
    if 'GenLog' in workbook.sheetnames:
        log = workbook['GenLog']
        for col in range(2, log.max_column + 1):
            name = str(log.cell(11, col).value or '')
            if any(token in name.lower() for token in ['hvdc','tripura','adani','nepal']):
                kwh = number(log.cell(38, col).value)
                routes.append({'name':name, 'energy_mwh':round(kwh / 1000, 6) if kwh is not None else None})
    snapshot = regional_snapshot(sheet)
    report = {'p1_sections_version':2, 'regional_snapshot':{key:value for key,value in snapshot.items() if key != 'readings'}, 'date':day.isoformat(), 'report_id':item['id'], 'published_date':item['published_date'],
              'water_level':extract_water_level(workbook),
              'regions':[{'name':str(sheet.cell(row,2).value).replace(' Zone',''),
                          **snapshot['readings'].get(region_key(sheet.cell(row,2).value), {'shed_mw':None,'demand_mw':None})}
                         for row in range(17,26) if sheet.cell(row,2).value],
              'operations':extract_event_log(sheet),
              'source_url':item['download_url'], 'fuels':fuels, 'hourly':hourly, 'imports':routes,
              'summary':{'energy_mwh':energy(sheet['K8'].value), 'unserved_mwh':energy(sheet['K9'].value),
                         'import_mwh':energy(sheet.cell(26, fuel_columns(sheet)['Imports']).value), 'temperature_c':temperature(sheet['K11'].value)}}
    notes = ['National totals extracted separately; full workbook parser rejected this report.']
    generated = report['summary']['energy_mwh']
    if generated is None:
        raise ValueError('Missing national daily energy total')
    if all(value is not None for value in fuels.values()) and abs(sum(fuels.values())-generated) >= .1:
        notes.append('Reported fuel subtotals do not reconcile to national energy; fuel mix omitted.')
        report['fuels'] = {fuel:None for fuel in fuels}
    imported = report['summary']['import_mwh']
    if imported is not None and all(route['energy_mwh'] is not None for route in routes) and abs(sum(route['energy_mwh'] for route in routes)-imported) >= .1:
        notes.append('Reported import route subtotals do not reconcile; route breakdown omitted.')
        report['imports'] = []
    report['quality_notes'] = notes
    report['_trends_only'] = True
    return report
