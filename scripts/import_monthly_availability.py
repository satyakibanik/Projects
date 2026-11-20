"""Extract published reporting-circle availability from the operational workbooks."""
import argparse
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime
import json
import math
from pathlib import Path
import re

import openpyxl
import xlrd

SUMMARY_FORMS = {"outages": "QF-LDC-27", "energy": "QF-LDC-28"}
FORMS = {"substation": "QF-LDC-29", "line": "QF-LDC-30"}
ALIASES = {"Chittagong": "Chattogram", "Comilla": "Cumilla", "Bogra": "Bogura",
           "Bheramara (HVDC)": "HVDC", "Bheramara HVDC": "HVDC"}


def extract(rows, kind, form):
    start = None
    offset = 0
    after_total = False
    results = {}
    for index, row in enumerate(rows, 1):
        if start is None:
            heading = next((i for i, value in enumerate(row[:2])
                            if isinstance(value, str) and re.match(r"B\)\s*Availability", value.strip(), re.I)), None)
            if heading is not None:
                start, offset = index, heading
                continue
            after_total = after_total or str(row[1]).strip().casefold() == "total"
            # A legacy line form starts the fraction rows immediately after its interruption total.
            if not (after_total and form == "QF-LDC-30" and isinstance(row[0], (int, float))
                    and isinstance(row[1], str) and isinstance(row[2], (int, float)) and 0 <= row[2] <= 1):
                continue
            start = index
        serial, label, value = row[offset:offset + 3]
        if not (isinstance(serial, (int, float)) and isinstance(label, str)
                and re.search(r"[A-Za-z]", label)):
            if results:
                break
            continue
        cell = f"{form}!{'CD'[offset]}{index}"
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            continue
        if 0 <= value <= 1:
            fraction = value
        elif 90 <= value <= 100:
            fraction = value / 100
        else:
            continue
        label = " ".join(label.split())
        circle = ALIASES.get(label, label)
        if circle in results:
            raise ValueError(f"Duplicate reporting circle {circle} in {form}")
        results[circle] = {"circle": circle, "source_circle": label, "metric": kind,
                           "fraction": fraction, "source_value": value, "cell": cell}
    if not results:
        raise ValueError(f"Availability block missing in {form}")
    return list(results.values())


def summary(rows, form):
    for index, row in enumerate(rows, 1):
        if str(row[1]).strip().casefold() != "total" or len(row) < 10:
            continue
        def block(values, columns):
            cleaned = [value if isinstance(value, (int, float)) and not isinstance(value, bool)
                       and math.isfinite(value) and value >= 0 else None for value in values]
            return dict(zip(("tripping", "emergency", "scheduled", "total"), cleaned)) | {
                "cell": f"{form}!{columns[0]}{index}:{columns[-1]}{index}"}
        return {"previous": block(row[2:6], "CDEF"), "current": block(row[6:10], "GHIJ")}
    raise ValueError(f"Summary total missing in {form}")


def read(path):
    results = []
    summaries = {}
    issues = []
    def parse_forms(rows_for):
        for kind, form in FORMS.items():
            try:
                results.extend(extract(rows_for(form, 4), kind, form))
            except (KeyError, ValueError, xlrd.XLRDError) as error:
                issues.append({"form": form, "reason": str(error)})
        for kind, form in SUMMARY_FORMS.items():
            try:
                summaries[kind] = summary(rows_for(form, 10), form)
            except (KeyError, ValueError, xlrd.XLRDError) as error:
                issues.append({"form": form, "reason": str(error)})

    if path.suffix == ".xls":
        with xlrd.open_workbook(path, on_demand=True) as workbook:
            def rows_for(form, width):
                sheet = workbook.sheet_by_name(form)
                return (sheet.row_values(i, 0, width) for i in range(sheet.nrows))
            parse_forms(rows_for)
    else:
        workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
        try:
            names = {name.strip(): name for name in workbook.sheetnames}
            parse_forms(lambda form, width: workbook[names[form]].iter_rows(max_col=width, values_only=True))
        finally:
            workbook.close()
    return results, summaries, issues


def report_month(title):
    return datetime.strptime(re.sub(r"[ _-]+", "-", title.strip()), "%B-%Y").strftime("%Y-%m")


def read_report(job):
    month, path, url = job
    try:
        values, summaries, issues = read(path)
    except (ValueError, OSError, KeyError, xlrd.XLRDError) as error:
        values, summaries, issues = [], {}, [{"reason": str(error)}]
    return month, path, url, values, summaries, issues


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("source", type=Path)
    args.add_argument("output", type=Path)
    args.add_argument("--archive", type=Path, help="Prefer official downloads for overlapping months")
    options = args.parse_args()
    paths = sorted(path for path in options.source.iterdir() if path.suffix in {".xls", ".xlsx"})
    if not paths:
        args.error("No operational workbooks found")
    jobs = {report_month(path.stem): (path, None) for path in paths}
    unavailable = []
    if options.archive:
        manifest = options.archive / "manifest.json"
        if not manifest.is_file():
            args.error("Archive manifest is missing")
        for record in json.loads(manifest.read_text()):
            path = options.archive / record["file"]
            if record.get("error") or path.suffix not in {".xls", ".xlsx", ".xlsm"}:
                unavailable.append({key: record[key] for key in ("title", "url", "error") if key in record})
                continue
            month = report_month(record.get("title") or path.stem)
            jobs[month] = (path, record["url"])
    months = {}
    reliability = {}
    issues_by_month = {}
    with ProcessPoolExecutor(max_workers=5) as pool:
        results = pool.map(read_report, ((month, path, url) for month, (path, url) in sorted(jobs.items())))
        for month, path, url, values, summaries, issues in results:
            source = {"file": path.name}
            if url:
                source["url"] = url
            months[month] = {"month": month, "values": values, **source}
            if issues:
                issues_by_month[month] = issues
            period = datetime.strptime(month, "%Y-%m")
            previous = period.replace(month=period.month - 1) if period.month > 1 else period.replace(year=period.year - 1, month=12)
            for metric, blocks in summaries.items():
                reliability.setdefault(previous.strftime("%Y-%m"), {}).setdefault(metric, {
                    **blocks["previous"], **source, "basis": "previous"})
                reliability.setdefault(month, {})[metric] = {**blocks["current"], **source, "basis": "current"}
    options.output.write_text(json.dumps({"reports": [months[k] for k in sorted(months)], "reliability": reliability, "issues": issues_by_month, "unavailable": unavailable}, indent=2) + "\n")


if __name__ == "__main__":
    main()
