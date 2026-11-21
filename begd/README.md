# BEGD developer guide

This directory contains the Bangladesh Electric Grid Dashboard frontend. The [repository README](../README.md) covers the dashboard tabs, data sources, update schedule, license, and citation.

## Run locally

From the repository root, install the parser dependencies and start the local ERP-backed server.

```sh
python -m pip install -r requirements.txt
python scripts/server.py --port 8081
```

Open [the local dashboard](http://127.0.0.1:8081/begd/). For a static preview that uses the same data packaging as GitHub Pages, build the artifact and serve it locally. The build fetches upstream data and may need network access. Use the dependencies specified by the workflow in your checkout.

```sh
python scripts/build_pages_data.py --output-dir _site
python -m http.server 8080 --bind 127.0.0.1 --directory _site
```

Open [the static dashboard](http://127.0.0.1:8080/begd/). GitHub Pages publishes the generated artifact through the [Pages workflow](../.github/workflows/pages.yml), which also defines the polling schedule. See the [root README](../README.md#development) for local test commands.

## Published data

- `live-data.js` contains recent reports and archive metadata. The date picker loads older supported workbooks on demand from `archive/`.
- `current-day.json` serves the latest published ERP snapshot on GitHub Pages. Browser polling picks up snapshots after deployment.
- `trends-data.json` contains compact workbook aggregates. The historical BengalGrid panels use the separately bundled `bengalgrid-trends.json`. On the published site, plant and station histories load one entity at a time from `entity-history/`.

## Calculation conventions

- **Real time.** ERP substation demand, supply, and reported load shedding come from the same table. Total generation comes from the separate generation-by-source table and includes imports. Forecast comparisons use the corresponding measurement basis, with substation-side actuals for BEGD demand and generation-side actuals for the Power Grid demand scenario.
- **Daily energy.** P1 supplies published energy totals. Trends uses the matching-date En-Curve energy requirement where available and falls back to P1 generation plus reported energy not served. The MW display for daily energy is the 24-hour mean. Daily peak reported load shedding comes from P4 in MW, while P1 energy not served is in GWh.
- **Trend coverage.** The archive selects one report per operating day, preferring next-day publication. Partial workbook recovery can supply national totals with quality flags. Missing values appear as gaps. Fuel shares retain the full reported denominator when chart layers are hidden.
- **Substations and weather.** Voltage in per unit is reported kV divided by the station’s nominal voltage class. Trends uses the daily maximum temperature from P1 cell K11.
- **Historical generation.** BengalGrid v2 daily means and monthly medians are calculated from retained source observations. The derived bundle records excluded observations and source coverage. Rebuild it with `python scripts/build_bengalgrid_trends.py /path/to/BengalGrid_data.csv`.

The dashboard’s **How calculated** dialogs show source worksheets, units, formulas, and report links where available. All operating dates use Asia/Dhaka.

## Focused previews

- **Trends.** Run `python scripts/preview_trends.py` and serve `.cache/trends-preview` to inspect published workbook snapshots. Use `--offline` after the first build to reuse the cached data. Use `--recover-missing` to check for recoverable national totals in original workbooks.
- **Forecast experiments.** In checkouts with `scripts/preview_forecasts.py`, the exporter requires an existing local ERP snapshot and saved model outputs from the sibling `Forecast_sb` project. The live forecast pipeline has its own [forecast research notes](https://github.com/satyakibanik/Projects/tree/main/research/erp-independent-forecasts).
