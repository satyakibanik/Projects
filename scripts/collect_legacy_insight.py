#!/usr/bin/env python
"""Collect and summarize older public PGCB plant-hourly workbooks for Insight.

Raw workbooks are cached under .cache/legacy-insight and are not committed.
The generated browser bundle contains only hourly aggregates needed by Insight.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import datetime as dt
import hashlib
from html.parser import HTMLParser
import json
import math
import os
import pathlib
import re
import subprocess
import time
from urllib.parse import parse_qs, urljoin, urlparse

import openpyxl


ROOT = pathlib.Path(__file__).resolve().parents[1]
ARCHIVE = ("https://erp.powergrid.gov.bd/w/report/"
           "eyJpdiI6IldsU2ZQTGkvbkRnQU9FMjZ5UHhmeGc9PSIsInZhbHVlIjoiQzhONVl5ZGxRY3E3T3ZVNCtLZGt1Zz09IiwibWFjIjoiN2JiNTI5MzNhOWIxZDVjY2NkMmFlZWU4ZDU1N2I4OWZlYjNlZWM1ZGU4NzRiNWU4ZjQ3ZDc1ODRlMTk3MDc0YyIsInRhZyI6IiJ9/show_report")
REPORTS_URL = "https://erp.powergrid.gov.bd/web/files/download?location=erp%2Fweb%2Freport_docs%2F{}&title={}"
LAST_PAGE = 156  # Verified from the public report listing pagination.
CATEGORY_ORDER = ["Gas", "Coal", "HFO", "HSD", "Hydro", "Solar", "Wind", "Dual fuel", "Other"]
INERTIA = {"Gas": 5.5, "Coal": 4.5, "HFO": 0.7, "HSD": 0.7,
           "Hydro": 3.5, "Solar": 0.0, "Wind": 0.0, "Dual fuel": 5.5}


def request_bytes(url, attempts=4):
    error = None
    for attempt in range(attempts):
        try:
            return subprocess.run(["curl", "--fail", "--silent", "--show-error", "--location",
                                   "--max-time", "60", url], check=True, capture_output=True).stdout
        except Exception as exc:
            error = exc
            if attempt + 1 < attempts:
                time.sleep(1 + attempt * 2)
    raise error


class ReportLinks(HTMLParser):
    def __init__(self):
        HTMLParser.__init__(self)
        self.links = []
        self.page_count = 1

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        href = attrs.get("href", "")
        match = re.search(r"[?&]page=(\d+)", href)
        if match:
            self.page_count = max(self.page_count, int(match.group(1)))
        if tag == "a" and "/web/files/download?" in href:
            self.links.append(urljoin("https://erp.powergrid.gov.bd", href))


def parse_published_date(url):
    title = parse_qs(urlparse(url).query).get("title", [""])[0]
    match = re.search(r"(\d{1,2})-(\d{1,2})-(\d{2,4})", title)
    if not match:
        return None, title
    day, month, year = map(int, match.groups())
    if year < 100:
        year += 2000
    try:
        return dt.date(year, month, day), title
    except ValueError:
        return None, title


def collect_links(first_page, last_page, cache_dir, min_date):
    page_dir = cache_dir / "pages"
    page_dir.mkdir(parents=True, exist_ok=True)
    links_by_date = {}
    seen_ids = set()
    for page in range(first_page, last_page + 1):
        path = page_dir / (str(page) + ".html")
        if not path.exists():
            path.write_bytes(request_bytes(ARCHIVE + "?page=" + str(page)))
        parser = ReportLinks()
        parser.feed(path.read_text(encoding="utf-8", errors="replace"))
        for url in parser.links:
            published, title = parse_published_date(url)
            if published is None:
                continue
            # Include reports through 2024-12-31 operating date (the workbook
            # publication label is normally D+1).
            if min_date <= published <= dt.date(2025, 1, 1):
                location = parse_qs(urlparse(url).query).get("location", [""])[0]
                report_id = pathlib.PurePosixPath(location).stem
                if report_id and report_id not in seen_ids:
                    seen_ids.add(report_id)
                    links_by_date.setdefault(published.isoformat(), []).append(
                        dict(id=report_id, title=title, published_date=published.isoformat(),
                             operating_date=(published-dt.timedelta(days=1)).isoformat(), url=url))
        if page % 10 == 0 or page == last_page:
            print("Scanned archive page {}/{} · {} older report dates".format(
                page, last_page, len(links_by_date)), flush=True)
        time.sleep(0.1)
    return [links_by_date[date] for date in sorted(links_by_date)]


def plant_key(value):
    text = str(value or "").strip().lower()
    text = text.replace("&", "and")
    return re.sub(r"[^a-z0-9]", "", text)


def number(value):
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    if isinstance(value, str):
        value = value.replace(",", "").strip()
        try:
            result = float(value)
            return result if math.isfinite(result) else None
        except ValueError:
            return None
    return None


def clean_fuel(value):
    raw = re.sub(r"\s+", " ", str(value or "").strip().lower())
    raw = raw.replace("furnace oil", "hfo").replace("heavy fuel oil", "hfo")
    raw = raw.replace("diesel", "hsd").replace("high speed diesel", "hsd")
    raw = raw.replace("natural gas", "gas").replace("gas fired", "gas")
    parts = [part.strip() for part in re.split(r"[/+&]", raw) if part.strip()]
    if len(parts) > 1:
        normalized = set(parts)
        if "gas" in normalized and normalized.issubset({"gas", "hfo", "hsd"}):
            return "Dual fuel", 5.5
        return "Other", None
    fuel = parts[0] if parts else ""
    aliases = {"gas": "Gas", "coal": "Coal", "hfo": "HFO", "fo": "HFO",
               "hsd": "HSD", "hydro": "Hydro", "hydroelectric": "Hydro",
               "solar": "Solar", "wind": "Wind"}
    category = aliases.get(fuel, "Other")
    return category, INERTIA.get(category)


def time_label(value):
    if isinstance(value, (int, float)) and 0 <= value <= 1:
        minutes = int(round(value * 24 * 60))
        if minutes == 24 * 60:
            text = "24:00"
        else:
            text = "{:02d}:{:02d}".format(minutes // 60, minutes % 60)
    elif hasattr(value, "strftime"):
        text = value.strftime("%H:%M")
    else:
        text = str(value or "").strip()
    match = re.search(r"(?:^|\s)(\d{1,2}:\d{2})(?::\d{2})?$", text)
    if not match:
        return None
    hour, minute = map(int, match.group(1).split(":"))
    if minute != 0 or hour > 24:
        return None
    return "{:02d}:{:02d}".format(hour, minute)


def header_row(rows, predicates, max_rows=20):
    for row_index, row in enumerate(rows[:max_rows], 1):
        cells = [re.sub(r"\s+", " ", str(value or "")).strip().lower() for value in row]
        if all(any(predicate(cell) for cell in cells) for predicate in predicates):
            return row_index, cells
    return None, []


def extract_report(path):
    datemode = None
    if path.suffix.lower() == ".xls":
        import xlrd
        book = xlrd.open_workbook(path)
        datemode = book.datemode
        sheet_names = book.sheet_names()
        sheets = {name: [book.sheet_by_name(name).row_values(i)
                         for i in range(book.sheet_by_name(name).nrows)] for name in sheet_names}
    else:
        book = openpyxl.load_workbook(path, data_only=True, read_only=True)
        sheet_names = book.sheetnames
        sheets = {name: list(book[name].iter_rows(values_only=True))
                  for name in ("Generation", "P2", "Forecast") if name in sheet_names}
    if "Generation" not in sheet_names or "P2" not in sheet_names or "Forecast" not in sheet_names:
        raise ValueError("missing Generation, P2, or Forecast sheet")
    generation, p2, forecast = sheets["Generation"], sheets["P2"], sheets["Forecast"]

    # Legacy PGCB reports use labelled P2/Forecast tables; locate columns by
    # their headers rather than relying on unrelated-sheet layouts.
    p2_header, p2_cells = header_row(p2, [lambda x: "name" in x and "power station" in x])
    if not p2_header:
        raise ValueError("could not identify P2 name/present-capacity headers")
    p2_name_col = next(i for i, cell in enumerate(p2_cells) if "name" in cell and "power station" in cell)
    p2_header_band = [re.sub(r"\s+", " ", " ".join(
        str(p2[row][col] or "") for row in range(max(0, p2_header - 3), min(len(p2), p2_header + 1))
        if col < len(p2[row]))).strip().lower()
        for col in range(max(len(row) for row in p2[:p2_header + 1]))]
    p2_cap_col = next(i for i, cell in enumerate(p2_header_band)
                      if "present" in cell and "capacity" in cell)
    capacities = {}
    for row in p2[p2_header:]:
        name = row[p2_name_col] if p2_name_col < len(row) else None
        cap = number(row[p2_cap_col] if p2_cap_col < len(row) else None)
        key = plant_key(name)
        if key and cap is not None and cap > 0 and not key.endswith("areatotal"):
            capacities[key] = cap

    forecast_header, forecast_cells = header_row(forecast, [lambda x: "name" in x and "power station" in x,
                                                             lambda x: "fuel" in x])
    if not forecast_header:
        raise ValueError("could not identify Forecast name/fuel headers")
    fuel_name_col = next(i for i, cell in enumerate(forecast_cells) if "name" in cell and "power station" in cell)
    fuel_col = next(i for i, cell in enumerate(forecast_cells) if "fuel" in cell)
    fuels = {}
    for row in forecast[forecast_header:]:
        name = row[fuel_name_col] if fuel_name_col < len(row) else None
        raw_fuel = row[fuel_col] if fuel_col < len(row) else None
        key = plant_key(name)
        if key and raw_fuel:
            fuels[key] = clean_fuel(raw_fuel)

    # Find the transposed hourly generation table header and its time columns.
    gen_header = None
    times = []
    for row_index, row in enumerate(generation[:12], 1):
        row_times = [(col, time_label(value)) for col, value in enumerate(row)]
        valid = [(col, label) for col, label in row_times if label]
        if len(valid) >= 18:
            gen_header, times = row_index, valid
            break
    if gen_header is None:
        raise ValueError("no hourly Generation header with at least 18 whole hours")
    header_values = generation[gen_header - 1]
    unit_col = next((col for col, value in enumerate(header_values)
                     if "unit" in str(value or "").lower()), 1)
    date_value = (generation[0][1] if len(generation[0]) > 1 else None)
    date_value = date_value or (p2[1][1] if len(p2) > 1 and len(p2[1]) > 1 else None)
    if datemode is not None and isinstance(date_value, (int, float)) and date_value > 1000:
        import xlrd
        date_value = xlrd.xldate_as_datetime(date_value, datemode)
    if isinstance(date_value, dt.datetime):
        operating_date = date_value.date().isoformat()
    elif isinstance(date_value, dt.date):
        operating_date = date_value.isoformat()
    else:
        match = re.search(r"(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})", str(date_value or ""))
        if not match:
            raise ValueError("no operating date in Generation or P2")
        day, month, year = map(int, match.groups())
        operating_date = dt.date(year + (2000 if year < 100 else 0), month, day).isoformat()

    per_time = {}
    online_plant_keys = set()
    matched_online_keys = set()
    source_plant_keys = set()
    for row in generation[gen_header:]:
        name = row[unit_col] if unit_col < len(row) else None
        key = plant_key(name)
        if not key or key in ("unit", "total", "totalkwh") or key.endswith("total"):
            continue
        # Names with actual hour values are plant rows; exclude notes/subtotals.
        source_plant_keys.add(key)
        capacity = capacities.get(key)
        fuel_info = fuels.get(key)
        category, inertia = fuel_info if fuel_info else ("Other", None)
        cap_usable = capacity is not None and inertia is not None
        for col, label in times:
            output = number(row[col] if col < len(row) else None)
            if output is None or output <= 0:
                continue
            online_plant_keys.add(key)
            item = per_time.setdefault(label, dict(date=operating_date, time=label, numerator=0.0,
                                                   capacity=0.0, plants=0, fuelCounts={},
                                                   fuelCapacity={}, fuelNumerator={}))
            item["plants"] += 1
            item["fuelCounts"][category] = item["fuelCounts"].get(category, 0) + 1
            if cap_usable:
                item["capacity"] += capacity
                item["numerator"] += capacity * inertia
                item["fuelCapacity"][category] = item["fuelCapacity"].get(category, 0.0) + capacity
                item["fuelNumerator"][category] = item["fuelNumerator"].get(category, 0.0) + capacity * inertia
                matched_online_keys.add(key)

    points = []
    for label in sorted(per_time):
        item = per_time[label]
        if item["capacity"] <= 0:
            continue
        item["h"] = item.pop("numerator") / item["capacity"]
        points.append(item)
    if len(points) < 18:
        raise ValueError("only {} usable hourly estimates".format(len(points)))
    online_count = len(online_plant_keys)
    match_rate = len(matched_online_keys) / float(online_count or 1)
    if match_rate < 0.60:
        raise ValueError("only {:.0%} of online plants have matched fuel and present capacity".format(match_rate))
    return operating_date, points, dict(online_plants=online_count,
                                       weighted_online_plants=len(matched_online_keys),
                                       matched_online_share=round(match_rate, 4),
                                       source_rows=len(source_plant_keys),
                                       whole_hour_columns=len(set(label for _, label in times)))


def compact(points):
    rows = []
    for point in points:
        counts = [int(point["fuelCounts"].get(category, 0)) for category in CATEGORY_ORDER]
        capacities = [round(point["fuelCapacity"].get(category, 0.0), 2) for category in CATEGORY_ORDER]
        rows.append([point["time"], point["plants"], round(point["h"], 6),
                     round(point["capacity"], 2), counts, capacities])
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start-page", type=int, default=1)
    parser.add_argument("--end-page", type=int, default=LAST_PAGE)
    parser.add_argument("--jobs", type=int, default=3, help="Concurrent workbook downloads/parses (default: 3)")
    parser.add_argument("--min-published-date", type=dt.date.fromisoformat, default=dt.date(2017, 12, 1),
                        help="Skip older peak-only eras before this date (default: 2017-12-01)")
    parser.add_argument("--cache-dir", type=pathlib.Path, default=ROOT / ".cache" / "legacy-insight")
    parser.add_argument("--output", type=pathlib.Path, default=ROOT / "begd" / "insight-history.json")
    parser.add_argument("--sample-workbook", type=pathlib.Path,
                        help="Parse one local workbook without fetching the archive")
    args = parser.parse_args()
    args.cache_dir.mkdir(parents=True, exist_ok=True)

    if args.sample_workbook:
        date, points, quality = extract_report(args.sample_workbook)
        print(json.dumps(dict(date=date, point_count=len(points), first=points[0],
                              last=points[-1], quality=quality), indent=2))
        return

    workbook_dir = args.cache_dir / "workbooks"
    workbook_dir.mkdir(parents=True, exist_ok=True)
    reports = collect_links(args.start_page, args.end_page, args.cache_dir, args.min_published_date)
    summaries, sources_by_date, failures = {}, {}, []

    def process(candidates):
        errors = []
        for report in candidates:
            url_path = parse_qs(urlparse(report["url"]).query).get("location", [""])[0]
            suffix = pathlib.PurePosixPath(url_path).suffix or ".xlsx"
            path = workbook_dir / (report["id"] + suffix)
            try:
                if not path.exists():
                    partial = path.with_suffix(path.suffix + ".part")
                    partial.write_bytes(request_bytes(report["url"]))
                    os.replace(str(partial), str(path))
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                date, points, quality = extract_report(path)
                source = dict(date=date, report_id=report["id"], title=report["title"],
                              published_date=report["published_date"], url=report["url"],
                              sha256=digest, quality=quality)
                return date, compact(points), source, errors
            except Exception as error:
                errors.append(dict(report_id=report["id"], title=report["title"],
                                   url=report["url"], error="{}: {}".format(type(error).__name__, error)))
        return None, None, None, errors

    completed = 0
    with ThreadPoolExecutor(max_workers=max(1, min(args.jobs, 6))) as pool:
        futures = {pool.submit(process, candidates): candidates for candidates in reports}
        for future in as_completed(futures):
            candidates = futures[future]
            date, errors = None, []
            try:
                date, rows, source, errors = future.result()
                failures.extend(errors)
                if source:
                    current = sources_by_date.get(date)
                    if current is None or source["published_date"] > current["published_date"]:
                        summaries[date] = rows
                        sources_by_date[date] = source
            except Exception as error:
                report = candidates[0]
                failures.append(dict(report_id=report["id"], title=report["title"],
                                     url=report["url"], error="{}: {}".format(type(error).__name__, error)))
            if date is None and not errors:
                report = candidates[0]
                failures.append(dict(report_id=report["id"], title=report["title"], url=report["url"],
                                     error="No usable candidate workbook for publication date."))
            completed += 1
            if completed % 50 == 0 or completed == len(reports):
                print("Processed {}/{} report dates · {} usable days · {} layout/download failures".format(
                    completed, len(reports), len(summaries), len(failures)), flush=True)

    payload = dict(generated_at=dt.datetime.now(dt.timezone.utc).isoformat(),
                   source="PGCB Operation Daily Reports archive", categories=CATEGORY_ORDER,
                   encoding="[time, online plants, H_COI, weighted MW, category counts, category MW]",
                   reports=summaries, sources=sorted(sources_by_date.values(), key=lambda item: item["date"]),
                   failure_count=len(failures), failures=failures[:100])
    args.output.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    print("Wrote {} usable operating days from {} report dates to {}".format(
        len(summaries), len(reports), args.output), flush=True)


if __name__ == "__main__":
    main()
