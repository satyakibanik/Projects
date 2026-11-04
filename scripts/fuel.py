"""Dated Petrobangla gas reports, GTCL checks, and annual BCMCL coal data.

No interpolation, substitution between publishers, or inferred daily coal output.
PDF dates win over listing/publication dates. Fetch failures preserve saved rows.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path
import re
import subprocess
from urllib.parse import urlparse

import pdfplumber

REPORT_FILTER = '?filters=%7B%22reports_type%22%3A%20%226922d2b181fc96cef9e99f16%22%7D'
SOURCES = {'petrobangla': 'https://petrobangla.org.bd/pages/reports' + REPORT_FILTER,
           'gtcl': 'https://gtcl.gov.bd/pages/reports' + REPORT_FILTER,
           'coal': 'https://bcmcl.org.bd/pages/static-pages/6922dd3c933eb65569e140ed',
           'emrd': 'https://emrddashboard.gov.bd/'}
BN = str.maketrans('০১২৩৪৫৬৭৮৯', '0123456789')


def fetch(url):
    host = urlparse(url).hostname or ''
    if host not in {'petrobangla.org.bd', 'gtcl.gov.bd', 'bcmcl.org.bd'} and host != 'objectstorage.ap-dcc-gazipur-1.oraclecloud15.com':
        raise ValueError('Unexpected fuel source host')
    # Use the platform trust store; never disable certificate verification.
    return subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location',
                           '--proto', '=https', '--proto-redir', '=https', '--max-time', '35',
                           '--max-filesize', '15000000', url], check=True, capture_output=True).stdout


def number_line(text, pattern):
    match = re.search(pattern, text, re.M | re.I)
    if not match:
        raise ValueError('Missing expected report row: ' + pattern)
    return [float(n.replace(',', '')) for n in re.findall(r'\d[\d,]*\.\d+|\d+', match.group(1))]


def metadata_period(text, metadata):
    """Complete an incomplete heading only with matching evidence inside the PDF."""
    heading = re.search(r'Date\s*:\s*(.*?)\s+From\b', text, re.I)
    title = str(metadata.get('Title', ''))
    workbook = re.fullmatch(r'\s*(\d{1,2})\.\s*([A-Za-z]+)\s+(20\d{2})\.xlsx\s*', title, re.I)
    created = re.match(r'D:(\d{8})', str(metadata.get('CreationDate', '')))
    if not heading or not workbook or not created:
        return None
    period = re.fullmatch(r'(\d{1,2})\s*([A-Za-z]*)\s*-\s*(\d{1,2})\s*([A-Za-z]*)', heading[1])
    if not period:
        return None
    try:
        month = datetime.strptime(workbook[2][:3], '%b').month
        if month != int(workbook[1]):
            return None
        start_month = datetime.strptime(period[2][:3], '%b').month if period[2] else month
        end_month = datetime.strptime(period[4][:3], '%b').month if period[4] else month
        if start_month != month:
            return None
        start = datetime(int(workbook[3]), start_month, int(period[1]))
        end = datetime(int(workbook[3]) + (end_month < start_month), end_month, int(period[3]))
        if (end-start).days != 1 or created[1] != end.strftime('%Y%m%d'):
            return None
    except ValueError:
        return None
    return dict(heading=heading[1], pdf_title=title, creation_date=created[1],
                start=start.date().isoformat(), end=end.date().isoformat())


def parse_pdf(content, source, url):
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        pages = pdf.pages if source == 'gtcl' else pdf.pages[:1]
        text = '\n'.join(p.extract_text() or '' for p in pages)
        try:
            row = parse_text(text, source)
        except (ValueError, IndexError):
            # Some older PDFs paint identical glyphs twice at the same position.
            # Remove only overlapping duplicate glyphs, keeping column checks.
            text = '\n'.join(p.dedupe_chars().extract_text() or '' for p in pages)
            try:
                row = parse_text(text, source)
            except (ValueError, IndexError):
                evidence = metadata_period(text, pdf.metadata) if source == 'petrobangla' else None
                if not evidence:
                    raise
                start = datetime.fromisoformat(evidence['start']).strftime('%d %b %Y')
                end = datetime.fromisoformat(evidence['end']).strftime('%d %b %Y')
                completed = re.sub(r'Date\s*:\s*.*?\s+From\b', f'Date: {start} - {end} From', text, count=1, flags=re.I)
                row = parse_text(completed, source)
                row.update(date_basis='pdf_heading_and_metadata', date_evidence=evidence)
    row.update(source=source, url=url, sha256=hashlib.sha256(content).hexdigest())
    return row


def parse_xlsx(content, source, url):
    """Read GTCL's named gas worksheet using its cached published values."""
    if source != 'gtcl':
        raise ValueError('Unsupported spreadsheet publisher')
    from openpyxl import load_workbook
    with io.BytesIO(content) as stream:
        book = load_workbook(stream, read_only=True, data_only=True)
        try:
            sheet = book['Gas Report']
            rows = list(sheet.iter_rows(max_row=500, max_col=8, values_only=True))
            def find(pattern, column=1):
                matches = [r for r in rows if re.search(pattern, str(r[column] or ''), re.I)]
                if len(matches) != 1:
                    raise ValueError('Missing or ambiguous GTCL spreadsheet row: ' + pattern)
                return matches[0]
            reporting = find(r'^\s*Reporting Date\s*:', 5)[7]
            if not isinstance(reporting, datetime):
                raise ValueError('GTCL spreadsheet reporting date is not a date')
            period = rows[9]
            if not all(isinstance(period[i], datetime) for i in [1, 2]):
                raise ValueError('Missing GTCL spreadsheet reporting period')
            if period[2].date() != reporting.date() or (period[2]-period[1]).days != 1:
                raise ValueError('Inconsistent GTCL spreadsheet reporting period')
            if 'Production MMSCF' not in str(rows[12][4]):
                raise ValueError('Unexpected GTCL spreadsheet production units')
            def numeric(value):
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                    raise ValueError('Missing cached numeric GTCL spreadsheet value')
                return float(value)
            total = numeric(find(r'^Total Production\s*\(')[4])
            mlng = numeric(find(r'RLNG Intake:.*MLNG')[4])
            slng = numeric(find(r'^\s*b\) SLNG')[4])
            power = find(r'^Total Gas Consumption for Power\s*\(')
            row = dict(date=reporting.date().isoformat(), total=total,
                       lng=round(mlng+slng, 4), domestic=round(total-mlng-slng, 4),
                       power_demand=numeric(power[2]), power_supply=numeric(power[3]))
            if not 0 <= row['lng'] <= row['total'] <= 10000:
                raise ValueError('Implausible GTCL spreadsheet gas supply')
            row.update(source=source, url=url, sha256=hashlib.sha256(content).hexdigest())
            return row
        finally:
            book.close()


