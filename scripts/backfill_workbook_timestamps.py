"""Build a historical Excel metadata snapshot from the public ERP archive."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import json
from pathlib import Path

import publication_timing as timing
import server


def archive_reports(start, end):
    page = 1
    page_count = 1
    reports = {}
    while page <= page_count:
        rows, total = server.fetch_listing_page(page)
        if page == 1:
            page_count = total
        for row in rows:
            if start <= row["published_date"] <= end:
                reports[row["id"]] = row
        if not rows or max(row["published_date"] for row in rows) < start:
            break
        page += 1
    return sorted(reports.values(), key=lambda row: (row["published_date"], int(row["id"])), reverse=True)


def collect(start, end):
    def read(row):
        record = {"report_id": row["id"], "listed_date": row["published_date"]}
        try:
            workbook = server.fetch_bytes(row["download_url"], limit=server.MAX_REPORT_BYTES)
            record.update(timing.workbook_timestamps(workbook))
        except (OSError, RuntimeError, ValueError) as error:
            print(f'Workbook {row["id"]}: {error}')
            record["download_failed"] = True
        return record

    reports = archive_reports(start, end)
    with ThreadPoolExecutor(max_workers=3) as pool:
        return {"start_date": start, "end_date": end, "reports": list(pool.map(read, reports))}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--end-date", type=dt.date.fromisoformat, required=True)
    parser.add_argument("--days", type=int, choices=range(1, 91), default=60, metavar="1–90")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    start_date = args.end_date - dt.timedelta(days=args.days - 1)
    result = collect(start_date.isoformat(), args.end_date.isoformat())
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f'Wrote {len(result["reports"])} workbook records for {start_date} through {args.end_date}')
