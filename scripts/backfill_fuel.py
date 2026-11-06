"""Walk official report archive pages and retain only validated daily observations.

Run separately from the frequent Pages build. PDF and parsed-result caches make
large backfills resumable; output and audit files are replaced only on completion.
"""
import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import date, datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import time

import fuel

PARSER_ID = hashlib.sha256(Path(fuel.__file__).read_bytes() + Path(__file__).with_name('fuel_ocr.py').read_bytes()).hexdigest()


def report_links(html, source):
    extensions = r'(?:pdf|xlsx)' if source == 'gtcl' else 'pdf'
    return list(dict.fromkeys(re.findall(r'href="(https://[^"<>]+\.' + extensions + r')"', html, re.I)))


def archive_pages(source, cache, page_size=1000, max_pages=0):
    """Read every advertised page, respecting an explicit optional page limit."""
    pages, urls = [], []
    page, last = 1, 1
    while page <= last:
        url = fuel.SOURCES[source] + f'&page_size={page_size}&page={page}'
        content = fuel.fetch(url)
        html = content.decode('utf-8')
        path = cache / f'{source}-page-{page}.html'
        path.write_bytes(content)
        links = report_links(html, source)
        advertised = [int(n) for n in re.findall(r'data-page="(\d+)"', html)]
        last = max([last] + advertised)
        if last > 100:
            raise ValueError('Unexpectedly large report archive; inspect pagination')
        if max_pages:
            last = min(last, max_pages)
        report_rows = [row for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>', html, re.S | re.I)
                       if '/pages/reports/' in row]
        unavailable = []
        for row in report_rows:
            if not report_links(row, source):
                detail = re.search(r'href="(/pages/reports/[^"]+)"', row)
                unavailable.append(dict(detail_path=detail[1] if detail else None,
                                        listing_text=' '.join(re.sub('<[^>]+>', ' ', row).split())))
        pages.append(dict(page=page, url=url, report_links=len(links), listing_rows=len(report_rows),
                          entries_without_supported_report=unavailable,
                          sha256=hashlib.sha256(content).hexdigest()))
        urls.extend(links)
        page += 1
    return list(dict.fromkeys(urls)), pages


def read_report(job):
    source, url, cache_name, *options = job
    ocr_program = options[0] if options else None
    retry_failed = bool(options[1]) if len(options) > 1 else False
    cache = Path(cache_name)
    key = hashlib.sha256(url.encode()).hexdigest()
    pdf = cache / (key + ('.xlsx' if url.lower().endswith('.xlsx') else '.pdf'))
    parsed = cache / (key + '.parsed.json')
    result = dict(source=source, url=url)
    try:
        if parsed.exists() and pdf.exists():
            prior = json.loads(parsed.read_text())
            usable = prior.get('status') == 'ok' or (not retry_failed and (not ocr_program or prior.get('ocr_attempted')))
            if prior.get('parser_id') == PARSER_ID and usable:
                content = pdf.read_bytes()
                if hashlib.sha256(content).hexdigest() == prior.get('sha256'):
                    return prior
        if not pdf.exists() or pdf.stat().st_size < 100:
            for attempt in range(3):
                try:
                    content = fuel.fetch(url)
                    signature = b'PK' if url.lower().endswith('.xlsx') else b'%PDF'
                    if not content.startswith(signature):
                        raise ValueError('Download does not match report format')
                    temporary = pdf.with_suffix('.download')
                    temporary.write_bytes(content)
                    temporary.replace(pdf)
                    break
                except Exception:
                    if attempt == 2:
                        raise
                    time.sleep(attempt + 1)
        content = pdf.read_bytes()
        result.update(sha256=hashlib.sha256(content).hexdigest(), parser_id=PARSER_ID)
        try:
            row = fuel.parse_report(content, source, url)
        except (ValueError, IndexError):
            if source != 'gtcl' or not ocr_program:
                raise
            result['ocr_attempted'] = True
            from fuel_ocr import parse_scanned_gtcl
            row, proof = parse_scanned_gtcl(pdf, url, ocr_program, cache)
            result.update(proof)
        result.update(status='ok', row=row, sha256=row['sha256'], parser_id=PARSER_ID)
    except Exception as exc:
        result.update(status='failed', error_type=type(exc).__name__, error=str(exc))
    if 'sha256' in result:
        temporary = parsed.with_suffix('.tmp')
        temporary.write_text(json.dumps(result, ensure_ascii=False))
        temporary.replace(parsed)
    return result


