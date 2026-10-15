"""Serve the dashboard and fetch its current reports from Power Grid ERP."""
import datetime
import argparse
import html.parser
import json
import math
import os
import pathlib
import re
import ssl
import threading
import time
from threading import Thread
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import URLError
from urllib.parse import parse_qs, urlencode, urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, HTTPSHandler, ProxyHandler, build_opener
from zoneinfo import ZoneInfo

from import_report import parse_report


ROOT = pathlib.Path(__file__).resolve().parents[1]
PROTOTYPE = ROOT / "prototype"
DASHBOARD_DIR = ROOT if (ROOT / "begd" / "index.html").is_file() else PROTOTYPE
REPORTS_URL = (
    "https://erp.powergrid.gov.bd/w/report/"
    "eyJpdiI6IldsU2ZQTGkvbkRnQU9FMjZ5UHhmeGc9PSIs"
    "InZhbHVlIjoiQzhONVl5ZGxRY3E3T3ZVNCtLZGt1Zz09Iiw"
    "ibWFjIjoiN2JiNTI5MzNhOWIxZDVjY2NkMmFlZWU4ZDU1N2I4OWZl"
    "YjNlZWM1ZGU4NzRiNWU4ZjQ3ZDc1ODRlMTk3MDc0YyIsInRhZyI6IiJ9/show_report"
)
MAXIMUM_GENERATIONS_URL = "https://erp.powergrid.gov.bd/w/maximum_generations/show_maximum_generations"
CURRENT_DEMAND_URL = "https://erp.powergrid.gov.bd/web/generations/view_demand_supply_loadshed"
CURRENT_GENERATION_URL = "https://erp.powergrid.gov.bd/w/generations/view_generations"
CURRENT_INDIA_IMPORT_URL = "https://erp.powergrid.gov.bd/w/generations/imported_power_india"
USER_AGENT = "BEGD dashboard report reader/1.0"
LIST_CACHE_SECONDS = 1800
REPORT_CACHE_SECONDS = 900
CURRENT_DAY_CACHE_SECONDS = 180
MAX_REPORT_BYTES = 20 * 1024 * 1024
MIN_SUPPORTED_PUBLISHED_DATE = "2025-01-31"
cache_lock = threading.Lock()
reports_cache = []
reports_cache_time = 0.0
reports_cache_complete = False
reports_refreshing = False
reports_refresh_error = None
reports_page_count = 0
reports_pages_loaded = 0
reports_page_rows = {}
report_data_cache = {}
maximum_generation_cache = None
maximum_generation_cache_time = 0.0
current_day_cache = None
current_day_cache_time = 0.0


