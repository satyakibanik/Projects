# satyakibanik.github.io


## Bangladesh Electric Grid Dashboard

[Open the BEGD dashboard](https://satyakibanik.github.io/Projects/begd/)

BEGD is an interactive dashboard for Power Grid Bangladesh PLC and the National Load Dispatch Centre (NLDC) daily operating reports. It summarizes Bangladesh’s electricity demand, generation, fuel mix, load shedding, regional supply, cross-border imports, substation load and voltage, operations, and generation forecasts.

### Dashboard views

- **Overview** — hourly generation-side demand and generation, with day and evening generation-availability forecasts from the preceding report plotted at the selected day’s observed demand peaks; daily fuel mix; reported load shedding; evening-peak demand and generation; and published daily energy totals.
- **Power plants** — a Bangladesh-only plant-location map with neutral district and division boundaries, fuel-colored markers, nearby-unit grouping, and a sidebar showing the selected report's table values. The capacity/output table and map share search and status filters; marker cards link to plant details, hourly output, and the matched OpenStreetMap feature when available.
- **Regions** — regional energy and fuel mix alongside evening-peak demand and load shedding.
- **Imports** — hourly MW and daily energy by cross-border route, with imports’ share of reported national energy.
- **Real time** — substation-side demand, supply, and reported load shedding, with export controls in the chart header. Expand BEGD generated forecasts for separate demand and ERP generation subplots, each with its own top-three model selector and matching operating-day PGCB scenario. ERP fuel and India-import readings follow. All dates use Bangladesh time.
- **Substations** — daily maximum served load and its time, plus minimum and maximum voltage by voltage class. Per-unit voltage bands and box-and-whisker distributions compare 400, 230 and 132 kV readings, with station search, class toggles and keyboard-accessible station details.
- **News (TEST)** — English and Bangla publisher RSS coverage collected on every site build, with search, publisher/language/story filters, and 20 articles per page.
- **Operations detail** — planned and forced shutdowns, the P1 event log, and hourly east–west interconnector power flows.
- **Forecast** — forecast and effective available generation for day and evening peaks, with unit-level details. These are forecasts of available generation, not demand or dispatched generation.
- **Comparisons** — optional adjacent-day and highest-generation comparisons and chart controls.

All times use Bangladesh time (Asia/Dhaka). Workbook publication date can differ from its operating date. The static Pages build contains supported reports from the latest two weeks and refreshes approximately hourly; GitHub may delay or drop scheduled runs. Real-time panels use only source rows dated today and do not backfill older readings. The data bundle is generated during deployment and is not committed to the repository.

Substation voltage plots use the selected report's **Voltage** sheet, including voltage-only records without P3 load. Per-unit values divide readings by their own nominal class. Band stations are ranked independently within each class by daily voltage midpoint; the x-axis represents station rank, not time or the same station across classes. Box plots show the median and middle 50% with full observed-range whiskers; their statistics table lists minimum, quartiles and maximum. Dashed nominal references are not operating limits. Invalid, missing, nonpositive or reversed extrema are omitted and counted. Optional comparison reports remain in the table; voltage plots show the selected report only.

### Reviewed plant locations

`begd/plant-locations.json` contains the reviewed location catalog, separate from changing operating reports. The map joins by normalized full plant name, displays only entries in the selected report, and rejects points outside the bundled Bangladesh polygon. Nearby markers group at the current zoom level without changing their underlying coordinates. Shared complexes and dual-fuel rows remain separate report entries in the sidebar. New names without reviewed coordinates are listed as unmapped.

To refresh the catalog after reviewing `Power Plant Coordinates/Power Plant Coordinate Matches.xlsx`, run `python scripts/import_plant_locations.py`. The importer resolves “use the candidate” to that row's OSM feature, reads explicit coordinate instructions, excludes non-plant rows, and rejects unresolved decisions or coordinates outside Bangladesh. The local workbook and raw downloads are not required on the deployed site.

Plant coordinates use OpenStreetMap contributors' data under ODbL plus user-supplied corrections. The country polygon is dissolved from geoBoundaries gbOpen Bangladesh ADM3, simplified for display under CC BY 4.0, with its source and attribution recorded in `begd/bangladesh-boundary.geojson`. The map uses local SVG geometry rather than external map tiles.

### Data sources

- **Power plant coordinates:** curated using [OpenInfraMap](https://openinframap.org/) and OpenStreetMap queries downloaded through [Overpass Turbo](https://overpass-turbo.eu/), then matched to dashboard plant names and manually reviewed. OpenStreetMap data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), under ODbL. User-supplied coordinate corrections supplement these matches. Sidebar OSM links identify matched features; manually located plants without a matched feature have no OSM link.
- **Geographic GeoJSON and administrative hierarchy:** [ifahimreza/bangladesh-geojson](https://github.com/ifahimreza/bangladesh-geojson). The bundled country polygon uses its geoBoundaries-derived upazila geometry. Complete district boundaries additionally use [geoBoundaries gbOpen Bangladesh ADM2](https://www.geoboundaries.org/api/current/gbOpen/BGD/ADM2/), representing 2020; divisions are dissolved from those 64 districts using the repository's district-to-division hierarchy. `begd/plant-administrative-boundaries.geojson` contains 64 district and eight division outlines, rendered without individual fills and clipped to the country fence. GeoBoundaries distribution: CC BY 4.0; underlying district data: Bangladesh Bureau of Statistics / OCHA ROAP, CC BY 3.0 IGO. Source URLs and attribution are recorded in the geometry assets.

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

## BPDB daily costs (draft demo)

The 30/60/90/365-day Trends views include reported daily costs in BDT crore (exact BDT in tooltips), with optional category lines. Energy Curve includes a cost pie and exact-BDT table only when a validated BPDB report matches the selected **printed operating date**. No older date is substituted when the PDF has not arrived.

`scripts/bpdb_costs.py` discovers Page 1 links from the [BPDB archive](https://misc.bpdb.gov.bd/daily-generation-archive), extracts text with pdfplumber, and recognizes `Cost of the Consumed Fuel`, `Fuel cost`, and `Production Cost (Tk.)`. It validates the printed date, non-missing categories, their sum against the printed total, and production cost per kWh against energy when both are present. Source labels, category scope, URLs, archive dates, SHA-256 hashes, and fetch timestamps are retained. Oil/Renewable categories are not split into inferred sources, and production totals are not treated as full operating expenses.

The linked October 26 archive PDF prints **2026-10-25**, BDT **2,490,660,278**, and **7.45341 BDT/kWh**. The original PDF is a regression fixture at `tests/fixtures/bpdb/page_1_20261026.pdf`; source: <https://misc.bpdb.gov.bd/storage/daily_archive/page_1_20261026_20261027094839.pdf>.

The Pages build refreshes BPDB costs at most every six hours, restores validated history from a separate Actions cache, and rechecks the latest 14 archive days for revisions. A failed refresh retains validated data; missing/rejected dates stay gaps. Cold starts scan up to 40 archive pages with four PDF workers, reusing older validated records from the checked-in snapshot when no Actions cache exists. Overprinted PDF characters are deduplicated before extraction. A checked-in snapshot supplies the local demo; Pages overwrites it with the collected bundle. No changes are deployed until this branch is merged or explicitly deployed.

```sh
python scripts/bpdb_costs.py
python scripts/preview_costs.py
python -m http.server --directory .cache/cost-preview 8087
# Open http://localhost:8087/begd/?date=2026-10-24#en-curve
# Or http://localhost:8087/begd/#trends
```

Cost chart controls: a common **Individual fuel types** checkbox selects/deselects all available fuel layers (the reported total stays separate), including a partial-selection state. **Linear trendline**, beneath the BDT tag, fits least squares against calendar dates using reported observations only; it appears only with one selected layer and is not a forecast. The setting is retained in shared view URLs.

Energy Curve cost slices provide pointer, touch, and keyboard tooltips matching the table. The table reuses Power plants fuel icons, sorts every column, and starts with descending cost share. Category BDT/kWh is calculated from the same PDF’s cost and matching national fuel-energy totals; these energy totals round to 0.01 MKWh. No cross-day or workbook denominator is substituted, and missing/zero energy stays blank.

### Automatic news collection

Every production build calls `scripts/grid_news.py` through `write_news_bundle` in `scripts/build_pages_data.py`. The Pages workflow is scheduled every 15 minutes; collection has no additional cooldown. Open news tabs check for a newer published catalog every three minutes.

Seven public feeds cover The Business Standard (top news and economy), The Daily Star, Prothom Alo English and Bangla, Bangla Tribune, and Jagonews24. Feed URLs are configured in `FEEDS`. Only matching power-sector headlines/excerpts from the configured publisher domains are retained. The catalog keeps 90 calendar days and canonicalizes URLs to remove tracking duplicates. Publisher RSS timestamps supply posting times; missing timestamps are not guessed. RSS excerpts are short and link to the original articles; no article body is scraped.

The Actions cache stores `.cache/grid-news/catalog.json`; if it is missing, the collector recovers the last published catalog, then falls back to the checked-in curated archive. Existing curated entries take precedence. A failed feed does not erase previous articles, and partial/failed collection status is shown in the News tab. Collection is not exhaustive. Existing story groups remain curated; new articles join a story only when headlines closely match within three days. Unmatched articles do not create single-item dropdown groups.
