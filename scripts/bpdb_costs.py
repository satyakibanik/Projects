"""Extract dated, reconciled BDT costs from BPDB's public daily PDFs.

No costs are inferred from generation or tariffs. Labels and source scope are retained.
"""
import argparse
import datetime as dt
import hashlib
import io
import json
import pathlib
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
from zoneinfo import ZoneInfo

ARCHIVE = 'https://misc.bpdb.gov.bd/daily-generation-archive'
VERSION = 1
NUMBER = r'\d[\d,]*(?:\.\d+)?'
DATE = r'\d{1,2}[.\-/]\d{1,2}[.\-/](?:\d{4}|\d{2})\b'
LABEL = r'Cost\s+of\s+the\s+Consumed\s+Fuel(?:\s*\([^)]*\))?|Fuel\s+cost\s*:?|Production\s+Cost\s*\(\s*Tk\.?\s*\)'
CATEGORIES = r'Renewable|Imports?|Hydro|Solar|Wind|Coal|Gas|HFO|HSD|Oil'


def number(value):
    return float(value.replace(',', ''))


def date_value(value):
    parts = re.split(r'[.\-/]', value)
    day, month, year = map(int, parts)
    return dt.date(year + 2000 if year < 100 else year, month, day)


def parse_cost_text(text, source_url='', archive_date=None):
    heading = re.search(LABEL, text, re.I)
    if not heading:
        raise ValueError('No supported cost heading')
    production = heading.group().lower().startswith('production')
    if production:
        match = re.search(r'\bDate\s*:\s*(' + DATE + ')', text, re.I)
    else:
        match = re.search(r'Actual\s+data\s+of\s*(' + DATE + ')', text, re.I)
        if not match:
            # Legacy Page 1 explicitly dates the actual figures as Yesterday.
            match = re.search(r'(' + DATE + r')\s*\(?Yesterday\)?', text, re.I)
    if not match:
        raise ValueError('No explicit operating date; do not infer from filename')
    operating = date_value(match.group(1))
    if archive_date and not 0 <= (dt.date.fromisoformat(archive_date)-operating).days <= 3:
        raise ValueError('Printed operating date disagrees with archive date by more than 3 days')
    section = text[heading.end():]
    # Locate the total within the cost block, not a later energy or zone total.
    total_match = re.search(r'\bTotal\s*[:=]\s*(?:Tk\.?\s*(?P<prefix>' + NUMBER + r')|(?P<suffix>' + NUMBER + r')\s*(?:Tk\.?|Taka)\b)', section, re.I)
    if not total_match:
        raise ValueError('No monetary cost total')
    block = section[:total_match.start()]
    values = {}
    for entry in re.finditer(r'\b(' + CATEGORIES + r')\s*[:=]?\s*(?:Tk\.?\s*)?(' + NUMBER + ')', block, re.I):
        key = entry.group(1).title()
        if key in ('Import', 'Imports'): key = 'Imports'
        if key in ('Hfo', 'Hsd'): key = key.upper()
        if key in values:
            raise ValueError('Repeated cost category')
        values[key] = number(entry.group(2))
    expected = {'Gas', 'Coal', 'HFO', 'HSD', 'Hydro', 'Solar', 'Imports', 'Wind'} if production else {'Gas', 'Oil', 'Coal'}
    if not expected.issubset(values):
        raise ValueError('Incomplete cost breakdown')
    total = number(total_match.group('prefix') or total_match.group('suffix'))
    # Printed totals round BDT; individual fields also have limited decimals.
    if total < 0 or abs(sum(values.values())-total) > max(5, len(values)):
        raise ValueError('Cost categories do not reconcile to printed total')
    unit = re.search(r'Production\s+Cost\s+per\s+KWHr\s*[:=]?\s*(' + NUMBER + ')', text, re.I)
    energy = re.search(r'Energy\s+Generated\s*[:=]?\s*(' + NUMBER + r')\s*MKWH', text, re.I)
    per_kwh = number(unit.group(1)) if unit else None
    energy_kwh = number(energy.group(1))*1_000_000 if energy else None
    if per_kwh is not None and energy_kwh and abs(per_kwh-total/energy_kwh) > .001:
        raise ValueError('Printed per-kWh cost disagrees with production cost and energy')
    return dict(date=operating.isoformat(), archive_date=archive_date, source_url=source_url,
                source_label=heading.group().strip().rstrip(':'),
                scope='production' if production else 'consumed_fuel',
                currency='BDT', total_bdt=total, costs_bdt=values,
                production_cost_per_kwh=per_kwh, reported_energy_kwh=energy_kwh)


def parse_pdf(content, source_url='', archive_date=None):
    import pdfplumber
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        # Some Page 1 links contain multiple physical pages.
        text = ''
        for page in pdf.pages[:4]:
            text += '\n' + (page.dedupe_chars().extract_text() or '')
            if re.search(LABEL, text, re.I):
                break
    result = parse_cost_text(text, source_url, archive_date)
    result['sha256'] = hashlib.sha256(content).hexdigest()
    return result


class ArchiveParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.cells, self.cell, self.links = [], None, None, []

    def handle_starttag(self, tag, attrs):
        if tag == 'tr': self.cells, self.links = [], []
        if tag == 'td' and self.cells is not None: self.cell = ''
        if tag == 'a' and self.cell is not None:
            self.links.append((len(self.cells), dict(attrs).get('href', '')))

    def handle_data(self, data):
        if self.cell is not None: self.cell += data

    def handle_endtag(self, tag):
        if tag == 'td' and self.cell is not None:
            self.cells.append(self.cell.strip())
            self.cell = None
        if tag == 'tr' and self.cells is not None:
            if len(self.cells) >= 3 and re.fullmatch(DATE, self.cells[1]):
                for column, link in self.links:
                    url = urljoin(ARCHIVE, link)
                    if column == 2 and urlparse(url).hostname == 'misc.bpdb.gov.bd' and urlparse(url).path.lower().endswith('.pdf'):
                        self.rows.append(dict(archive_date=date_value(self.cells[1]).isoformat(), source_url=url))
            self.cells = None


def fetch(url):
    result = subprocess.run(['curl', '--fail', '--location', '--silent', '--show-error',
                             '--retry', '2', '--max-time', '30', '--proto', '=https', url],
                            check=True, capture_output=True)
    if len(result.stdout) > 20*1024*1024: raise ValueError('Oversized BPDB response')
    return result.stdout


def collect(cache_dir, days=365, max_pages=40, workers=4, refresh_hours=6):
    cache_dir = pathlib.Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    manifest = cache_dir/'costs.json'
    now = dt.datetime.now(dt.timezone.utc)
    today = now.astimezone(ZoneInfo('Asia/Dhaka')).date()
    start = today-dt.timedelta(days=days+3)
    try: previous = json.loads(manifest.read_text())
    except (OSError, ValueError):
        try: previous = json.loads((pathlib.Path(__file__).resolve().parents[1]/'begd'/'costs-data.json').read_text())
        except (OSError, ValueError): previous = {}
    if previous.get('parser_version') == VERSION and now.timestamp()-previous.get('refreshed_at', 0) < refresh_hours*3600:
        return previous
    entries, errors = [], []
    for page in range(1, max_pages+1):
        try:
            parser = ArchiveParser()
            parser.feed(fetch(f'{ARCHIVE}?page={page}').decode('utf-8'))
            if not parser.rows: break
            entries.extend(row for row in parser.rows if row['archive_date'] >= start.isoformat())
            if min(row['archive_date'] for row in parser.rows) < start.isoformat(): break
        except Exception as error:
            errors.append(dict(source_url=f'{ARCHIVE}?page={page}', error=str(error)))
            break
    known_by_url = {row['source_url']: row for row in previous.get('days', []) if row.get('parser_version') == VERSION}
    def load(entry):
        key = hashlib.sha256(entry['source_url'].encode()).hexdigest()
        saved = cache_dir/(key+'.json')
        try:
            if saved.exists() and entry['archive_date'] < (today-dt.timedelta(days=14)).isoformat():
                cached = json.loads(saved.read_text())
                if cached.get('parser_version') == VERSION: return cached
            if entry['archive_date'] < (today-dt.timedelta(days=14)).isoformat() and entry['source_url'] in known_by_url:
                return known_by_url[entry['source_url']]
            content = fetch(entry['source_url'])
            row = parse_pdf(content, **entry)
            row.update(parser_version=VERSION, fetched_at=now.isoformat())
            saved.write_text(json.dumps(row, allow_nan=False))
            return row
        except Exception as error:
            return dict(**entry, error=str(error))
    # Retain validated older data on a network outage, replacing it only with valid revisions.
    by_date = {row['date']:row for row in previous.get('days', []) if start.isoformat() <= row['date'] <= today.isoformat()}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(load, entries))
    for row in sorted(results, key=lambda row:(row.get('archive_date', ''), row['source_url'])):
        if 'error' in row:
            errors.append(row)
        elif start.isoformat() <= row['date'] <= today.isoformat():
            by_date[row['date']] = row
    output = dict(parser_version=VERSION, generated_at=now.isoformat(), refreshed_at=now.timestamp(),
                  source=ARCHIVE, days=sorted(by_date.values(), key=lambda row:row['date']), errors=errors)
    # Retry an unavailable/partial archive on the next build instead of caching an outage for six hours.
    if not entries or any('page=' in e['source_url'] for e in errors): output['refreshed_at'] = 0
    manifest.write_text(json.dumps(output, allow_nan=False, separators=(',', ':')))
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='begd/costs-data.json')
    parser.add_argument('--cache-dir', default='.cache/bpdb-costs')
    parser.add_argument('--days', type=int, default=365)
    parser.add_argument('--max-pages', type=int, default=40)
    parser.add_argument('--refresh-hours', type=float, default=6)
    args = parser.parse_args()
    bundle = collect(args.cache_dir, args.days, args.max_pages, refresh_hours=args.refresh_hours)
    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(bundle, allow_nan=False, separators=(',', ':')))
    print(f"BPDB costs: {len(bundle['days'])} validated operating dates; {len(bundle['errors'])} rejected/unavailable reports")


if __name__ == '__main__': main()