def coverage(rows):
    if not rows:
        return dict(reports=0)
    dates = sorted(r['date'] for r in rows)
    span = (date.fromisoformat(dates[-1]) - date.fromisoformat(dates[0])).days + 1
    return dict(reports=len(dates), first=dates[0], last=dates[-1],
                calendar_days=span, missing_calendar_days=span-len(dates))


def backfill(seed, output, audit_path, cache, sources, page_size=1000, max_pages=0, workers=4, ocr_program=None, retry_failed=False):
    cache.mkdir(parents=True, exist_ok=True)
    bundle = json.loads(seed.read_text())
    audit = dict(checked_at=datetime.now(timezone.utc).isoformat(), sources={})
    for source in sources:
        source_audit = dict(status='failed', pages=[], rejected_reports=[], conflicts=[])
        audit['sources'][source] = source_audit
        try:
            urls, pages = archive_pages(source, cache, page_size, max_pages)
            if not urls:
                raise ValueError('No report links in archive')
            source_audit.update(pages=pages, distinct_report_links=len(urls))
            results = {}
            with ProcessPoolExecutor(max_workers=workers) as pool:
                futures = {pool.submit(read_report, (source, url, str(cache), str(ocr_program) if ocr_program else None, retry_failed)): url for url in urls}
                for n, future in enumerate(as_completed(futures), 1):
                    result = future.result()
                    results[result['url']] = result
                    if n % 25 == 0 or n == len(urls):
                        print(f'{source}: {n}/{len(urls)} reports examined', flush=True)
            # Archive order, rather than worker completion, determines identical duplicates.
            rows = [results[u]['row'] for u in urls if results[u]['status'] == 'ok']
            rejected = [results[u] for u in urls if results[u]['status'] != 'ok']
            key = 'gas' if source == 'petrobangla' else 'checks'
            bundle[key], conflicts = fuel.merge_reports(bundle[key], rows)
            bundle[key].sort(key=lambda r: r['date'])
            missing_power = [dict(date=r['date'], url=r['url']) for r in rows if r.get('power_supply') is None]
            source_audit.update(status='partial' if rejected or conflicts or missing_power else 'ok',
                                reports_without_power_totals=missing_power,
                                parsed_reports=len(rows), rejected_reports=rejected,
                                date_evidence_reports=[dict(date=r['date'], url=r['url'], evidence=r['date_evidence']) for r in rows if r.get('date_basis')],
                                ocr_reports=[dict(date=r['date'], url=r['url'], sha256=r['sha256'], proof=results[r['url']].get('production_components'), validation_difference=results[r['url']].get('validation_difference')) for r in rows if r.get('extraction_method') == 'ocr'],
                                conflicts=conflicts, coverage=coverage(bundle[key]))
        except Exception as exc:
            source_audit.update(error_type=type(exc).__name__, error=str(exc))
    bundle['history_backfill'] = dict(checked_at=audit['checked_at'], audit=str(audit_path),
                                     coverage={s: a.get('coverage') for s, a in audit['sources'].items()})
    # Preserve the daily collector's refresh timestamps and status: this is a separate operation.
    for path, content in [(audit_path, audit), (output, bundle)]:
        temporary = path.with_suffix(path.suffix + '.tmp')
        temporary.write_text(json.dumps(content, ensure_ascii=False, allow_nan=False, indent=2)+'\n')
        temporary.replace(path)
    return audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed', type=Path, default=Path('begd/fuel-data.json'))
    parser.add_argument('--output', type=Path, default=Path('begd/fuel-data.json'))
    parser.add_argument('--audit', type=Path, default=Path('fuel-backfill-audit.json'))
    parser.add_argument('--cache', type=Path, default=Path('.cache/fuel'))
    parser.add_argument('--sources', nargs='+', choices=['petrobangla', 'gtcl'], default=['petrobangla', 'gtcl'])
    parser.add_argument('--page-size', type=int, choices=[10, 20, 50, 100, 250, 500, 1000], default=1000)
    parser.add_argument('--max-pages', type=int, default=0, help='0 follows every advertised archive page')
    parser.add_argument('--retry-failed', action='store_true', help='Reparse prior failed records')
    parser.add_argument('--ocr-program', type=Path, help='Optional local Vision OCR helper for scanned GTCL archives')
    parser.add_argument('--workers', type=int, choices=range(1, 9), default=4)
    args = parser.parse_args()
    if args.max_pages < 0:
        parser.error('--max-pages must be nonnegative')
    audit = backfill(args.seed, args.output, args.audit, args.cache,
                     list(dict.fromkeys(args.sources)), args.page_size, args.max_pages, args.workers, args.ocr_program, args.retry_failed)
    print(json.dumps(audit, ensure_ascii=False, indent=2))
    if all(a['status'] == 'failed' for a in audit['sources'].values()):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