def parse_report(content, source, url):
    return parse_xlsx(content, source, url) if url.lower().endswith('.xlsx') else parse_pdf(content, source, url)


def parse_text(text, source):
    """Parse only a recognized report layout, rejecting missing/shifted columns."""
    if source == 'petrobangla':
        # An older printed heading places the explicit year before the month.
        text = re.sub(r'(Date\s*:\s*\d{1,2}\s*-\s*\d{1,2})\s+(20\d{2})\s+([A-Za-z]+)', r'\1 \3 \2', text, count=1, flags=re.I)
        m = re.search(r'Date\s*:\s*(\d{1,2})\s*(?:[A-Za-z]+\s*(?:20\d{2}\s*)?)?-\s*(\d{1,2})\s*([A-Za-z]+)\s*[,-]?\s*(20\d{2}|\d{2})(?!\d)', text)
        if not m:
            raise ValueError('Unrecognized Petrobangla reporting period')
        year = int(m[4]) + (2000 if len(m[4]) == 2 else 0)
        date = datetime.strptime(f'{m[2]}-{m[3][:3]}-{year}', '%d-%b-%Y').date().isoformat()
        total = number_line(text, r'^Grand Total[^:]*:\s*(.+)$')[2]
        lng = number_line(text, r'^5\.\s*RPGCL[^\n]*?\)\s*(.+)$')[1]
        state = number_line(text, r'^Sub-Total\s*\(1\+2\+3\)\s*(.+)$')[2]
        ioc_section = re.search(r'^4\.\s*IOCs\b(.*?)^5\.\s*RPGCL\b', text, re.M | re.S | re.I)
        if not ioc_section:
            raise ValueError('Missing IOC production section')
        ioc_row = number_line(ioc_section[1], r'^Sub-Total\s+(.+)$')
        if len(ioc_row) != 6:
            raise ValueError('Unexpected IOC production columns')
        ioc = ioc_row[2]
        distribution = number_line(text, r'^Total\s*:\s*(.+)$')
        if len(distribution) != 7:
            raise ValueError('Unexpected distribution columns')
        row = dict(date=date, total=total, lng=lng, domestic=round(state+ioc, 1), state=state,
                   ioc=ioc, power_demand=distribution[0], power_supply=distribution[1],
                   fertilizer_demand=distribution[2], fertilizer_supply=distribution[3],
                   others=distribution[4], distribution_total=distribution[5])
        if abs(total-lng-row['domestic']) > 0.3:
            raise ValueError('Gas components do not reconcile')
    else:
        m = re.search(r'Reporting Date:\s*(\d{1,2}-[A-Za-z]+-\d{4})', text)
        if not m:
            raise ValueError('Missing GTCL reporting date')
        date = datetime.strptime(m[1], '%d-%b-%Y').date().isoformat()
        total = number_line(text, r'^2\. Total Production[^\n]*?\)\s*(.+)$')[-1]
        mlng = number_line(text, r'^H\. RLNG Intake:.*?MLNG\s*(.+)$')[-1]
        slng = number_line(text, r'^b\) SLNG\s*(.+)$')[-1]
        row = dict(date=date, total=total, lng=round(mlng+slng, 4), domestic=round(total-mlng-slng, 4))
        power_match = re.search(r'^Total Gas Consumption for Power[^\n]*?\)\s*(.+)$', text, re.M | re.I)
        if power_match:
            power = number_line(text, r'^Total Gas Consumption for Power[^\n]*?\)\s*(.+)$')
            if len(power) not in [2, 4]:
                raise ValueError('Unexpected GTCL power-sector columns')
            # The four-column layout adds 08:00/20:00 instantaneous flows after
            # demand and 24-hour supply. They are not extra daily consumption.
            row.update(power_demand=power[0], power_supply=power[1])
        else:
            # Some official uploads omit the page containing sector totals.
            row.update(power_demand=None, power_supply=None)
    if not 0 <= row['lng'] <= row['total'] <= 10000:
        raise ValueError('Implausible gas supply')
    return row


