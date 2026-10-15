#!/usr/bin/env python3
"""Build the GitHub Pages site and an hourly static ERP data bundle."""
import argparse
import datetime as dt
import json
import math
import pathlib
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


def available_reports():
    first_page, total_pages = server.fetch_listing_page(1)
    if not first_page:
        raise RuntimeError("The ERP archive returned no report rows")
    latest = max(dt.date.fromisoformat(row["published_date"]) for row in first_page)
    start = max(dt.date.fromisoformat(server.MIN_SUPPORTED_PUBLISHED_DATE),
                latest - dt.timedelta(days=WINDOW_DAYS - 1))
    pages_needed = max(1, math.ceil(((latest - start).days + 1) / len(first_page)) + 1)
    page_count = min(total_pages or pages_needed, pages_needed)
    records = list(first_page)
    for page in range(2, page_count + 1):
        rows, _ = server.fetch_listing_page(page)
        records.extend(rows)
    unique = {row["id"]: row for row in records}
    selected = [row for row in unique.values()
                if dt.date.fromisoformat(row["published_date"]) >= start]
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
    records = available_reports()
    reports_by_id = {}
    failures = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(parse_listing_item, item): item for item in records}
        for future in as_completed(futures):
            item = futures[future]
            try:
                report = future.result()
                reports_by_id[report["report_id"]] = report
            except Exception as error:
                failures.append(f"{item['published_date']}: {type(error).__name__}")
    if not reports_by_id:
        raise RuntimeError("No supported daily workbooks could be downloaded")

    reports = [{key: item[key] for key in ("id", "name", "published_date")}
               for item in records if item["id"] in reports_by_id]
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
        reports_by_id[highest["report_id"]] = highest
        by_date[highest["date"]] = ((0, -int(highest["report_id"])), highest["report_id"])
    except Exception as error:
        print(f"Highest-generation comparison unavailable: {type(error).__name__}")

    try:
        current_day = server.get_current_day()
    except Exception as error:
        print(f"Current-day readings unavailable: {type(error).__name__}")
        current_day = {"updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                       "today_date": dt.datetime.now(dt.timezone(dt.timedelta(hours=6))).date().isoformat(),
                       "demand_hourly": [], "generation_hourly": [], "imports": [],
                       "source_dates": {}, "source_urls": []}

    built_at = dt.datetime.now(dt.timezone.utc).isoformat()
    bundle = {
        "generated_at": built_at,
        "reports": reports,
        "reports_by_id": reports_by_id,
        "reports_by_operating_date": {day: value[1] for day, value in by_date.items()},
        "current_day": current_day,
        "highest_generation": highest,
        "failures": failures,
    }
    payload = json.dumps(bundle, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "live-data.js").write_text(
        "window.BEGD_STATIC_DATA=" + payload + ";\n", encoding="utf-8")

    index = (DASHBOARD / "index.html").read_text(encoding="utf-8")
    version = built_at[:19].replace("-", "").replace(":", "") + "Z"
    index = index.replace("live-data.js?build=BUILD_ID", "live-data.js?build=" + version)
    (output_dir / "index.html").write_text(index, encoding="utf-8")
    print(f"Built {len(reports)} reports and hourly readings at {built_at}")
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
    shutil.copytree(DASHBOARD, output / "begd")
    write_data_bundle(output / "begd")


if __name__ == "__main__":
    main()

