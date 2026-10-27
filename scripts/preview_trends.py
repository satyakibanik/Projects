#!/usr/bin/env python3
"""Build a local static preview using published workbook snapshots, without deploying."""
import argparse
import concurrent.futures
import datetime as dt
import json
import pathlib
import shutil
import subprocess
from trends import daily_summary, extract_trend_workbook

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = 'https://satyakibanik.github.io/Projects/begd/'


def read_url(path):
    # System curl uses the OS certificate store on macOS as well as Linux.
    return subprocess.run(['curl', '--fail', '--silent', '--show-error',
                           '--location', '--retry', '2', '--max-time', '45',
                           BASE + path], check=True, capture_output=True, text=True).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='.cache/trends-preview')
    parser.add_argument('--offline', action='store_true', help='Reuse the existing local bundle and daily summary cache')
    parser.add_argument('--recover-missing', action='store_true', help='Recover isolated parser omissions from original national workbooks')
    args = parser.parse_args()
    output = ROOT / args.output
    (output / 'begd').mkdir(parents=True, exist_ok=True)
    shutil.copytree(ROOT / 'begd', output / 'begd', dirs_exist_ok=True)
    shutil.copy2(ROOT / 'index.html', output / 'index.html')
    shutil.copy2(ROOT / 'sitemap.xml', output / 'sitemap.xml')
    text = (output / 'begd' / 'live-data.js').read_text() if args.offline else read_url('live-data.js')
    prefix = 'window.BEGD_STATIC_DATA='
    if not text.startswith(prefix):
        raise ValueError('Unexpected published bundle')
    bundle = json.loads(text[len(prefix):].strip().removesuffix(';'))
    (output / 'begd' / 'current-day.json').write_text(json.dumps(bundle.get('current_day'), separators=(',', ':')))
    end = max(bundle['reports_by_operating_date'])
    start = (dt.date.fromisoformat(end) - dt.timedelta(days=364)).isoformat()
    wanted = {report_id for day, report_id in bundle['reports_by_operating_date'].items() if start <= day <= end}
    cache = ROOT / '.cache' / 'trends-preview-summaries.json'
    summaries = json.loads(cache.read_text()) if cache.exists() else {}
    local = bundle['reports_by_id']

    def get(report_id):
        if report_id in local:
            return report_id, daily_summary(local[report_id])
        if report_id in summaries and 'water_level' in summaries[report_id] and ('temperature_c' in summaries[report_id] or args.offline):
            row = summaries[report_id]
            if row.get('demand_mwh') is not None:
                row.setdefault('demand_basis', 'En-Curve published requirement')
            elif row.get('generation_mwh') is not None and row.get('unserved_mwh') is not None:
                row['demand_mwh'] = round(row['generation_mwh'] + row['unserved_mwh'], 6)
                row['demand_basis'] = 'P1 generation + reported energy not served'
            return report_id, row
        report = json.loads(read_url(f'archive/{report_id}.json'))
        return report_id, daily_summary(report)

    failed = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        tasks = {pool.submit(get, report_id): report_id for report_id in wanted}
        for i, future in enumerate(concurrent.futures.as_completed(tasks), 1):
            try:
                report_id, summary = future.result()
                summaries[report_id] = summary
            except Exception as error:
                failed.append(tasks[future])
                print(f'Missing report {tasks[future]}: {error}', flush=True)
            if i % 50 == 0:
                print(f'Prepared {i}/{len(wanted)} daily summaries', flush=True)
    cache.write_text(json.dumps(summaries, separators=(',', ':')))
    days = [summaries[report_id] for day, report_id in sorted(bundle['reports_by_operating_date'].items())
            if start <= day <= end and report_id in summaries]
    if args.recover_missing:
        reported = {row['date'] for row in days}
        by_publication = {row['published_date']:row for row in bundle['reports']}
        raw_dir = ROOT / '.cache' / 'trends-workbooks'
        raw_dir.mkdir(parents=True, exist_ok=True)
        for offset in range(365):
            date = dt.date.fromisoformat(end) - dt.timedelta(days=offset)
            if date.isoformat() in reported:
                continue
            before = by_publication.get(date.isoformat())
            after = by_publication.get((date+dt.timedelta(days=2)).isoformat())
            if not before or not after or int(after['id'])-int(before['id']) != 2:
                continue
            candidate = str(int(before['id'])+1)
            path = raw_dir / f'{candidate}.xlsx'
            if not path.exists():
                subprocess.run(['curl','--fail','--silent','--show-error','--location','--max-time','45',
                                'https://erp.powergrid.gov.bd/web/files/download?location=erp%2Fweb%2Freport_docs%2F'+candidate+'.xlsx',
                                '--output',str(path)], check=True)
            item = {'id':candidate,'published_date':(date+dt.timedelta(days=1)).isoformat(),
                    'download_url':'https://erp.powergrid.gov.bd/web/files/download?location=erp%2Fweb%2Freport_docs%2F'+candidate+'.xlsx'}
            recovered = extract_trend_workbook(path.read_bytes(),item)
            if recovered['date'] != date.isoformat():
                raise ValueError(f'Recovery workbook {candidate} does not match {date}')
    # Locally downloaded failed workbooks can still supply national trends.
    for path in sorted((ROOT / '.cache' / 'trends-workbooks').glob('*.xlsx')):
        # Publication dates below are checked against the workbook operating date.
        import openpyxl
        raw = openpyxl.load_workbook(path, data_only=True)['P1']['D6'].value
        day = raw.date() if isinstance(raw, dt.datetime) else raw if isinstance(raw, dt.date) else dt.datetime.strptime(str(raw).strip(), '%d-%m-%Y').date()
        item = {'id':path.stem, 'published_date':(day + dt.timedelta(days=1)).isoformat(),
                'download_url':f'https://erp.powergrid.gov.bd/web/files/download?location=erp%2Fweb%2Freport_docs%2F{path.stem}.xlsx'}
        if not start <= day.isoformat() <= end or any(row['date'] == day.isoformat() for row in days):
            continue
        report = extract_trend_workbook(path.read_bytes(), item)
        days.append(daily_summary(report))
    days.sort(key=lambda row:row['date'])
    trends = {'generated_at': bundle['generated_at'], 'end_date': end, 'days': days}
    (output / 'begd' / 'trends-data.json').write_text(json.dumps(trends, separators=(',', ':')))
    (output / 'begd' / 'live-data.js').write_text(text)
    index = (output / 'begd' / 'index.html').read_text().replace(
        '<script src="app.js?v=', '<script src="live-data.js"></script><script src="static-api.js"></script><script src="app.js?v=', 1)
    (output / 'begd' / 'index.html').write_text(index)
    print(f'Preview: {output}; {len(days)} reports; {len(failed)} fetch failures. No deployment performed.')


if __name__ == '__main__':
    main()