def parse_coal(html):
    text = re.sub('<[^>]+>', ' ', html).translate(BN)
    rows = []
    for year, end, value in re.findall(r'(20\d{2})\s*-\s*(20\d{2})\s+([\d,]+\.\d+)', text):
        if int(end) == int(year)+1:
            rows.append(dict(year=f'{year}–{end}', tonnes=float(value.replace(',', ''))))
    if not rows:
        raise ValueError('Annual coal table missing')
    return list({r['year']: r for r in rows}.values())


def merge_reports(saved, incoming):
    """Keep saved observations; quarantine conflicting publisher versions."""
    merged = {r['date']: r for r in saved}
    groups = {}
    for row in incoming:
        groups.setdefault(row['date'], []).append(row)
    conflicts = []
    def values(row):
        return {k: v for k, v in row.items() if k not in {'url', 'sha256', 'date_basis', 'date_evidence', 'extraction_method', 'ocr_validation'}}
    for date, versions in groups.items():
        candidates = ([merged[date]] if date in merged else []) + versions
        if any(values(row) != values(candidates[0]) for row in candidates[1:]):
            conflicts.append({'date': date, 'urls': list(dict.fromkeys(r['url'] for r in candidates))})
            continue
        if date not in merged:
            merged[date] = versions[0]
    return list(merged.values()), conflicts


