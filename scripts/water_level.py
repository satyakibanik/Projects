"""Kaptai lake readings, in feet relative to mean sea level (not MW)."""
import math
import re
import statistics


def reading(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None


def extract_water_level(workbook):
    """Find the named column: FG in current reports, other columns in older ones."""
    name = next((n for n in workbook.sheetnames if n.lower() == 'genlog'), None)
    if name is None:
        return None
    sheet = workbook[name]
    headers = [cell for cell in sheet[11] if str(cell.value or '').strip().lower() == 'water level']
    if len(headers) != 1:
        return None
    header = headers[0]
    hourly = []
    for row in range(13, 38):
        raw_time = sheet.cell(row, 1).value
        time = raw_time.strftime('%H:%M') if hasattr(raw_time, 'strftime') else str(raw_time)[:5]
        if re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', time):
            hourly.append({'time':time, 'level_ft_msl':reading(sheet.cell(row, header.column).value)})
    return {'unit':'ft MSL', 'source_range':f'{name}!{header.column_letter}13:{header.column_letter}37', 'hourly':hourly}


def water_level_summary(report):
    """Support existing curated archives that stored Water Level as a plant."""
    water = report.get('water_level')
    if water is not None:
        hourly, field = water.get('hourly', []), 'level_ft_msl'
    else:
        plants = [p for p in report.get('plant_units', []) if p.get('name', '').strip().lower() == 'water level']
        hourly, field = (plants[0].get('hourly', []) if len(plants) == 1 else []), 'mw'
    values = {row['time']:reading(row.get(field)) for row in hourly
              if re.fullmatch(r'(?:[01]\d|2[0-3]):00', str(row.get('time', '')))}
    values = {time:value for time,value in values.items() if value is not None}
    return {'mean_ft_msl':round(statistics.mean(values.values()), 6) if values else None,
            'min_ft_msl':min(values.values()) if values else None,
            'max_ft_msl':max(values.values()) if values else None,
            'hours':len(values), 'source_range':water.get('source_range') if water else None,
            # Disclose the verified source typo without filtering or correcting it.
            'source_notes':(['22:00 reading is 160.02 ft MSL in the original workbook; retained unchanged.']
                            if report['date'] == '2026-09-24' and values.get('22:00') == 160.02 else [])}
