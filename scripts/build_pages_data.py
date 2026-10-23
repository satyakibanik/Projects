#!/usr/bin/env python3
"""Build the GitHub Pages site and an hourly static ERP data bundle."""
import argparse
import datetime as dt
import hashlib
import json
import math
import pathlib
import re
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
DASHBOARD = ROOT / "begd"
WINDOW_DAYS = 14

sys.path.insert(0, str(SCRIPTS))
import server
from import_report import parse_report
from trends import build_trends, extract_trend_workbook


def attach_forecasts(records, reports_by_id, current_day, cache_dir):
    """Keep realtime forecasts independent of the report selected in the browser."""
    from daily_forecast import prepare_forecasts
    today = current_day.get('today_date')
    if not isinstance(today, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', today):
        current_day['pgcb_forecast'] = None
        current_day['independent_forecast'] = dict(status='unavailable', reason='Missing operating date')
        return {}
    matches = [r for r in reports_by_id.values()
               if r.get('forecast', {}).get('scenario_date') == today]
    pgcb = max(matches, key=lambda r: (r['published_date'], int(r['report_id'])), default=None)
    current_day['pgcb_forecast'] = (dict(date=today, hourly=pgcb['forecast']['demand_hourly'],
                                         report_name=pgcb['report_name'], source_url=pgcb['source_url'],
                                         published_date=pgcb['published_date']) if pgcb else None)
    forecasts = prepare_forecasts(records, current_day, cache_dir)
    current_day['independent_forecast'] = forecasts[today]
    # Expose previously issued curves with dated ERP actuals without changing
    # their immutable forecast files. The browser never borrows another day.
    from daily_forecast import VERSION, valid_forecast
    history = dict(forecasts)
    for path in (cache_dir/VERSION).glob('*.json'):
        try:
            value=json.loads(path.read_text())
            if valid_forecast(value,path.stem):history[path.stem]=value
        except (OSError,ValueError,TypeError):
            pass
    actuals={}
    for kind in ('demand','generation'):
        path=cache_dir/'erp-history'/kind/'manifest.json'
        try:actuals[kind]=json.loads(path.read_text())['days']
        except (OSError,ValueError,KeyError,TypeError):actuals[kind]={}
    scenarios={}
    for report in sorted(reports_by_id.values(),key=lambda r:r.get('published_date','')):
        forecast=report.get('forecast',{})
        day=forecast.get('scenario_date')
        if day:scenarios[day]=dict(date=day,hourly=forecast.get('demand_hourly',[]),
            published_date=report.get('published_date'),source_url=report.get('source_url'))
    fields=('version','status','date','issued_at','target_basis','models','hourly','input_cutoff_date','max_actual_input_date')
    ready_history={day:value for day,value in history.items() if valid_forecast(value,day)}
    dates=sorted(set(ready_history)|set(scenarios))[-35:]
    current_day['forecast_history']={day:dict(forecast={k:ready_history[day].get(k) for k in fields} if day in ready_history else None,
        demand_hourly=actuals['demand'].get(day,[]),
        generation_hourly=[dict(time=r['time'],total_mw=r.get('generation_mw')) for r in actuals['generation'].get(day,[])],
        pgcb_forecast=scenarios.get(day)) for day in dates}
    return forecasts


def available_reports():
    first_page, total_pages = server.fetch_listing_page(1)
    if not first_page:
        raise RuntimeError("The ERP archive returned no report rows")
    page_count = server.supported_page_limit(first_page, total_pages)
    records = list(first_page)
    for page in range(2, page_count + 1):
        rows, _ = server.fetch_listing_page(page)
        records.extend(rows)
    unique = {row["id"]: row for row in records}
    minimum = dt.date.fromisoformat(server.MIN_SUPPORTED_PUBLISHED_DATE)
    selected = [row for row in unique.values()
                if dt.date.fromisoformat(row["published_date"]) >= minimum]
    return sorted(selected, key=lambda row: (row["published_date"], int(row["id"])), reverse=True)


def parse_listing_item(item):
    workbook = server.fetch_bytes(item["download_url"], limit=server.MAX_REPORT_BYTES)
    report = parse_report(workbook, item["name"])
    report.update({
        "report_id": item["id"],
        "report_name": item["name"],
        "published_date": item["published_date"],
        "source_url": item["download_url"],
    })
    return report


def write_data_bundle(output_dir):
    failures = []
    try:
        records = available_reports()
    except Exception as error:
        print(f"Report archive unavailable: {type(error).__name__}: {error}")
        records = []
        failures.append(f"archive: {type(error).__name__}")

    reports_by_id = {}
    trend_reports = []
    if records:
        latest = max(dt.date.fromisoformat(item["published_date"]) for item in records)
        recent_start = latest - dt.timedelta(days=WINDOW_DAYS - 1)
    else:
        recent_start = dt.date.today() - dt.timedelta(days=WINDOW_DAYS - 1)
    cache_dir = ROOT / ".cache" / "historical-reports"
    cache_dir.mkdir(parents=True, exist_ok=True)

    def load_or_parse(item):
        cache_path = cache_dir / f"{item['id']}.json"
        trend_cache_path = cache_dir / f"{item['id']}-trends.json"
        is_recent = dt.date.fromisoformat(item["published_date"]) >= recent_start
        if not is_recent and cache_path.is_file():
            try:
                cached = json.loads(cache_path.read_text(encoding="utf-8"))
                if cached.get("report_id") == item["id"]:
                    return cached
            except (OSError, ValueError):
                pass
        if not is_recent and trend_cache_path.is_file():
            try:
                cached = json.loads(trend_cache_path.read_text(encoding="utf-8"))
                if cached.get("report_id") == item["id"] and cached.get("_trends_only") and "temperature_c" in cached.get("summary", {}):
                    return cached
            except (OSError, ValueError):
                pass
        try:
            report = parse_listing_item(item)
        except (AssertionError, ValueError, KeyError, TypeError) as error:
            # A plant/region or ancillary-sheet failure must not discard national totals.
            content = server.fetch_bytes(item["download_url"], limit=server.MAX_REPORT_BYTES)
            report = extract_trend_workbook(content, item)
            report['quality_notes'].append(f'Full parser: {type(error).__name__}: {error}')
            trend_cache_path.write_text(json.dumps(report, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            return report
        cache_path.write_text(json.dumps(report, ensure_ascii=False, separators=(",", ":")),
                              encoding="utf-8")
        return report

    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(load_or_parse, item): item for item in records}
        for future in as_completed(futures):
            item = futures[future]
            try:
                report = future.result()
                trend_reports.append(report)
                if not report.get("_trends_only"):
                    reports_by_id[report["report_id"]] = report
            except Exception as error:
                failures.append(f"{item['published_date']}: {type(error).__name__}")

    reports = [{key: item[key] for key in ("id", "name", "published_date")}
               for item in records if item["id"] in reports_by_id]
    if reports:
        latest_published = max(dt.date.fromisoformat(item["published_date"]) for item in reports)
        recent_start = latest_published - dt.timedelta(days=WINDOW_DAYS - 1)
    recent_ids = {
        item["id"] for item in reports
        if dt.date.fromisoformat(item["published_date"]) >= recent_start
    }
    recent_reports_by_id = {
        report_id: report for report_id, report in reports_by_id.items()
        if report_id in recent_ids
    }

    by_date = {}
    for report_id, report in reports_by_id.items():
        operating_date = report["date"]
        published_date = dt.date.fromisoformat(report["published_date"])
        operating = dt.date.fromisoformat(operating_date)
        score = (abs((published_date - (operating + dt.timedelta(days=1))).days),
                 -int(report_id))
        previous = by_date.get(operating_date)
        if previous is None or score < previous[0]:
            by_date[operating_date] = (score, report_id)

    highest = None
    try:
        highest = server.get_highest_generation_day()
        recent_reports_by_id[highest["report_id"]] = highest
        by_date[highest["date"]] = ((0, -int(highest["report_id"])), highest["report_id"])
    except Exception as error:
        print(f"Highest-generation comparison unavailable: {type(error).__name__}: {error}")

    try:
        current_day = server.get_current_day()
    except Exception as error:
        print(f"Current-day readings unavailable: {type(error).__name__}: {error}")
        current_day = {"updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                       "today_date": dt.datetime.now(dt.timezone(dt.timedelta(hours=6))).date().isoformat(),
                       "demand_hourly": [], "generation_hourly": [], "imports": [],
                       "source_dates": {}, "source_urls": [],
                       "error": "ERP readings were unavailable during this build."}

    forecasts = attach_forecasts(records, reports_by_id, current_day, ROOT / '.cache' / 'daily-forecasts')
    built_at = dt.datetime.now(dt.timezone.utc).isoformat()
    bundle = {
        "generated_at": built_at,
        "reports": reports,
        "reports_by_id": recent_reports_by_id,
        "reports_by_operating_date": {day: value[1] for day, value in by_date.items()},
        "current_day": current_day,
        "highest_generation": highest,
        "failures": failures,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    forecast_dir = output_dir / 'daily-forecasts'
    forecast_dir.mkdir(exist_ok=True)
    for day, forecast in forecasts.items():
        (forecast_dir / f'{day}.json').write_text(json.dumps(forecast, allow_nan=False, separators=(',', ':')))
    # Preserve earlier issued forecasts for later scoring; never replace them with a refit.
    from daily_forecast import VERSION, valid_forecast
    for saved in (ROOT / '.cache' / 'daily-forecasts' / VERSION).glob('*.json'):
        try:
            value = json.loads(saved.read_text())
            if valid_forecast(value, saved.stem):
                shutil.copy2(saved, forecast_dir / saved.name)
        except (OSError, ValueError, TypeError):
            pass
    (output_dir / "current-day.json").write_text(
        json.dumps(current_day, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    (output_dir / "trends-data.json").write_text(
        json.dumps(build_trends(trend_reports, built_at), ensure_ascii=False,
                   separators=(",", ":")), encoding="utf-8")
    archive_dir = output_dir / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    for report_id, report in reports_by_id.items():
        if report_id not in recent_ids:
            (archive_dir / f"{report_id}.json").write_text(
                json.dumps(report, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8")

    payload = json.dumps(bundle, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    (output_dir / "live-data.js").write_text(
        "window.BEGD_STATIC_DATA=" + payload + ";\n", encoding="utf-8")

    index = (DASHBOARD / "index.html").read_text(encoding="utf-8")
    version = built_at[:19].replace("-", "").replace(":", "") + "Z"
    index = index.replace(
        '<script src="app.js?v=',
        '<script src="live-data.js?build=' + version
        + '"></script><script src="static-api.js?v=current-day-v2"></script>'
        + '<script src="app.js?v=',
        1,
    )
    def version_script(match):
        script = match.group(1)
        asset_version = hashlib.sha256((DASHBOARD / script).read_bytes()).hexdigest()[:16]
        return f'{script}?v={asset_version}'

    index = re.sub(r'([\w-]+\.js)\?v=[^"\s]+', version_script, index)
    (output_dir / "index.html").write_text(index, encoding="utf-8")
    print(f"Built {len(reports)} reports ({len(recent_ids)} recent) and hourly readings at {built_at}")
    if failures:
        print(f"Skipped {len(failures)} report(s): {', '.join(failures)}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="_site")
    args = parser.parse_args()
    output = pathlib.Path(args.output_dir).resolve()
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    shutil.copy2(ROOT / "index.html", output / "index.html")
    shutil.copy2(ROOT / "sitemap.xml", output / "sitemap.xml")
    shutil.copytree(DASHBOARD, output / "begd")
    write_data_bundle(output / "begd")


if __name__ == "__main__":
    main()

