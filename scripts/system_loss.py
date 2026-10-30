"""Monthly collection of the Power Division's annual system-loss table.

Parser adapted from the local system_loss reference; no plotting dependencies.
"""
import datetime as dt
import json
import math
import re
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

SOURCE_URL = "https://powerdivision.gov.bd/pages/static-pages/694032ba35ce18e1c056155a"
SERIES = {name: i for i, name in enumerate(("BPDB", "REB", "DPDC", "DESCO", "WZPDCO", "NESCO", "DISTRIBUTION", "TRANSMISSION", "TRANSMISSION & DISTRIBUTION"), 1)}
HEADER = "অর্থবছর"
BEN_GALI_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
REFRESH_INTERVAL = dt.timedelta(days=30)
SEED = Path(__file__).resolve().parents[1] / "begd" / "system-loss-data.json"

class TableParser(HTMLParser):
    """Collect cell text from HTML tables, including nested formatting tags."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.table_depth = 0
        self.tables = []
        self.rows = None
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.table_depth += 1
            if self.table_depth == 1:
                self.rows = []
        elif self.table_depth == 1 and tag == "tr":
            self.row = []
        elif self.table_depth == 1 and tag in ("td", "th"):
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if self.table_depth == 1 and tag in ("td", "th") and self.cell is not None:
            text = " ".join("".join(self.cell).split())
            self.row.append(text)
            self.cell = None
        elif self.table_depth == 1 and tag == "tr" and self.row:
            self.rows.append(self.row)
            self.row = None
        elif tag == "table" and self.table_depth:
            self.table_depth -= 1
            if self.table_depth == 0:
                self.tables.append(self.rows)
                self.rows = None


def _number(value):
    value = value.translate(BEN_GALI_DIGITS).strip().replace(",", "")
    if not value:
        return None
    match = re.fullmatch(r"([-+]?\d+(?:\.\d+)?)\s*%?", value)
    if not match:
        raise ValueError(f"Unexpected system-loss value: {value!r}")
    number = float(match.group(1))
    if not math.isfinite(number) or not 0 <= number <= 100:
        raise ValueError("System loss must be a percentage between 0 and 100")
    return number


def parse_system_loss(html):
    """Parse the Power Division table, retaining blank values as None."""
    parser = TableParser()
    parser.feed(html)

    target_table = next(
        (
            table
            for table in parser.tables
            if table and table[0] and table[0][0].translate(BEN_GALI_DIGITS) == HEADER
        ),
        None,
    )
    if target_table is None:
        raise ValueError("Could not find the system-loss table on the source page")

    rows = []
    for row_number, cells in enumerate(target_table[1:], start=2):
        if not cells or not cells[0].strip():
            continue
        if len(cells) != len(SERIES) + 1:
            raise ValueError("Unexpected system-loss column count")
        year = cells[0].translate(BEN_GALI_DIGITS).strip()
        if not re.fullmatch(r"\d{4}-\d{2,4}", year):
            raise ValueError(f"Unexpected fiscal year on table row {row_number}: {year!r}")
        values = {name: _number(cells[column]) for name, column in SERIES.items()}
        rows.append({"fiscal_year": year, **values})

    if not rows:
        raise ValueError("The system-loss table contained no fiscal-year data")
    if len({row["fiscal_year"][:4] for row in rows}) != len(rows):
        raise ValueError("Duplicate system-loss fiscal year")
    return sorted(rows, key=lambda row: row["fiscal_year"])



def fetch_system_loss():
    request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "BEGD-System-Loss/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        content = response.read(5_000_001)
        if len(content) > 5_000_000:
            raise ValueError("System-loss page exceeds size limit")
        return parse_system_loss(content.decode(response.headers.get_content_charset() or "utf-8"))


def valid_bundle(bundle):
    if not isinstance(bundle, dict) or bundle.get("version") != 1 or bundle.get("source") != SOURCE_URL or not bundle.get("data"):
        return False
    try:
        years = []
        for row in bundle["data"]:
            year = row["fiscal_year"]
            if not re.fullmatch(r"\d{4}-\d{2,4}", year):
                return False
            years.append(year[:4])
            for name in SERIES:
                value = row[name]
                if value is not None and (isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not 0 <= value <= 100):
                    return False
        stamp = dt.datetime.fromisoformat(bundle.get("fetched_at") or bundle["snapshot_at"])
        if stamp.tzinfo is None:
            return False
        return len(set(years)) == len(years)
    except (KeyError, ValueError, TypeError, AttributeError):
        return False


def collect(cache_dir, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    cache = Path(cache_dir) / "system-loss.json"
    bundle = None
    for path in (cache, SEED):
        try:
            candidate = json.loads(path.read_text(encoding="utf-8"))
            if valid_bundle(candidate):
                bundle = candidate
                break
        except (OSError, ValueError):
            pass
    if bundle:
        try:
            checked = dt.datetime.fromisoformat(bundle.get("last_attempt_at") or bundle["fetched_at"])
            if dt.timedelta(0) <= now - checked < REFRESH_INTERVAL:
                return bundle
        except (ValueError, TypeError):
            pass
    try:
        rows = fetch_system_loss()
        candidate = dict(version=1, source=SOURCE_URL, series=list(SERIES), data=rows,
                      fetched_at=now.isoformat(), last_attempt_at=now.isoformat(),
                      refresh_interval_days=30, status="ok")
        if not valid_bundle(candidate):
            raise ValueError("Invalid system-loss response")
        bundle = candidate
    except Exception as error:
        if not bundle:
            return dict(version=1, source=SOURCE_URL, data=[], status="unavailable",
                        refresh_interval_days=30, error=type(error).__name__)
        bundle = dict(bundle, last_attempt_at=now.isoformat(), status="stale", error=type(error).__name__)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(bundle, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    return bundle
