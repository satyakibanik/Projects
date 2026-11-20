"""Probe fuel sources using the production fetch/parser code, without publishing.

Source failures are results in the JSON report, not a reason to discard that report.
This command never writes the site's seed, collector cache or deployment output.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import re
import subprocess

from fuel import SOURCES, error_details, fetch, parse_coal, parse_pdf


def probe(source):
    url = SOURCES[source] + ('&page_size=10' if source != 'coal' else '')
    result = {'source': source, 'url': url, 'stage': 'listing' if source != 'coal' else 'coal_page'}
    try:
        body = fetch(url)
        result['page_bytes'] = len(body)
        if source == 'coal':
            result['stage'] = 'coal_parse'
            rows = parse_coal(body.decode('utf-8'))
            result.update(status='ok', annual_records=len(rows), latest_year=rows[-1]['year'])
        else:
            result['stage'] = 'listing_parse'
            urls = list(dict.fromkeys(re.findall(r'href="(https://[^"<>]+\.pdf)"', body.decode('utf-8'))))
            if not urls:
                raise ValueError('No report links found')
            result.update(report_links=len(urls), pdf_url=urls[0], stage='pdf_download')
            content = fetch(urls[0])
            result.update(pdf_bytes=len(content), stage='pdf_parse')
            row = parse_pdf(content, source, urls[0])
            result.update(status='ok', report_date=row['date'], total=row['total'], sha256=row['sha256'])
    except Exception as exc:
        result.update(status='failed', error=str(exc), error_details=error_details(exc))
    return result


def diagnose():
    version = subprocess.run(['curl', '--version'], check=True, capture_output=True, text=True).stdout.splitlines()[0]
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(probe, ['petrobangla', 'gtcl', 'coal']))
    return {'checked_at': datetime.now(timezone.utc).isoformat(), 'platform': platform.platform(),
            'python': platform.python_version(), 'curl': version,
            'https_verification': True, 'results': results}


def summary(report):
    lines = ['## Fuel source diagnostics', '',
             'Production HTTPS settings; no site publication or saved-data changes.', '',
             '| Source | Result | Last stage | Curl exit |', '| --- | --- | --- | --- |']
    for row in report['results']:
        lines.append(f"| {row['source']} | {row['status']} | {row['stage']} | {row.get('error_details', {}).get('curl_exit_code', '—')} |")
    lines += ['', 'Full error text, URLs, runtime version and report metadata are in the diagnostic artifact.', '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('fuel-diagnostics.json'))
    args = parser.parse_args()
    report = diagnose()
    text = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False)+'\n'
    args.output.write_text(text, encoding='utf-8')
    print(text)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as handle:
            handle.write(summary(report))


if __name__ == '__main__':
    main()
