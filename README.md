# satyakibanik.github.io


## Bangladesh Electric Grid Dashboard

[Open the BEGD dashboard](https://satyakibanik.github.io/Projects/begd/)

BEGD is an interactive dashboard for Power Grid Bangladesh PLC and the National Load Dispatch Centre (NLDC) daily operating reports. It summarizes Bangladesh’s electricity demand, generation, fuel mix, load shedding, regional supply, cross-border imports, substation load and voltage, operations, and generation forecasts.

### Dashboard views

- **Overview** — hourly generation-side demand and generation, with day and evening generation-availability forecasts from the preceding report plotted at the selected day’s observed demand peaks; daily fuel mix; reported load shedding; evening-peak demand and generation; and published daily energy totals.
- **Power plants** — a Bangladesh-only plant-location map with fuel colors, nearby-unit grouping, and a sidebar showing the selected report's table values. The capacity/output table and map share search and status filters; marker cards link to plant details and hourly output.
- **Regions** — regional energy and fuel mix alongside evening-peak demand and load shedding.
- **Imports** — hourly MW and daily energy by cross-border route, with imports’ share of reported national energy.
- **Real time** — ERP demand, generation, and India-import readings dated today in Bangladesh time.
- **Substations** — daily maximum served load and its time, plus minimum and maximum voltage by voltage class.
- **Operations detail** — planned and forced shutdowns, the P1 event log, and hourly east–west interconnector power flows.
- **Forecast** — forecast and effective available generation for day and evening peaks, with unit-level details. These are forecasts of available generation, not demand or dispatched generation.
- **Comparisons** — optional adjacent-day and highest-generation comparisons and chart controls.

All times use Bangladesh time (Asia/Dhaka). Workbook publication date can differ from its operating date. The static Pages build contains supported reports from the latest two weeks and refreshes approximately hourly; GitHub may delay or drop scheduled runs. Real-time panels use only source rows dated today and do not backfill older readings. The data bundle is generated during deployment and is not committed to the repository.

### Reviewed plant locations

`begd/plant-locations.json` contains the reviewed location catalog, separate from changing operating reports. The map joins by normalized full plant name, displays only entries in the selected report, and rejects points outside the bundled Bangladesh polygon. Nearby markers group at the current zoom level without changing their underlying coordinates. Shared complexes and dual-fuel rows remain separate report entries in the sidebar. New names without reviewed coordinates are listed as unmapped.

To refresh the catalog after reviewing `Power Plant Coordinates/Power Plant Coordinate Matches.xlsx`, run `python scripts/import_plant_locations.py`. The importer resolves “use the candidate” to that row's OSM feature, reads explicit coordinate instructions, excludes non-plant rows, and rejects unresolved decisions or coordinates outside Bangladesh. The local workbook and raw downloads are not required on the deployed site.

Plant coordinates use OpenStreetMap contributors' data under ODbL plus user-supplied corrections. The country polygon is dissolved from geoBoundaries gbOpen Bangladesh ADM3, simplified for display under CC BY 4.0, with its source and attribution recorded in `begd/bangladesh-boundary.geojson`. The map uses local SVG geometry rather than external map tiles.

### Data sources

BEGD’s daily views are parsed from Power Grid Bangladesh PLC / NLDC workbooks in the [Power Grid ERP daily report archive](https://erp.powergrid.gov.bd/w/report/eyJpdiI6IldsU2ZQTGkvbkRnQU9FMjZ5UHhmeGc9PSIsInZhbHVlIjoiQzhONVl5ZGxRY3E3T3ZVNCtLZGt1Zz09IiwibWFjIjoiN2JiNTI5MzNhOWIxZDVjY2NkMmFlZWU4ZDU1N2I4OWZlYjNlZWM1ZGU4NzRiNWU4ZjQ3ZDc1ODRlMTk3MDc0YyIsInRhZyI6IiJ9/show_report). The parser reads P1 (national summary, fuel mix, regions, shutdowns, and event log), P2 (plant records), P3 (substation load), P4 (hourly demand, generation, and load shedding), GenLog (imports), Voltage (substation voltage), EWIC (east–west flows), and Forecast (day and evening generation availability).

Real-time readings and the highest-generation comparison use these Power Grid ERP pages:

- [Demand, supply, and load shedding](https://erp.powergrid.gov.bd/web/generations/view_demand_supply_loadshed)
- [Generation by source](https://erp.powergrid.gov.bd/w/generations/view_generations)
- [India imports](https://erp.powergrid.gov.bd/w/generations/imported_power_india)
- [Maximum generation](https://erp.powergrid.gov.bd/w/maximum_generations/show_maximum_generations)

### License

The project’s original code is licensed under the GNU General Public License v3.0; see [LICENSE.md](LICENSE.md). This license applies to the project code, not to third-party source data or materials, which remain subject to their publishers’ terms.

### Data attribution and disclaimer

The dashboard’s daily reports and real-time readings are sourced from Power Grid Bangladesh PLC and its National Load Dispatch Centre (NLDC), through the linked ERP workbooks and pages above. This is an independent, unofficial project and is not affiliated with or endorsed by Power Grid Bangladesh PLC. Source data remains attributable to its publisher; dashboard values may be reformatted or calculated from those reports.

The data and visualizations are provided for informational purposes only. Source records may be delayed, incomplete, revised, or affected by parsing errors, and derived figures may differ from the publisher’s definitions. Verify important information against the linked source records. Do not use this dashboard for grid operation, dispatch, safety, or other decisions that require authoritative data.

### Reading the figures

- Generation totals include imports.
- Power readings are in MW; daily energy totals are in MWh or GWh. Hourly MW samples are not added up to calculate daily MWh.
- Generation-side demand, substation-side demand, and reported load shedding are distinct measures.
- Regional figures are evening-peak snapshots rather than full-day demand.
- Substation load times, voltage ranges, unit shutdown lists, events, and generation forecasts are reported workbook values.
- Zero plant output alone does not establish an outage.

### Publishing

The dashboard lives in the `begd/` folder of this repository. The GitHub Actions workflow builds a static data bundle from the ERP archive and deploys the project at the link above. If the link is not available yet, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions** and run the Pages workflow.


## Automated checks

The **Tests** GitHub Actions workflow runs on every push and pull request, and
can also be started manually from the Actions tab. It checks the committed
checkout with Python 3.12 and 3.13 and Node.js 22. Tests use generated workbooks
and mocked ERP responses, so they need no credentials or live ERP connection.

Run the same checks locally from the repository root:

```sh
python -m pip install -r requirements.txt
python -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/*.test.cjs
```

Python tests cover workbook units and reconciliation, archive parsing, URL
validation, current readings, caching, and static bundle generation/fallbacks.
Browser tests cover static API routes and errors, date navigation, fetch
passthrough, script syntax, and local HTML asset references. These checks do
not replace visual browser testing or a live ERP integration check.
