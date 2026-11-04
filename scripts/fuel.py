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


def parse_pdf(content, source, url):
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        pages = pdf.pages if source == 'gtcl' else pdf.pages[:1]
        text = '\n'.join(p.extract_text() or '' for p in pages)
    row = parse_text(text, source)
    row.update(source=source, url=url, sha256=hashlib.sha256(content).hexdigest())
    return row


def parse_text(text, source):
    """Parse only a recognized report layout, rejecting missing/shifted columns."""
    if source == 'petrobangla':
        m = re.search(r'Date\s*:\s*(\d{1,2})\s*(?:[A-Za-z]+\s*)?-\s*(\d{1,2})\s*([A-Za-z]+),?\s*(\d{4})', text)
        if not m:
            raise ValueError('Unrecognized Petrobangla reporting period')
        date = datetime.strptime(f'{m[2]}-{m[3][:3]}-{m[4]}', '%d-%b-%Y').date().isoformat()
        total = number_line(text, r'^Grand Total[^:]*:\s*(.+)$')[2]
        lng = number_line(text, r'^5\.\s*RPGCL[^\n]*?\)\s*(.+)$')[1]
        state = number_line(text, r'^Sub-Total\s*\(1\+2\+3\)\s*(.+)$')[2]
        ioc = number_line(text, r'^Sub-Total\s+43\s+1615\s+(.+)$')[0]
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
        power = number_line(text, r'^Total Gas Consumption for Power[^\n]*?\)\s*(.+)$')
        if len(power) != 2:
            raise ValueError('Unexpected GTCL power-sector columns')
        row.update(power_demand=power[0], power_supply=power[1])
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
        return {k: v for k, v in row.items() if k not in {'url', 'sha256'}}
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
            urls = list(dict.fromkeys(re.findall(r'href="(https://[^"<>]+\.pdf)"', listing)))
            if not urls:
                raise ValueError('No report links found')
            def read(url):
                try:
                    path = cache / (hashlib.sha256(url.encode()).hexdigest()+'.pdf')
                    if not path.exists():
                        path.write_bytes(fetch(url))
                    return parse_pdf(path.read_bytes(), source, url)
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
