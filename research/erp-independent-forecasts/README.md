# ERP independent demand and generation forecasts

Local review evidence for PR #51. Targets are ERP substation-side demand and ERP generation including imports. Workbook generation-side demand is not a label or benchmark.

The study fitted 19 base models and 8 ensembles per target across 82 historical origins. It also generated an unscored forward preview for 2026-10-23.

ERP historical issue/revision timestamps are unavailable; availability on D+1 is assumed for retrospective evaluation.
Retrospective development evidence on current ERP snapshots; neither window is a fresh prospective or vintage-verified holdout.

## Models selected before each evaluation window

| Window | Target | Selected model | Evaluation MAE MW | RMSE MW | WAPE | Improvement vs weekly |
|---|---|---|---:|---:|---:|---:|
| confirmation | demand | Daily MLP | 673.1 | 819.2 | 4.37% | 29.4% |
| confirmation | generation | Independent full-pool convex | 293.6 | 359.8 | 2.07% | 52.7% |
| development | demand | Spline weather | 653.2 | 850.9 | 4.50% | 42.1% |
| development | generation | Spline weather | 592.9 | 792.1 | 4.13% | 21.6% |

Each champion minimizes MAE on 14 earlier selection dates. A one-day embargo ensures selection labels are available by the first evaluation cutoff. Ensembles calibrate on at most 28 earlier out-of-sample origins whose labels are available by D-1.

The current-day local preview uses the development-window selected model for each target. These are candidates for review, not an automatically promoted production replacement. The scheduled publisher retains its prior fixed seven-member ensembles with the corrected ERP target basis.

## Subsequent evaluation rankings

These rankings describe observed evaluation performance. They do not select or retune each window champion. Both windows are retrospective development evidence on newly captured ERP series.

### confirmation · demand

| Model | MAE MW | RMSE MW | WAPE |
|---|---:|---:|---:|
| Huber weather | 497.3 | 646.1 | 3.23% |
| Independent convex stack | 512.6 | 656.7 | 3.33% |
| Independent full-pool top3 | 514.3 | 665.8 | 3.34% |
| Extra Trees weather | 526.2 | 671.8 | 3.42% |
| Independent inverse-error blend | 528.6 | 681.6 | 3.43% |

### confirmation · generation

| Model | MAE MW | RMSE MW | WAPE |
|---|---:|---:|---:|
| Spline weather | 281.6 | 359.8 | 1.98% |
| CatBoost MAE | 281.6 | 370.1 | 1.98% |
| Independent full-pool convex | 293.6 | 359.8 | 2.07% |
| Independent median ensemble | 296.3 | 373.7 | 2.09% |
| Independent inverse-error blend | 298.5 | 377.9 | 2.10% |

### development · demand

| Model | MAE MW | RMSE MW | WAPE |
|---|---:|---:|---:|
| Independent full-pool convex | 546.7 | 764.4 | 3.77% |
| Independent mean ensemble | 563.5 | 722.2 | 3.88% |
| Independent convex stack | 577.3 | 765.2 | 3.98% |
| Independent inverse-error blend | 578.1 | 759.2 | 3.98% |
| Independent full-pool top3 | 590.3 | 796.7 | 4.07% |

### development · generation

| Model | MAE MW | RMSE MW | WAPE |
|---|---:|---:|---:|
| Independent median ensemble | 503.8 | 685.6 | 3.51% |
| Independent inverse-error blend | 506.1 | 694.9 | 3.53% |
| Independent mean ensemble | 506.3 | 696.4 | 3.53% |
| Independent full-pool top3 | 506.6 | 698.1 | 3.53% |
| MLP weather | 513.8 | 671.6 | 3.58% |

## Reproduce

Install `requirements-forecast.txt`. Capture the public ERP targets and lagged workbook metadata, then run the study. Cached raw ERP HTML and retrieval hashes remain under `.cache/erp-study/erp-history/`; original source observations are never edited. The weather source is the Open-Meteo GFS previous-runs API at nominal 48-hour lead, for Dhaka, Chattogram, Rajshahi and Khulna. Observed/reanalysis target-day weather is excluded.

```sh
python scripts/prepare_independent_study.py --start 2026-05-25 --end 2026-10-21 --forecast-date 2026-10-23
python scripts/independent_study.py --records .cache/erp-study/records.json --weather .cache/erp-study/weather.json --output .cache/erp-study/results --forecast-date 2026-10-23
python scripts/preview_independent_study.py --output /absolute/path/to/local-preview/begd
```

The preview command requires an existing ERP `live-data.js` snapshot. It shows 27 candidates per target, operating-day controls, both evaluation windows and an independent group labeled **BEGD generated forecasts**. Current-day forecasts retain their actual completion time; forecasts generated after midnight are identified accordingly. Future actuals remain absent. No merge or deployment is performed.

The study caches full per-origin predictions and ensemble-weight audits locally. Compact scores, publication-cutoff audits, fit warnings, runtime versions and source hashes are retained here. Re-fetching current ERP tables may yield revisions; compare raw hashes before claiming identical reproduction.