def collect(seed, cache, page_size=10):
    cache.mkdir(parents=True, exist_ok=True)
    saved = cache / 'fuel-data.json'
    bundle = json.loads(seed.read_text()) if seed.exists() else {'gas': [], 'checks': [], 'coal': []}
    if saved.exists():
        try:
            prior = json.loads(saved.read_text())
        except (ValueError, OSError):
            prior = {}  # A damaged optional cache must not discard the seed.
        for key in ['gas', 'checks']:
            bundle[key] = list({r['date']: r for r in bundle[key]+prior.get(key, [])}.values())
        if prior.get('coal'):
            bundle['coal'] = prior['coal']
        if prior.get('last_successful_refresh_at', '') > bundle.get('last_successful_refresh_at', ''):
            bundle['last_successful_refresh_at'] = prior['last_successful_refresh_at']
    status = []
    for source, key in [('petrobangla', 'gas'), ('gtcl', 'checks')]:
        failures = []
        try:
            listing = fetch(SOURCES[source]+f'&page_size={page_size}').decode()
            extensions = r'(?:pdf|xlsx)' if source == 'gtcl' else 'pdf'
            urls = list(dict.fromkeys(re.findall(r'href="(https://[^"<>]+\.' + extensions + r')"', listing, re.I)))
            if not urls:
                raise ValueError('No report links found')
            def read(url):
                try:
                    suffix = '.xlsx' if url.lower().endswith('.xlsx') else '.pdf'
                    path = cache / (hashlib.sha256(url.encode()).hexdigest()+suffix)
                    if not path.exists():
                        path.write_bytes(fetch(url))
                    return parse_report(path.read_bytes(), source, url)
                except Exception as exc:
                    failures.append(str(exc)[:180])
                    return None
            with ThreadPoolExecutor(max_workers=4) as pool:
                rows = [r for r in pool.map(read, urls) if r]
            bundle[key], conflicts = merge_reports(bundle[key], rows)
            failures.extend('Conflicting published reports for ' + r['date'] for r in conflicts)
            status.append(dict(source=source, status='partial' if failures else 'ok', reports=len(rows), errors=failures[:3], conflicts=conflicts))
        except Exception as exc:
            status.append(dict(source=source, status='failed', errors=[str(exc)[:180]]))
    try:
        bundle['coal'] = parse_coal(fetch(SOURCES['coal']).decode())
        status.append(dict(source='coal', status='ok'))
    except Exception as exc:
        status.append(dict(source='coal', status='failed', errors=[str(exc)[:180]]))
    bundle.update(schema_version=1, sources=SOURCES, last_attempt_at=datetime.now(timezone.utc).isoformat(), source_status=status)
    for key in ['gas', 'checks']:
        bundle[key].sort(key=lambda r:r['date'])
    if all(s['status']=='ok' for s in status):
        bundle['last_successful_refresh_at'] = bundle['last_attempt_at']
    temporary = saved.with_suffix('.tmp')
    temporary.write_text(json.dumps(bundle, ensure_ascii=False, allow_nan=False, indent=2)+'\n')
    temporary.replace(saved)
    return bundle


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed', type=Path, default=Path('begd/fuel-data.json'))
    parser.add_argument('--cache', type=Path, default=Path('.cache/fuel'))
    parser.add_argument('--output', type=Path, default=Path('begd/fuel-data.json'))
    parser.add_argument('--page-size', type=int, choices=[10, 20, 50, 100, 250, 500, 1000], default=10)
    args = parser.parse_args()
    args.output.write_text(json.dumps(collect(args.seed, args.cache, args.page_size), ensure_ascii=False, allow_nan=False, indent=2)+'\n')
