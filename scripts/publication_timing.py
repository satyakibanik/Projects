"""Poll the public ERP endpoints and preserve first successful observations."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import json
import math
from pathlib import Path
import re
from urllib.error import HTTPError
from urllib.request import urlopen
from zoneinfo import ZoneInfo

import server

DHAKA = ZoneInfo("Asia/Dhaka")
RETENTION_DAYS = 90
MAX_WINDOW_MINUTES = 45
MIN_ESTIMATE_DAYS = 5
BUNDLE = "publication-timing.json"
CACHE = server.ROOT / ".cache" / "publication-timing" / BUNDLE
FEEDS = {
    "demand": (server.CURRENT_DEMAND_URL, 6, (2, 3, 4)),
    "generation": (server.CURRENT_GENERATION_URL, 13, (2,)),
    "imports": (server.CURRENT_INDIA_IMPORT_URL, 8, (2, 4, 6)),
    "operations": (server.REPORTS_URL, None, ()),
}


def now():
    return dt.datetime.now(dt.timezone.utc)


def dhaka_date(instant):
    return instant.astimezone(DHAKA).date()


def poll(source, clock=now):
    url, minimum, value_columns = FEEDS[source]
    started = clock()
    body = server.fetch_bytes(url, limit=8 * 1024 * 1024)
    received = clock()
    if source == "operations":
        rows, _ = server.parse_listing(body)
        rows = {row["id"]: dict(row, date=row["published_date"]) for row in rows}
    else:
        records, headers = server.parse_current_readings(body, minimum_cells=minimum, include_headers=True)
        expected_cells = 15 if any("nuclear" in cell.lower() for row in headers for cell in row) else 14
        rows = {}
        for day, time, row in records:
            if source == "generation" and len(row) != expected_cells:
                continue
            if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", time):
                continue
            values = [server.parse_number(row[index]) for index in value_columns]
            if any(value is not None and math.isfinite(value) for value in values):
                rows[f"{day}T{time}"] = {"date": day, "reading_time": time}
    if not rows:
        raise ValueError("No usable readings")
    return started, received, rows


def update_feed(feed, source, snapshot, clock=now):
    started, received, rows = snapshot
    dates = [row["date"] for row in rows.values()]
    oldest = min(dates)
    previous = feed.get("last_poll")
    if previous and started <= dt.datetime.fromisoformat(previous["started_at"]):
        raise ValueError("Poll did not advance the collector clock")
    if previous and max(dates) < previous["latest_date"]:
        raise ValueError("ERP returned an older snapshot")

    today = dhaka_date(received)
    earliest = (today - dt.timedelta(days=7 if source == "operations" else 1)).isoformat()
    cutoff = (today - dt.timedelta(days=RETENTION_DAYS - 1)).isoformat()
    seen = {key: date for key, date in feed.get("seen", {}).items() if date >= cutoff}
    observations = [row for row in feed.get("observations", []) if row["date"] >= cutoff]
    pending = {}
    baseline = feed.get("baseline_through", max(dates))
    for key, row in rows.items():
        date = row["date"]
        if key in seen or date < cutoff:
            continue
        if not previous or not earliest <= date <= today.isoformat():
            seen[key] = date
            continue
        # Near the oldest visible date the feeds can truncate rows. Only a
        # previous snapshot covering an earlier date can bound first exposure.
        absent = previous["started_at"] if date > previous["oldest_date"] else None
        first_seen = received
        observation = {"date": date}
        if source == "operations":
            absent = feed.get("pending", {}).get(key, {"after": absent})["after"]
            try:
                workbook = server.fetch_bytes(row["download_url"], limit=server.MAX_REPORT_BYTES)
                first_seen = clock()
                report = server.parse_report(workbook, row["name"])
            except Exception as error:
                print(f"Operational workbook {key} unavailable: {type(error).__name__}: {error}")
                pending[key] = {"after": absent}
                continue
            observation.update(report_id=key, operating_date=report["date"])
        else:
            observation["reading_time"] = row["reading_time"]
        observation.update(first_seen_at=first_seen.isoformat(), absent_after=absent)
        observations.append(observation)
        seen[key] = date
    return {
        "baseline_through": baseline,
        "last_poll": {"started_at": started.isoformat(), "received_at": received.isoformat(),
                      "oldest_date": oldest, "latest_date": max(dates)},
        "seen": seen,
        "pending": pending,
        "observations": observations,
    }


def read_state(path, published_url):
    if path.is_file():
        state = json.loads(path.read_text(encoding="utf-8"))
    elif published_url:
        try:
            with urlopen(published_url, timeout=25) as response:
                state = json.load(response)
        except HTTPError as error:
            if error.code != 404:
                raise
            return {}
    else:
        return {}
    if state.get("version") != 1 or not isinstance(state.get("feeds"), dict):
        raise ValueError("Unsupported publication timing history")
    return state["feeds"]


def collect(path, published_url=None):
    feeds = read_state(path, published_url)
    with ThreadPoolExecutor(max_workers=len(FEEDS)) as pool:
        requests = {source: pool.submit(poll, source) for source in FEEDS}
        for source, request in requests.items():
            try:
                feeds[source] = update_feed(feeds.get(source, {}), source, request.result())
            except Exception as error:
                print(f"Publication timing {source} poll failed: {type(error).__name__}: {error}")
    state = {
        "version": 1,
        "retention_days": RETENTION_DAYS,
        "max_window_minutes": MAX_WINDOW_MINUTES,
        "min_estimate_days": MIN_ESTIMATE_DAYS,
        "feeds": feeds,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, separators=(",", ":")), encoding="utf-8")
    temporary.replace(path)
    return state


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, default=CACHE)
    parser.add_argument("--published-url")
    args = parser.parse_args()
    collect(args.state, args.published_url)
