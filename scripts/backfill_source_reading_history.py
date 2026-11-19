"""Extract dated reading slots from the public ERP history for the timing dashboard."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import json
import math
from pathlib import Path
import re

from erp_history import load_range

FIELDS = {
    "demand": ("demand_mw", "supply_mw", "shed_mw"),
    "generation": ("generation_mw",),
    "imports": ("bheramara_mw", "tripura_mw", "adani_mw"),
}


def summarize(kind, rows):
    return sorted({row["time"] for row in rows
                   if re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", row["time"])
                   and any(row.get(key) is not None and math.isfinite(row[key]) for key in FIELDS[kind])})


def collect(start, end, cache):
    with ThreadPoolExecutor(max_workers=len(FIELDS)) as pool:
        futures = {kind: pool.submit(load_range, kind, start, end, cache) for kind in FIELDS}
        sources = {}
        for kind, future in futures.items():
            result = future.result()
            slots = {day: summarize(kind, rows) for day, rows in sorted(result["days"].items())
                     if start <= day <= end}
            sources[kind] = dict(days={day: times for day, times in slots.items() if times},
                                 unavailable=sorted(day for day in result.get("failures", {}) if start <= day <= end))
    return dict(version=1, start_date=start, end_date=end, sources=sources)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--end-date", type=dt.date.fromisoformat, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    start = args.end_date - dt.timedelta(days=59)
    result = collect(start.isoformat(), args.end_date.isoformat(), args.cache)
    args.output.write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")
    print({name: len(source["days"]) for name, source in result["sources"].items()})
