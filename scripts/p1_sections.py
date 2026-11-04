"""Resolve movable P1 demand and interconnector sections by their printed labels."""
import math
import re


def number(value):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def key(value):
    name = re.sub(r'[^a-z0-9]', '', str(value or '').lower().replace(' zone', ''))
    return {'cumila':'cumilla', 'comilla':'cumilla', 'chittagong':'chattogram', 'barisal':'barishal'}.get(name, name)


def regional_snapshot(sheet):
    for row in sheet.iter_rows(min_row=1, max_row=min(sheet.max_row, 100), max_col=15):
        headers = {key(cell.value): cell.column for cell in row if cell.value is not None}
        if not {'zone','loadshed','demand'} <= headers.keys():
            continue
        readings = {}
        for index in range(row[0].row + 1, min(row[0].row + 20, sheet.max_row) + 1):
            raw_name = sheet.cell(index, headers['zone']).value
            if not raw_name:
                continue
            name = key(raw_name)
            if name == 'total':
                break
            if name in readings:
                raise ValueError('Duplicate P1 regional demand row: '+str(raw_name))
            readings[name] = dict(demand_mw=number(sheet.cell(index, headers['demand']).value), shed_mw=number(sheet.cell(index, headers['loadshed']).value))
        heading = ' '.join(str(cell.value or '') for preceding in sheet.iter_rows(min_row=max(1,row[0].row-2), max_row=row[0].row-1, max_col=15) for cell in preceding)
        time = re.search(r'\b([0-2]?\d:[0-5]\d)\b', heading)
        return dict(readings=readings, time=time.group(1).zfill(5) if time else None, header_row=row[0].row)
    return dict(readings={}, time=None, header_row=None)


def east_west_totals(sheet):
    labels = {'energyflowfromeasttowest':'energy_east_to_west_kwh', 'energyflowfromwesttoeast':'energy_west_to_east_kwh', 'powerflowduringpeakdemandwe':'peak_west_to_east_mw', 'maximumpowerflowwe':'max_west_to_east_mw'}
    result = dict.fromkeys(labels.values())
    cells = {}
    for row in sheet.iter_rows(min_row=1, max_row=min(sheet.max_row,100), max_col=15):
        for cell in row:
            field = labels.get(key(cell.value))
            if field is None:
                continue
            # Stop at the next field rather than accidentally reading its import value.
            unit = next((item for item in row[cell.column:] if item.value is not None), None)
            factors = {'kwh':1, 'kwhr':1, 'mwh':1000, 'mwhr':1000, 'mkwh':1000000, 'mkwhr':1000000} if field.endswith('_kwh') else {'mw':1}
            factor = factors.get(key(unit.value)) if unit else None
            value = next((item for item in row[unit.column:] if item.value is not None), None) if factor is not None else None
            if field in cells:
                raise ValueError('Duplicate P1 interconnector field: '+str(cell.value))
            if value is not None and number(value.value) is not None:
                result[field], cells[field] = number(value.value)*factor, value.coordinate
    return dict(**result, cells=cells)


def p1_sections_cache_current(report):
    # Only the known shifted layout needs a cache migration; older archives remain usable.
    return 'Nuclear' not in report.get('fuels', {}) or report.get('p1_sections_version') == 2
