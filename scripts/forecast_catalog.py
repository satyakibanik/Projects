"""Reviewed top-three ERP candidates and human-readable model composition."""
import csv
import json
from pathlib import Path

EVIDENCE = Path(__file__).resolve().parents[1] / 'research/erp-independent-forecasts'


def catalog():
    summary = json.loads((EVIDENCE/'summary.json').read_text())
    with (EVIDENCE/'scores.csv').open() as stream:
        scores = list(csv.DictReader(stream))
    rankings = {}
    for target in ('demand', 'generation'):
        ranked = sorted((r for r in scores if r['window']=='development' and r['target']==target),
                        key=lambda r:(float(r['mae_mw']),r['model']))[:3]
        rankings[target] = [dict(model=r['model'], rank=i+1, mae_mw=float(r['mae_mw'])) for i,r in enumerate(ranked)]
    info = summary['model_registry']
    fixed = ['Ridge enriched','Boosted weather MAE','CatBoost MAE','Extra Trees weather',
             'SVR weather','MLP weather','Daily PCA ridge']
    base = [name for name, model in info.items() if model['family']!='Ensembles']
    for name, model in info.items():
        if model['family']=='Ensembles':
            model['constituents'] = (base + ['Independent mean ensemble','Independent median ensemble',
                'Independent inverse-error blend','Independent convex stack','Independent ridge stack']
                if 'full-pool' in name else fixed)
    return dict(rankings=rankings, model_info=info, window=summary['windows']['development'],
                evaluated_models=summary['model_count'])


CATALOG = catalog()
TOP_MODELS = {target:[r['model'] for r in rows] for target,rows in CATALOG['rankings'].items()}
DEFAULT_MODELS = {target:names[0] for target,names in TOP_MODELS.items()}
