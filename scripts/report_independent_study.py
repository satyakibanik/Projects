#!/usr/bin/env python3
"""Publish compact study evidence inside the repository without fitting models."""
import argparse
import csv
import json
from pathlib import Path
import platform
import shutil


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--study',type=Path,required=True)
    parser.add_argument('--provenance',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=Path('research/erp-independent-forecasts'))
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    summary=json.loads((args.study/'summary.json').read_text())
    with (args.study/'scores.csv').open() as stream:scores=list(csv.DictReader(stream))
    provenance=json.loads(args.provenance.read_text())
    manifests={kind:dict(source=provenance[kind]['source'],availability=provenance[kind].get('availability'),
        captures=[{k:r[k] for k in ('url','retrieved_at','sha256')} for r in provenance[kind]['captures']]) for kind in ('demand','generation')}
    for name in ('protocol.json','summary.json','scores.csv','cutoff_audit.csv','fit_diagnostics.json'):
        if name.endswith('.csv'):
            (args.output/name).write_text((args.study/name).read_text())
        else:
            shutil.copy2(args.study/name,args.output/name)
    (args.output/'source-manifests.json').write_text(json.dumps(manifests,indent=2)+'\n')
    import numpy,scipy,sklearn,catboost
    runtime=dict(python=platform.python_version(),numpy=numpy.__version__,scipy=scipy.__version__,
                 sklearn=sklearn.__version__,catboost=catboost.__version__)
    (args.output/'runtime.json').write_text(json.dumps(runtime,indent=2)+'\n')
    lines=['# ERP independent demand and generation forecasts','',
        'Local review evidence for PR #51. Targets are ERP substation-side demand and ERP generation including imports. Workbook generation-side demand is not a label or benchmark.',
        '',f"The study fitted {summary['base_models']} base models and {summary['ensembles']} ensembles per target across {summary['origin_days']} historical origins. It also generated an unscored forward preview for {', '.join(summary['forecast_dates']) or 'no extra date'}.",
        '',summary['availability'],summary['interpretation'],'',
        '## Models selected before each evaluation window','',
        '| Window | Target | Selected model | Evaluation MAE MW | RMSE MW | WAPE | Improvement vs weekly |',
        '|---|---|---|---:|---:|---:|---:|']
    for c in summary['champions']:
        lines.append(f"| {c['window']} | {c['target']} | {c['model']} | {c['mae_mw']:.1f} | {c['rmse_mw']:.1f} | {c['wape_pct']:.2f}% | {c['improvement_vs_weekly_pct']:.1f}% |")
    lines+=['','Each champion minimizes MAE on 14 earlier selection dates. A one-day embargo ensures selection labels are available by the first evaluation cutoff. Ensembles calibrate on at most 28 earlier out-of-sample origins whose labels are available by D-1.','',
        'The finalized realtime forecast panel offers the development evaluation top three per target and defaults to rank 1. These are retrospective choices after evaluation, distinct from each earlier-selected champion above. The publisher now uses the same 19 base implementations and chronological ensembles to produce all six candidate curves, cached under erp-independent-top3-v3. A published daily forecast remains immutable. The first panel shows only substation demand, supply and reported shedding; the second forecast panel is collapsed until opened.','',
        '## Subsequent evaluation rankings','',
        'These rankings describe observed evaluation performance. They do not select or retune each window champion. Both windows are retrospective development evidence on newly captured ERP series.']
    for window in ('confirmation','development'):
        for target in ('demand','generation'):
            ranked=sorted([r for r in scores if r['window']==window and r['target']==target],key=lambda r:float(r['mae_mw']))[:5]
            lines+=['',f'### {window} · {target}','','| Model | MAE MW | RMSE MW | WAPE |','|---|---:|---:|---:|']
            for r in ranked:lines.append(f"| {r['model']} | {float(r['mae_mw']):.1f} | {float(r['rmse_mw']):.1f} | {float(r['wape_pct']):.2f}% |")
    lines+=['','## Reproduce','',
        'Install `requirements-forecast.txt`. Capture the public ERP targets and lagged workbook metadata, then run the study. Cached raw ERP HTML and retrieval hashes remain under `.cache/erp-study/erp-history/`; original source observations are never edited. The weather source is the Open-Meteo GFS previous-runs API at nominal 48-hour lead, for Dhaka, Chattogram, Rajshahi and Khulna. Observed/reanalysis target-day weather is excluded.','',
        '```sh','python scripts/prepare_independent_study.py --start 2026-05-25 --end 2026-10-21 --forecast-date 2026-10-23',
        'python scripts/independent_study.py --records .cache/erp-study/records.json --weather .cache/erp-study/weather.json --output .cache/erp-study/results --forecast-date 2026-10-23',
        'python scripts/preview_independent_study.py --output /absolute/path/to/local-preview/begd','```','',
        'The preview command requires an existing ERP `live-data.js` snapshot and uses the finalized **BEGD generated forecasts** panel: three ranked choices per target, operating-date selection with left/right arrows, and descriptions with constituent lists. The complete 27-candidate rankings remain in this evidence directory. Matching PGCB demand and generation scenarios are display-only references, keyed by the explicitly printed scenario date. The exporter reads cached study records and static report snapshots; `--pgcb-records` can supply separate records with `forecast_date` and `pgcb_scenario`. No date is inferred from a workbook operating date or plant-availability header. PGCB demand remains generation-side and is not scored against substation demand. Demand curves share orange shades and generation curves share blue shades, with distinct marker shapes. Current-day forecasts retain their actual completion time; forecasts generated after midnight are identified accordingly. Future actuals remain absent. No merge or deployment is performed.','',
        'The study caches full per-origin predictions and ensemble-weight audits locally. Compact scores, publication-cutoff audits, fit warnings, runtime versions and source hashes are retained here. Re-fetching current ERP tables may yield revisions; compare raw hashes before claiming identical reproduction.']
    (args.output/'README.md').write_text('\n'.join(lines)+'\n')


if __name__=='__main__':main()