class DataTableParser(html.parser.HTMLParser):
    """Collect text cells from ERP's server-rendered tables."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []

    def handle_data(self, value):
        if self.cell is not None:
            value = value.strip()
            if value:
                self.cell.append(value)

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(" ".join(self.cell))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            if self.cell is not None:
                self.row.append(" ".join(self.cell))
                self.cell = None
            self.rows.append(self.row)
            self.row = None


def parse_number(value):
    value = value.strip().replace(",", "")
    if not value or value in ("—", "-", "–"):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def parse_current_table(*, minimum_cells, url, params=None):
    query = urlencode(params or {})
    source_url = f"{url}?{query}" if query else url
    parser = DataTableParser()
    parser.feed(fetch_bytes(source_url, limit=8 * 1024 * 1024)
                .decode("utf-8", errors="replace"))
    records = []
    for row in parser.rows:
        if len(row) < minimum_cells:
            continue
        try:
            row_date = datetime.datetime.strptime(row[0], "%d-%m-%Y").date().isoformat()
        except ValueError:
            continue
        time_match = re.search(r"\b(\d{1,2}:\d{2})(?::\d{2})?\b", row[1])
        if not time_match:
            continue
        records.append((row_date, time_match.group(1).zfill(5), row))
    if not records:
        raise LookupError("The ERP table contains no hourly readings")
    return sorted(records, key=lambda item: (item[0], item[1]))


def fetch_current_day():
    def demand_rows():
        return parse_current_table(
            minimum_cells=6, url=CURRENT_DEMAND_URL, params={"d_gen": "1"},
        )

    def generation_rows():
        return parse_current_table(
            minimum_cells=13, url=CURRENT_GENERATION_URL,
        )

    def import_rows():
        return parse_current_table(
            minimum_cells=8, url=CURRENT_INDIA_IMPORT_URL,
        )

    with ThreadPoolExecutor(max_workers=3) as pool:
        demand_future = pool.submit(demand_rows)
        generation_future = pool.submit(generation_rows)
        import_future = pool.submit(import_rows)
        demand = demand_future.result()
        generation = generation_future.result()
        imported = import_future.result()

    today = datetime.datetime.now(ZoneInfo("Asia/Dhaka")).date().isoformat()
    latest_dates = {
        "demand": today if any(row[0] == today for row in demand) else None,
        "generation": today if any(row[0] == today for row in generation) else None,
        "imports": today if any(row[0] == today for row in imported) else None,
    }
    operating_date = today
    demand = [(time_label, row) for day, time_label, row in demand
              if day == today]
    generation = [(time_label, row) for day, time_label, row in generation
                  if day == today]
    imported = [(time_label, row) for day, time_label, row in imported
                if day == today]

    demand_hourly = []
    for time_label, row in demand:
        demand_hourly.append({
            "time": time_label,
            "demand_mw": parse_number(row[2]),
            "generation_mw": parse_number(row[3]),
            "shed_mw": parse_number(row[4]),
        })

    fuel_fields = (("gas_mw", 3), ("liquid_mw", 4), ("coal_mw", 5),
                   ("hydro_mw", 6), ("solar_mw", 7), ("wind_mw", 8))
    fuel_hourly = []
    route_generation = {"Bheramara HVDC": {}, "Tripura": {}, "Adani": {}, "Nepal": {}}
    for time_label, row in generation:
        fuel_row = {"time": time_label, "total_mw": parse_number(row[2])}
        for key, index in fuel_fields:
            fuel_row[key] = parse_number(row[index])
        fuel_hourly.append(fuel_row)
        for route, index in (("Bheramara HVDC", 9), ("Tripura", 10),
                             ("Adani", 11), ("Nepal", 12)):
            route_generation[route][time_label] = parse_number(row[index])

    route_imports = {"Bheramara HVDC": {}, "Tripura": {}, "Adani": {}}
    for time_label, row in imported:
        for route, index in (("Bheramara HVDC", 2), ("Tripura", 4), ("Adani", 6)):
            route_imports[route][time_label] = parse_number(row[index])
    # The imports page is authoritative for the India routes; view_generations
    # supplies Nepal, which is outside that page's table.
    route_imports["Nepal"] = route_generation["Nepal"]

    imports = [{"name": name,
                "date": latest_dates["generation"] if name == "Nepal" else latest_dates["imports"],
                "hourly": [
        {"time": time_label, "mw": value}
        for time_label, value in sorted(values.items())
    ]} for name, values in route_imports.items()]
    return {
        "date": operating_date,
        "today_date": today,
        "source_dates": latest_dates,
        "demand_hourly": demand_hourly,
        "generation_hourly": fuel_hourly,
        "imports": imports,
        "source_urls": [CURRENT_DEMAND_URL, CURRENT_GENERATION_URL,
                        CURRENT_INDIA_IMPORT_URL],
        "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }


def get_current_day():
    global current_day_cache, current_day_cache_time
    with cache_lock:
        cached = current_day_cache
        fresh = cached and time.time() - current_day_cache_time < CURRENT_DAY_CACHE_SECONDS
    if fresh:
        return cached
    result = fetch_current_day()
    with cache_lock:
        current_day_cache = result
        current_day_cache_time = time.time()
    return result


class MaximumGenerationParser(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []

    def handle_data(self, value):
        value = value.strip()
        if value and self.cell is not None:
            self.cell.append(value)

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(" ".join(self.cell))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            if self.cell is not None:
                self.row.append(" ".join(self.cell))
                self.cell = None
            self.rows.append(self.row)
            self.row = None


class ListingParser(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.row = None
        self.cell = None
        self.rows = []
        self.text = []
        self.page_numbers = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "tr":
            self.row = []
        elif tag == "td" and self.row is not None:
            self.cell = {"text": [], "href": None}
        elif tag == "a":
            href = attrs.get("href", "")
            match = re.search(r"[?&]page=(\d+)", href)
            if match:
                self.page_numbers.append(int(match.group(1)))
            if self.cell is not None and href and "/web/files/download" in href:
                self.cell["href"] = href

    def handle_data(self, value):
        value = value.strip()
        if not value:
            return
        self.text.append(value)
        if self.cell is not None:
            self.cell["text"].append(value)

    def handle_endtag(self, tag):
        if tag == "td" and self.cell is not None:
            self.cell["text"] = " ".join(self.cell["text"])
            self.row.append(self.cell)
            self.cell = None
        elif tag == "tr" and self.row is not None:
            if self.cell is not None:
                self.row.append(self.cell)
                self.cell = None
            self.rows.append(self.row)
            self.row = None


class HTTPSOnlyRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        if urlparse(new_url).scheme != "https":
            raise URLError("Power Grid redirected to a non-HTTPS URL")
        return super().redirect_request(
            request, file_pointer, code, message, headers, new_url,
        )


def fetch_bytes(url, *, limit=None):
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "erp.powergrid.gov.bd":
        raise ValueError("Report URL is outside the Power Grid archive")

    context = ssl.create_default_context()
    issuer_path = os.environ.get("BEGD_ERP_INTERMEDIATE_CERT")
    if issuer_path:
        # The workflow validates this intermediate against the system roots
        # before exporting the path. Partial-chain trust lets Python complete
        # the ERP server's omitted intermediate while still verifying TLS.
        context.load_verify_locations(cafile=issuer_path)
        context.verify_flags |= ssl.VERIFY_X509_PARTIAL_CHAIN

    opener = build_opener(
        ProxyHandler({}),
        HTTPSOnlyRedirectHandler,
        HTTPSHandler(context=context),
    )
    request = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with opener.open(request, timeout=40) as response:
            body = response.read(limit + 1) if limit else response.read()
    except URLError as error:
        reason = getattr(error, "reason", error)
        raise RuntimeError(
            f"Power Grid request failed: {type(reason).__name__}: {reason}"
        ) from error

    if limit and len(body) > limit:
        raise ValueError("Report file is larger than the allowed limit")
    return body

def parse_listing(body, *, require_count=True):
    parser = ListingParser()
    parser.feed(body.decode("utf-8", errors="replace"))
    available_rows = []
    for cells in parser.rows:
        if len(cells) < 4 or not cells[3].get("href"):
            continue
        report_name = cells[1]["text"].strip()
        published = cells[2]["text"].strip()
        try:
            published_iso = datetime.datetime.strptime(published, "%d-%m-%Y").date().isoformat()
        except ValueError:
            continue
        download_url = urljoin(REPORTS_URL, cells[3]["href"])
        query = parse_qs(urlparse(download_url).query)
        location = query.get("location", [""])[0]
        match = re.fullmatch(r"erp/web/report_docs/(\d+)\.(?:xlsx|xlsm)", location, re.I)
        if not match:
            continue
        available_rows.append({
            "id": match.group(1),
            "name": report_name,
            "published_date": published_iso,
            "download_url": download_url,
        })

    total_match = re.search(r"Showing\s+\d+\s+of\s+([\d,]+)", " ".join(parser.text), re.I)
    if not available_rows:
        if not require_count:
            return [], None
        raise ValueError("No report rows were found in the Power Grid archive")
    if not total_match:
        if require_count:
            raise ValueError("The Power Grid archive did not report its page count")
        return available_rows, None
    total = int(total_match.group(1).replace(",", ""))
    per_page = len(available_rows)
    page_count = max(1, math.ceil(total / per_page))
    return available_rows, page_count


def fetch_listing_page(page):
    separator = "&" if "?" in REPORTS_URL else "?"
    url = REPORTS_URL if page == 1 else f"{REPORTS_URL}{separator}{urlencode({'page': page})}"
    for attempt in range(2):
        try:
            return parse_listing(fetch_bytes(url), require_count=(page == 1))
        except (RuntimeError, TimeoutError, ValueError):
            if attempt == 1:
                raise
            time.sleep(0.7)


def ordered_reports(page_rows):
    records = {}
    for rows in page_rows.values():
        for report in rows:
            records[report["id"]] = report
    return sorted(records.values(), key=lambda report: report["published_date"], reverse=True)


def supported_page_limit(first_page, source_page_count):
    latest = datetime.date.fromisoformat(first_page[0]["published_date"])
    start = datetime.date.fromisoformat(MIN_SUPPORTED_PUBLISHED_DATE)
    pages_for_range = math.ceil(max(0, (latest - start).days + 1) / len(first_page))
    return min(source_page_count, max(1, pages_for_range + 1))


def update_archive_page(page, rows):
    global reports_cache, reports_pages_loaded
    with cache_lock:
        reports_page_rows[page] = rows
        reports_pages_loaded = len(reports_page_rows)
        reports_cache = ordered_reports(reports_page_rows)


def refresh_remaining_pages(page_count):
    global reports_cache_complete, reports_refreshing, reports_refresh_error, reports_cache_time
    failures = []
    try:
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {pool.submit(fetch_listing_page, page): page for page in range(2, page_count + 1)}
            for future in as_completed(futures):
                page = futures[future]
                try:
                    rows, _ = future.result()
                    update_archive_page(page, rows)
                except Exception as error:
                    failures.append((page, type(error).__name__))
        with cache_lock:
            if failures:
                reports_refresh_error = f"Could not read {len(failures)} archive page(s)."
                reports_cache_complete = False
            else:
                reports_refresh_error = None
                reports_cache_complete = True
                reports_cache_time = time.time()
    finally:
        with cache_lock:
            reports_refreshing = False


def refresh_archive():
    global reports_page_count, reports_pages_loaded, reports_cache_time, reports_cache_complete
    global reports_refresh_error, reports_refreshing, reports_page_rows, reports_cache
    try:
        first_page, source_page_count = fetch_listing_page(1)
        page_count = supported_page_limit(first_page, source_page_count)
        with cache_lock:
            reports_page_rows = {1: first_page}
            reports_page_count = page_count
            reports_pages_loaded = 1
            reports_cache = ordered_reports(reports_page_rows)
            reports_cache_time = time.time()
            reports_cache_complete = page_count == 1
            reports_refresh_error = None
        if page_count > 1:
            refresh_remaining_pages(page_count)
    except Exception as error:
        with cache_lock:
            reports_refresh_error = f"Could not refresh the Power Grid archive ({type(error).__name__})."
            reports_cache_complete = False
    finally:
        with cache_lock:
            reports_refreshing = False


def list_reports():
    global reports_refreshing, reports_cache_time, reports_page_count, reports_pages_loaded
    global reports_page_rows, reports_cache, reports_cache_complete, reports_refresh_error
    start_refresh = False
    with cache_lock:
        stale = bool(reports_cache) and time.time() - reports_cache_time >= LIST_CACHE_SECONDS
        if (not reports_cache or stale) and not reports_refreshing:
            reports_refreshing = True
            reports_cache_time = time.time()
            start_refresh = True
        snapshot = list(reports_cache)
    if start_refresh:
        if snapshot:
            Thread(target=refresh_archive, daemon=True).start()
        else:
            try:
                first_page, source_page_count = fetch_listing_page(1)
                page_count = supported_page_limit(first_page, source_page_count)
                with cache_lock:
                    reports_page_rows = {1: first_page}
                    reports_page_count = page_count
                    reports_pages_loaded = 1
                    reports_cache = ordered_reports(reports_page_rows)
                    reports_cache_time = time.time()
                    reports_cache_complete = page_count == 1
                    reports_refresh_error = None
                    snapshot = list(reports_cache)
                if page_count > 1:
                    Thread(target=refresh_remaining_pages, args=(page_count,), daemon=True).start()
                else:
                    with cache_lock:
                        reports_refreshing = False
            except Exception:
                with cache_lock:
                    reports_refreshing = False
                    reports_refresh_error = "Power Grid could not provide the report list."
                raise
    return snapshot


def report_archive_state():
    reports = list_reports()
    with cache_lock:
        supported = [item for item in reports
                     if item["published_date"] >= MIN_SUPPORTED_PUBLISHED_DATE]
        return {
            "reports": [{key: item[key] for key in ("id", "name", "published_date")}
                        for item in supported],
            "count": len(supported),
            "complete": reports_cache_complete,
            "refreshing": reports_refreshing,
            "pages_loaded": reports_pages_loaded,
            "page_count": reports_page_count,
            "minimum_published_date": MIN_SUPPORTED_PUBLISHED_DATE,
            "error": reports_refresh_error,
            "source": REPORTS_URL,
        }


def get_report(report_id):
    if not re.fullmatch(r"\d{1,8}", report_id):
        raise ValueError("Invalid report selection")
    reports = list_reports()
    report = next((item for item in reports
                   if item["id"] == report_id
                   and item["published_date"] >= MIN_SUPPORTED_PUBLISHED_DATE), None)
    if report is None:
        raise LookupError("That report is outside the dashboard’s supported workbook dates")

    with cache_lock:
        cached = report_data_cache.get(report_id)
        if cached and time.time() - cached[0] < REPORT_CACHE_SECONDS:
            return cached[1]

    return parse_report_item(report)


def parse_report_item(report):
    workbook = fetch_bytes(report["download_url"], limit=MAX_REPORT_BYTES)
    result = parse_report(workbook, report["name"])
    result["report_id"] = report["id"]
    result["report_name"] = report["name"]
    result["published_date"] = report["published_date"]
    result["source_url"] = report["download_url"]
    with cache_lock:
        report_data_cache[report["id"]] = (time.time(), result)
    return result


def get_adjacent_report(report_id, offset):
    if offset not in (-1, 1):
        raise ValueError("Adjacent report offset must be -1 or 1")
    current = get_report(report_id)
    target_date = (datetime.date.fromisoformat(current["date"])
                   + datetime.timedelta(days=offset))
    reports = [item for item in list_reports()
               if item["published_date"] >= MIN_SUPPORTED_PUBLISHED_DATE]
    # Reports are normally published the day after operation. Scan nearby
    # publication dates so backfills and delayed reports can still match by
    # the actual operating date inside the workbook.
    candidates = [item for item in reports
                  if abs((datetime.date.fromisoformat(item["published_date"])
                          - target_date).days) <= 4]
    candidates.sort(key=lambda item: (
        abs((datetime.date.fromisoformat(item["published_date"])
             - (target_date + datetime.timedelta(days=1))).days),
        -int(item["id"]),
    ))
    for candidate in candidates:
        try:
            adjacent = get_report(candidate["id"])
        except Exception:
            continue
        if adjacent["date"] == target_date.isoformat():
            return adjacent
    raise LookupError("No adjacent operating-day report is available")


def get_historical_report_for_date(target_date):
    """Fetch only the older archive pages needed to find one operating day."""
    first_page, source_page_count = fetch_listing_page(1)
    if not first_page:
        raise LookupError("The Power Grid archive has no report rows")

    lower_bound = target_date - datetime.timedelta(days=4)
    candidates = []
    for page in range(1, (source_page_count or 1) + 1):
        rows = first_page if page == 1 else fetch_listing_page(page)[0]
        candidates.extend(
            item for item in rows
            if abs((datetime.date.fromisoformat(item["published_date"])
                    - target_date).days) <= 4
        )
        page_dates = [datetime.date.fromisoformat(item["published_date"])
                      for item in rows]
        # The archive is newest-first. Once a full page reaches dates older
        # than the matching publication window, no later page can match.
        if page_dates and min(page_dates) < lower_bound:
            break

    candidates.sort(key=lambda item: (
        abs((datetime.date.fromisoformat(item["published_date"])
             - (target_date + datetime.timedelta(days=1))).days),
        -int(item["id"]),
    ))
    for candidate in candidates:
        try:
            report = parse_report_item(candidate)
        except Exception:
            continue
        if report["date"] == target_date.isoformat():
            return report
    raise LookupError("No report was found for the highest-generation operating day")


def get_highest_generation_day():
    global maximum_generation_cache, maximum_generation_cache_time
    with cache_lock:
        cached = maximum_generation_cache
        fresh = cached and time.time() - maximum_generation_cache_time < LIST_CACHE_SECONDS
    if fresh:
        reference = cached
    else:
        parser = MaximumGenerationParser()
        parser.feed(fetch_bytes(MAXIMUM_GENERATIONS_URL, limit=2 * 1024 * 1024)
                    .decode("utf-8", errors="replace"))
        records = []
        for row in parser.rows:
            date_index = next((index for index, value in enumerate(row)
                               if re.fullmatch(r"\d{2}-\d{2}-\d{4}", value)), None)
            if date_index is None or date_index == 0:
                continue
            try:
                operating_date = datetime.datetime.strptime(
                    row[date_index], "%d-%m-%Y").date().isoformat()
                generation_mw = float(row[date_index - 1].replace(",", ""))
            except (ValueError, IndexError):
                continue
            records.append({
                "date": operating_date,
                "generation_mw": generation_mw,
                "time": row[date_index + 1] if date_index + 1 < len(row) else None,
            })
        if not records:
            raise LookupError("The Power Grid maximum-generation date is unavailable")
        reference = max(records, key=lambda item: item["generation_mw"])
        with cache_lock:
            maximum_generation_cache = reference
            maximum_generation_cache_time = time.time()

    target_date = datetime.date.fromisoformat(reference["date"])
    if target_date.isoformat() < MIN_SUPPORTED_PUBLISHED_DATE:
        report = get_historical_report_for_date(target_date)
        report["comparison_source"] = "highest-generation"
        report["maximum_generation"] = reference
        return report

    reports = [item for item in list_reports()
               if item["published_date"] >= MIN_SUPPORTED_PUBLISHED_DATE]
    candidates = [item for item in reports
                  if abs((datetime.date.fromisoformat(item["published_date"])
                          - target_date).days) <= 4]
    candidates.sort(key=lambda item: (
        abs((datetime.date.fromisoformat(item["published_date"])
             - (target_date + datetime.timedelta(days=1))).days),
        -int(item["id"]),
    ))
    for candidate in candidates:
        try:
            report = dict(get_report(candidate["id"]))
        except Exception:
            continue
        if report["date"] == target_date.isoformat():
            report["comparison_source"] = "highest-generation"
            report["maximum_generation"] = reference
            return report
    try:
        report = get_historical_report_for_date(target_date)
    except LookupError:
        raise LookupError("No supported report is available for the highest-generation day")
    report["comparison_source"] = "highest-generation"
    report["maximum_generation"] = reference
    return report


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DASHBOARD_DIR), **kwargs)

    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/health":
                self.send_json(200, {"ok": True})
                return
            if parsed.path == "/api/reports":
                self.send_json(200, report_archive_state())
                return
            if parsed.path == "/api/report":
                report_id = parse_qs(parsed.query).get("id", [""])[0]
                self.send_json(200, get_report(report_id))
                return
            if parsed.path == "/api/neighbor":
                query = parse_qs(parsed.query)
                report_id = query.get("id", [""])[0]
                offset = int(query.get("offset", ["0"])[0])
                self.send_json(200, get_adjacent_report(report_id, offset))
                return
            if parsed.path == "/api/highest-generation":
                self.send_json(200, get_highest_generation_day())
                return
            if parsed.path == "/api/current-day":
                self.send_json(200, get_current_day())
                return
        except LookupError as error:
            self.send_json(404, {"error": str(error)})
            return
        except (RuntimeError, TimeoutError, ValueError,
                AssertionError, KeyError, IndexError) as error:
            print(f"Report request failed: {type(error).__name__}: {error}")
            self.send_json(502, {
                "error": "Power Grid could not provide a complete report right now. Try again shortly."
            })
            return
        return super().do_GET()

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format % args}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8081)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), DashboardHandler)
    print(f"BEGD running at http://{args.host}:{args.port}/ (reports fetched from Power Grid ERP)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
