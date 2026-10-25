#!/usr/bin/env python3
"""Preview entity histories from published JSON snapshots; no training or deployment."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import datetime as dt
import json
import pathlib
import shutil
import subprocess

from entity_history import write_entity_history

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = 'https://satyakibanik.github.io/Projects/begd/'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--output', default='.cache/entity-history-preview')
    args = parser.parse_args()
    cache = ROOT / '.cache' / 'entity-history-input'
    cache.mkdir(parents=True, exist_ok=True)

    def download(name, refresh=False):
        path = cache / name
        if args.offline or (path.exists() and not refresh):
            return path.read_text()
        value = subprocess.run(['/usr/bin/curl', '--fail', '--silent', '--show-error', '--location',
                                '--retry', '2', '--max-time', '45', BASE + name],
                               check=True, capture_output=True, text=True).stdout
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
        return value

    live = download('live-data.js', refresh=True)
    prefix = 'window.BEGD_STATIC_DATA='
    if not live.startswith(prefix):
        raise ValueError('Unexpected published data bundle')
    bundle = json.loads(live[len(prefix):].strip().removesuffix(';'))
    trends = json.loads(download('trends-data.json', refresh=True))
    end = trends['end_date']
    start = (dt.date.fromisoformat(end) - dt.timedelta(days=364)).isoformat()
    wanted = {report_id for date, report_id in bundle['reports_by_operating_date'].items() if start <= date <= end}
    reports = dict(bundle['reports_by_id'])
    failures = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        tasks = {pool.submit(download, f'archive/{report_id}.json'): report_id for report_id in wanted if report_id not in reports}
        for i, task in enumerate(as_completed(tasks), 1):
            report_id = tasks[task]
            try:
                reports[report_id] = json.loads(task.result())
            except Exception as error:
                failures.append(report_id)
                print(f'Report {report_id} unavailable: {error}', flush=True)
            if i % 50 == 0:
                print(f'Loaded {i}/{len(tasks)} archived reports', flush=True)
    if failures:
        raise RuntimeError(f'{len(failures)} archive downloads failed; retry to complete the cache')
    output = ROOT / args.output
    target = output / 'begd'
    shutil.copytree(ROOT / 'begd', target, dirs_exist_ok=True)
    shutil.copy2(ROOT / 'index.html', output / 'index.html')
    shutil.copy2(ROOT / 'sitemap.xml', output / 'sitemap.xml')
    # National-only recovery days remain available in the national charts; they
    # cannot manufacture missing plant or station readings.
    index = write_entity_history(reports.values(), target / 'entity-history', bundle['generated_at'], end)
    (target / 'live-data.js').write_text(live)
    (target / 'trends-data.json').write_text(json.dumps(trends, separators=(',', ':')))
    (target / 'current-day.json').write_text(json.dumps(bundle['current_day'], separators=(',', ':')))
    archive = target / 'archive'
    archive.mkdir(exist_ok=True)
    for report_id, report in reports.items():
        (archive / f'{report_id}.json').write_text(json.dumps(report, separators=(',', ':')))
    html = (target / 'index.html').read_text().replace('<script src="app.js?v=',
        '<script src="live-data.js"></script><script src="static-api.js"></script><script src="app.js?v=', 1)
    (target / 'index.html').write_text(html)
    print(f'Local preview: {output}\n{len(index["plants"])} plants, {len(index["substations"])} station/class records; '
          f'{len(index["sources"])} full daily reports through {end}. No deployment performed.', flush=True)


if __name__ == '__main__':
    main()
