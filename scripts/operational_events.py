"""P1 event extraction and a separate, compact 365-day event-log bundle."""
import datetime as dt
import re

EVENT_LOG_VERSION = 1


def clock(value):
    if value is None or value == '':
        return '—'
    if isinstance(value, (dt.time, dt.datetime)):
        return value.strftime('%H:%M')
    return str(value).strip()[:5] or '—'


def extract_event_log(sheet):
    # The event header moves between rows 81–84 in recent workbooks. Starting
    # at a fixed row loses the first entries or keeps only a wrapped fragment.
    rows = list(sheet.iter_rows(min_row=1, max_col=4, values_only=True))
    header = next((i for i, row in enumerate(rows)
                   if re.sub(r'\s+', ' ', str(row[3] or '')).strip().lower() == 'description of event'), None)
    if header is None:
        return {'event_log_version': EVENT_LOG_VERSION, 'events': None}
    events, current = [], None
    for row_index in range(header + 1, len(rows)):
        _, outage, restoration, description = rows[row_index]
        if description is not None and str(description).strip():
            if outage or restoration or current is None:
                current = dict(outage_time=clock(outage), restoration_time=clock(restoration),
                               description=str(description).strip(), source_rows=[row_index + 1])
                events.append(current)
            else:
                current['description'] += ' ' + str(description).strip()
                current['source_rows'].append(row_index + 1)
        elif outage or restoration:
            current = None
    return {'event_log_version': EVENT_LOG_VERSION, 'events': events}


def event_cache_current(report, published_date, latest_published_date):
    # Backfill only the largest explorer window (+ one publication-day margin),
    # rather than invalidating the entire multi-year archive on the first build.
    recent = dt.date.fromisoformat(published_date) >= latest_published_date - dt.timedelta(days=365)
    return not recent or (report.get('operations') or {}).get('event_log_version') == EVENT_LOG_VERSION


def build_event_log(reports, generated_at, end_date):
    if not end_date:
        return dict(version=EVENT_LOG_VERSION, generated_at=generated_at, end_date=None, days=[])
    end = dt.date.fromisoformat(end_date)
    start = end - dt.timedelta(days=364)
    selected = {}
    for report in reports:
        day = dt.date.fromisoformat(report['date'])
        if not start <= day <= end:
            continue
        published = dt.date.fromisoformat(report.get('published_date') or report['date'])
        score = (abs((published - day).days - 1), -int(report.get('report_id') or 0))
        if day not in selected or score < selected[day][0]:
            selected[day] = (score, report)
    days = []
    for day in sorted(selected):
        report = selected[day][1]
        operations = report.get('operations') or {}
        # Old cache rows must never be represented as complete event logs.
        events = operations.get('events') if operations.get('event_log_version') == EVENT_LOG_VERSION else None
        days.append(dict(date=day.isoformat(), report_id=report.get('report_id'),
                         source_url=report.get('source_url'), events=events))
    return dict(version=EVENT_LOG_VERSION, generated_at=generated_at, end_date=end_date, days=days)
