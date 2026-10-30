# BEGD static deployment

## Plant and substation histories

Long-term trends includes searchable plant and substation tables with vertical
and horizontal scrolling, sticky column headings, and independently selectable
30/90/365-calendar-day windows ending on the latest national operating day.
Choose an entity name or a metric value to display its daily chart. After selecting a row, Up/Down arrows move through the filtered table while preserving the selected metric and skipping rows without readings for that metric. Only the table scrolls to reveal the focused row. Metrics without any valid readings in the selected window are disabled.

Plant metrics are installed/present capacity (MW), observed peak generation
(MW), capacity factor (%), Plant Utilization Factor (PUF, %), and utilisation ratio (%). A collapsed
“About these plant metrics” section below the chart explains each measure and
its formula using the Power plants tab's definitions. Ratios use the
reported installed capacity; present capacity is never substituted. Capacity
factor uses reported daily MWh / (installed MW × 24). PUF uses estimated running
hours from positive on-the-hour GenLog samples, requires all 24 samples, and is
blank when running hours are zero. Utilisation ratio is peak MW / installed MW.
Each ratio is multiplied by 100. P2-only plants retain available reported values;
cross-border import routes are excluded from the plant catalog.

Station histories show maximum served load (MW) and a combined daily minimum–maximum voltage band
in per unit (reported kV ÷ nominal class kV), with the original kV in brackets
on hover or keyboard focus. Unknown nominal classes remain blank. Voltage classes are separate records. P3 maximum served load is a
station-level value repeated across the matching class rows, not a separate
load to sum across voltage classes. Load-only and voltage-only records remain
available. Invalid or reversed voltage extrema are omitted.

Missing days are chart gaps, never zeros or interpolated values. Table values
show the entity's latest record within its selected window with an explicit
record date. Coverage is shown per chart series. Names join by normalized full
name, without fuzzy plant/unit or station aliases. National-only recovery
reports cannot supply entity histories. Daily workbook selection follows the
archive's next-day-publication preference, then newest report ID.

The build writes `entity-history/index.json` plus one small JSON file per
plant or station/class. The viewer fetches only the selected entity's history.
For local verification using published archive JSON, without training forecasts
or publishing:

```sh
python scripts/preview_entity_history.py
python -m http.server 8788 --bind 127.0.0.1 --directory .cache/entity-history-preview
```

Open `http://127.0.0.1:8788/begd/#trends`. Rebuild from the cached snapshots with
`python scripts/preview_entity_history.py --offline` after editing local source.
The preview reads published snapshots into a local cache; no deployment is performed.

The overview's evening-peak timestamp is derived from matching observed evening
P4 demand, only when the observed maximum agrees with the published summary.
Tied times are retained; unavailable or inconsistent timestamps are not invented.

The dashboard is published by `.github/workflows/pages.yml`. Builds are scheduled at minutes 7, 22, 37 and 52 each hour, fetch current Power Grid reports and ERP readings, then publish a static Pages artifact. GitHub can delay scheduled jobs; the schedule is polling, not an ERP event subscription.

## Independent daily forecasts

Independent demand forecasts use **ERP substation-side demand** from `view_demand_supply_loadshed`; generation forecasts use **ERP Generation(MW)** from `view_generations`, including imports. Workbook P4 demand and generation are not target labels. The chart displays substation supply separately. Positive reported load shedding is substation demand minus supply at the same timestamp. The optional PGCB scenario retains its generation-side label; it is not a substation-demand benchmark. The former forecast-minus-generation estimated-shedding panel has been removed.

The first realtime panel, **Demand, supply, & load shedding.**, contains only substation-side ERP demand, supply and reported shedding, with aligned demand/supply and shedding plots. The second panel, **Today’s BEGD forecasts**, shows only the current Bangladesh operating day and rank-one model per target. It has no history or model selectors. Its demand and generation plots remain independent of choices in the Forecast workspace; substation supply is excluded. Later panels retain their layout.

The Forecast tab opens with the complete **BEGD generated forecasts** comparison, including its own operating-date selector and the top three models per target from the 24 September–21 October evaluation. It defaults to rank 1 and preserves manual choices across live refreshes and date changes. Demand: Independent full-pool convex, Independent mean ensemble, Independent convex stack. Generation: Independent median ensemble, Independent inverse-error blend, Independent mean ensemble. The displayed Day MAE is recomputed for the selected date and model using only exact-hour pairs with finite ERP actuals and predictions. Partial days show their matched-hour count; no matching pairs shows an em dash. The fixed evaluation MAE determines model ranking only. Left/right buttons move through available operating dates. Explicitly date-matched PGCB demand and generation scenarios remain separate references; generation-side PGCB demand is not scored against substation demand. Model descriptions and expandable constituent lists appear below the chart. The original workbook generation-availability metrics and unit table remain below this comparison and follow the report selected in the header. PGCB scenarios are refreshed from the newest report listing after model preparation, so a workbook arriving during a long fit can be included before publication. PGCB demand MAE uses matching generation-side ERP or workbook P4 demand actuals; PGCB generation MAE uses ERP generation actuals. These scores show matched-hour coverage and remain unavailable when the scenario or matching-basis actuals are absent. Generation-side demand never enters BEGD model fitting.

`scripts/daily_forecast.py` uses the same 19 base implementations as the study. Ensemble calibration uses earlier out-of-sample origins whose labels are available by D−1: up to 28 calibration dates preceded by up to 28 warm-up origins. Base fits are cached by input hash; the first build can take longer while it prepares those origins. Training uses up to 100 eligible days, with a minimum of 35. Inputs include lagged ERP profiles, calendar, lagged published workbook temperature/energy and availability, and four-location GFS forecasts at nominal 48-hour lead. Target-day PGCB scenarios and current-day observations never enter fitting. ERP historical availability on D+1 remains an explicit assumption.

Prospective ranked publication starts on 23 October, after the evaluation labels are available by the forecast cutoff. The publisher prepares today and tomorrow and fills missing dates after the study within the last 35 days. The 22 October gap and other forecasts generated after their operating day are explicitly labeled retrospective reconstructions; their issue timestamps are retained. It retains successful forecasts under `.cache/daily-forecasts/erp-independent-top3-v3/YYYY-MM-DD.json`. Missing inputs cause explicit unavailability and a later retry. Each issued file contains three complete candidate curves per target, issue time, cutoffs, sources, weather provenance, diagnostics and ensemble-calibration audits. Current snapshots also include up to 35 operating dates with matching ERP actuals, without changing their frozen forecast files. Historical ERP actuals are refreshed independently of forecast fitting, including when all forecasts are cached or model preparation fails. Date searches retrieve all result pages and isolate failed or conflicting dates, so an unrelated archive conflict cannot abort the entire forecast run. Incomplete days are retried on later builds. Failure reasons are retained in the snapshot and shown when no forecast is available. Realtime API polling reads issued files and never fits models. The version and target-basis checks reject legacy seven-member and generation-side demand caches.

The checked-in `independent-study-data.js` is a compact dated archive of the 56 operating dates (including PGCB-only days), retaining only the three reviewed candidates per target. It supplies retrospective comparisons and the explicitly timed 23 October forward study forecast. New snapshots add subsequently issued forecasts. The archive is not a prospective validation set and is never moved onto a later date.

### Independent-model comparison and local preview

`scripts/independent_models.py` ports all **19 independent base methods and 8 ensembles** from the local challenge, excluding PGCB-assisted methods. `scripts/independent_study.py` evaluates both ERP targets over 82 historical origins. Each fixed evaluation window follows 14 earlier selection dates and a one-day embargo. Ensemble calibration uses only earlier out-of-sample errors whose assumed availability is within the cutoff. The study also supports an unscored current-day preview, with its actual issue time.

```sh
python scripts/prepare_independent_study.py --start 2026-05-25 --end 2026-10-21 --forecast-date 2026-10-23
python scripts/independent_study.py --records .cache/erp-study/records.json --weather .cache/erp-study/weather.json --output .cache/erp-study/results --forecast-date 2026-10-23
python scripts/preview_independent_study.py --output /absolute/path/to/local-preview/begd
```

Preparation can reuse parsed workbook metadata with `--workbook-records` and a previous-runs weather snapshot with `--weather-input`. Raw ERP captures, full predictions and ensemble audits stay in `.cache/erp-study/`. Compact scores, cutoff audits, source hashes and interpretation are in [research/erp-independent-forecasts](../research/erp-independent-forecasts/README.md).

The preview uses the same production panel and ranked model catalog. Future actuals remain blank, and orange demand / blue generation curves use distinct matching plot and legend markers. Rebuild the compact published study archive with `python scripts/preview_independent_study.py --publish-archive begd/independent-study-data.js --current-day .cache/erp-study/current-day.json`. Source scenarios come from cached study records or static report snapshots; optional `--pgcb-records` supplies separate parsed scenarios with explicit dates. The full 27-candidate rankings remain in the research evidence.

Install `requirements-forecast.txt` before building. The dedicated forecast CI job tests the scientific dependencies; the parser-only suite can skip those model fits. Offline checks cover feature leakage, timing, frozen cache reuse, one-reading days, unavailable/wrong-date curves, grouping and visibility. The first cache fill downloads roughly five months of national workbook history; subsequent builds reuse it. Realtime readouts remain available when forecasting fails. Forecasts are experimental and were shortlisted after historical evaluation; they need prospective accuracy monitoring.

`live-data.js` contains recent workbooks and report metadata. Older supported reports are published as individual files under `archive/`, loaded on demand by the date controls. The header uses the same native operating-date picker as Optional report comparisons: choose a date and click **Load report**, or press Enter. Previous/next buttons navigate available operating dates in the published archive. Missing dates leave the displayed report in place with an explanation; report publication dates remain separately labeled. Load report and Add comparison share the same button styling in both themes. Parsed historical workbooks are cached by GitHub Actions.

## Long-term trends

The `#trends` tab offers 30, 60, 90, and 365 calendar days ending on the latest available operating day. The build emits a compact `trends-data.json` from parsed workbooks, so opening this tab does not download hundreds of full reports. It refreshes with the scheduled build. The daily workbook selection uses the same next-day-publication preference as the archive and counts each operating date once.

- **Generation:** published P1 daily energy, including imports, in GWh.
- **Demand requirement:** matching-date En-Curve total energy requirement when available; otherwise P1 generation plus reported energy not served. This is an energy requirement, not independently metered demand. The data bundle records which method was used.
- **Reported load shedding:** maximum available P4 reading for each day, in MW. The window summary shows the maximum of those daily observations. P1 energy not served is shown separately in GWh. Neither is inferred from demand minus generation.
- **Fuel mix:** daily shares of P1 energy totals, with imports as a separate source. Only days with every fuel value present and a positive total are drawn.
- **Imports:** P1 total and GenLog route energy, in GWh, retaining workbook route names.
- **Kaptai Lake water level:** a default-on overlay in the Karnaphuli Hydro plant-history chart, showing daily means on an independent ft MSL right axis, using available whole-hour GenLog Water Level readings (00:00–23:00). The extractor locates the header rather than assuming column FG. Tooltips report hourly coverage, partial days remain included, and missing days remain gaps. The verified 160.02 ft reading at 22:00 on 24 September 2026 is retained and disclosed as a source anomaly. Existing archive reports that stored Water Level as a plant remain readable; newly parsed reports keep it separate from generation.

A separate national-totals extractor recovers P1/P4 data when the full workbook parser fails on an ancillary sheet or plant/region reconciliation. These reports remain excluded from the full daily-report archive, retain quality notes in the data bundle, and do not bypass the original parser’s checks. Inconsistent fuel or import route breakdowns are omitted.

Missing dates and values remain gaps. Totals cover only reported days, with coverage displayed for each measure. No interpolation or zero-filling is performed by the trends aggregator.

The Generation & demand and Imports over time panels each have independent GWh/MW buttons at the top right. GWh shows published daily energy; MW shows that energy divided by 24 hours (daily average power, not instantaneous or peak MW). The separate recent generation-in-MW chart has been removed.

## BengalGrid historical panels

[BengalGrid version 2](https://data.mendeley.com/datasets/xx9dhmy9rj/2), DOI `10.17632/xx9dhmy9rj.2`, by Md Abir Rahman and Rafi Ahamed (Mendeley Data, 2026), is used under **CC BY 4.0** for the separate 2015–2026 chart and monthly heatmap. These two panels appear only under the **10y** range option. The 10y view shows the dataset's full available history (April 2015–October 2026), with exact coverage labeled; the 30d/60d/90d/365d options show recent workbook charts only. BengalGrid does not supply demand or load shedding; it is not spliced into current workbook totals.

`begd/bengalgrid-trends.json` contains attributed display aggregates, not the raw CSV. Rebuild it with:

```sh
python3 scripts/build_bengalgrid_trends.py /absolute/path/to/BengalGrid_data.csv
```

The daily mean uses all available source observations, including half-hour readings. Figure 7b / Table 9 of the supplied paper identifies seven generation observations outside its historical IQR bounds of 756–17,468 MW. Only those records are excluded from the display aggregates; the CSV is unchanged and the excluded timestamps/values are included in the derived JSON. Those historical thresholds are not applied to recent workbooks. The trailing line averages 30 daily means and requires every calendar day in the window. Source gaps are not interpolated. The monthly heatmap uses the median of retained individual observations, reports observation/day counts, and marks partial months.

The other recent-window charts show import dependence, renewable share (hydro + solar + wind), and reported unserved energy as a share of energy requirement. Missing numerators or nonpositive/missing denominators remain blank.

## Local review without deployment

Build a preview using the existing published workbook snapshots:

```sh
python3 scripts/preview_trends.py --recover-missing
python3 -m http.server 8765 --bind 127.0.0.1 --directory .cache/trends-preview
```

Open `http://127.0.0.1:8765/begd/#trends`. The preview and daily summary cache live under `.cache/`. To refresh the source/CSS/JS after local edits without querying upstream again:

```sh
python3 scripts/preview_trends.py --offline
```

The preview script reads public report snapshots; `--recover-missing` also downloads original national workbooks for isolated omitted reports whose neighboring report IDs identify a single candidate, and verifies their operating dates. Original workbooks are cached under `.cache/trends-workbooks/`. The full ERP build performs national recovery directly from listing records. The preview script does not publish, push, or change GitHub Pages. For a full build directly from ERP, run `python scripts/build_pages_data.py` with the parser dependencies installed.

For deployment, set the repository's Pages source to **GitHub Actions**. Runs are scheduled every 15 minutes; GitHub may delay or drop scheduled runs during high load.

All Trends charts have date/value tooltips across the plot area, including historical lines without point markers. Fuel tooltips include both percent shares and GWh. Monthly cells show medians and observation/day counts, including an explicit no-observations message for missing months. Focus a chart and use Left/Right, Home/End, or Escape to navigate or dismiss tooltips; monthly cells also support focus and Escape.

Legend checkboxes toggle chart layers, rescale visible line series, and filter tooltip rows. Choices persist while changing ranges or units during the session. Turning every layer off keeps the legend available for restoring them. Hidden fuel layers keep the full-mix denominator, so remaining shares are not renormalized. The 365d plots label every calendar month at its first day; narrow chart containers and mobile viewports show a reduced quarterly subset.

The Trends sidebar link sits directly below Real time and above the section divider. The page omits the Daily values & source reports and Data coverage detail blocks; coverage counts remain beside each measure, and source metadata and quality flags remain in the generated data.

## Metric calculation details

Headline metrics offer a keyboard-accessible “How calculated” dialog with definitions, units, workbook references, conversion and rounding rules, and original report download links (XLSX/XLSM). This covers Overview, Energy Curve, Imports, Substations, Operations, Forecast and recent Trends totals. Trends list contributing days and each day’s energy requirement basis. Missing links are marked unavailable. Daily energy uses published totals rather than integrated chart samples. Shared definitions live in `metric-methods.js`.

Operations event logs and forecast tables scroll within bounded containers with sticky headers. Every forecast column supports sorting; numeric sorts keep missing values last and preserve zero. Forecast headings distinguish the Forecast sheet’s target date from the workbook’s actuals operating date. Sun and moon symbols distinguish day and evening peaks. The largest circuit-flow source dialog identifies the EWIC circuit, time and signed reading; the metric uses the largest absolute individual reading rather than a combined transfer.

## Temperature comparison

Generation & demand offers an initially unchecked Maximum temperature layer in the 30/60/90/365-day views. It uses published P1!K11 daily maxima and appears in a compact subplot directly below the energy chart. Both plots have aligned date axes, point markers and synchronized cursors. Hovering or focusing either plot shows all selected series with their own units. Leaving or pressing Escape clears both cursors.

The subplot has its own temperature scale and °C/°F controls (°F = °C × 9/5 + 32). Missing readings remain gaps. The 60/90/365-day comparison defaults to consecutive 7-day averages; 30 days defaults to daily detail. The Daily / 7-day average choice and units persist during the session. Each averaged series requires every daily reading in its window; the final window may be shorter. Tooltips identify exact dates and day counts. Averaged temperature means the average of the daily maxima, and energy is average daily energy. Summary totals remain unchanged. The Generation & demand value axis fits currently visible data extrema with padding.

The daily summary and national-recovery extractor retain signed temperatures, including zero. Older national-recovery cache records lacking temperature are refreshed. The separate 10y BengalGrid view does not include workbook temperature.

## Custom comparisons and shared views

Optional report comparisons includes a persistent **Operating date · Bangladesh time** picker and **Add comparison** button. Add multiple exact archived operating dates, then remove individual items. The list identifies each report's operating and publication dates separately. Duplicate dates are rejected; missing reports stay listed with an explanation and never fall back to a neighboring date. Comparison dates use deterministic line patterns and a collision-free color allocation for the active date set, independent of add/load order. Custom reports participate in the existing Overview, plant detail, Regions, and Imports comparisons.

Copy the current browser address to share a view. The address bar updates automatically after settings and reports load; no Copy link button or clipboard permission is needed. Initial default views pin the resolved operating date, and older long links automatically normalize to compact URLs without adding a history entry. Shared settings restore after report and trends loading, on reload, and with browser Back/Forward. Existing hash links such as `#overview`, `#en-curve`, and `#trends` remain supported. Unsupported settings use defaults with a message; unavailable operating dates are explained.

New links use the compact `v=2` URL contract; existing `v=1` links remain readable. Parameters precede the tab hash. Default options and unchanged series are omitted. A default Overview link now needs only `?v=2&date=2026-10-19#overview`.

| Parameter | Meaning |
| --- | --- |
| `date` | Selected operating date, `YYYY-MM-DD` in Asia/Dhaka |
| `compare` | Repeatable custom operating date; comma-separated lists are also accepted |
| `yesterday`, `tomorrow`, `highest` | Explicit resolved operating dates for checked presets; `unavailable` preserves an unavailable selection without resolving a newer report |
| `days` | Trends range: `30`, `60`, `90`, `365`, `10y` |
| `generationUnit`, `importsUnit` | Independent Trends `GWh` / `MW` settings |
| `temperatureUnit`, `detail` | `C` / `F`; `auto`, `daily`, or `weekly` (7-day averages) |
| `dispatch`, `shed`, `fuel`, `regional`, `curve`, `table` | Chart styles and Energy Curve table units |
| `hide`, `show` | Comma-separated stable chart/series aliases for visibility changes; for example `hide=od.d` hides Overview demand and `show=tg.t` enables the Trends temperature subplot |
| `layers`, `trendLayers` | Legacy JSON visibility pairs, still accepted when reading older links |

Compact aliases are explicit, append-only mappings; they never depend on series order. Custom comparison aliases retain their full date (for example `od.d.c20260426`). Dynamic workbook/route/plant identifiers use a lossless escape rather than a numeric position. The original stable IDs remain the internal state and legacy-link contract. Render counters such as `plot-123` are never serialized. Daily chart series use workbook field keys and comparison source IDs such as `generation_mw_custom_2026-10-18`; chart scopes distinguish import routes and plant names. Trends IDs are explicit contract mappings (for example `generation_mwh`, `demand_mwh`, `temperature_c`) with normalized fuel/route identifiers. Unknown retired IDs are harmless. Normal interactions update the URL/history; data refreshes and redraws do not create history entries. Resolved preset dates stay fixed when opening a saved URL, including the highest-generation day.

Automated offline regressions run with the full existing suites:

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/*.test.cjs
```

The opt-in Playwright check at `tests/e2e/shared-view.cjs` runs against a local static preview with published `live-data.js`, `trends-data.json`, and a full archived comparison report. Use the preview process above, place the archived report JSON in its `begd/archive/` directory, and set `BEGD_ARCHIVE_DATE` to that report's operating date (default `2026-09-15`). It exercises a fresh browser context, direct address-bar sharing, asynchronous restoration, all Trends durations, cross-tab chart settings, keyboard controls, and desktop/mobile light/dark layouts:

```sh
BEGD_TEST_URL=http://127.0.0.1:8765/begd/ node tests/e2e/shared-view.cjs
```

Playwright must be available to Node. `BEGD_BROWSER_EXECUTABLE` optionally selects a system Chromium/Edge executable. Screenshots are written to the system's temporary directory. These checks do not publish the dashboard.

## Search visibility

The visible brand, page title, descriptions, and project landing page identify **BEGD — Bangladesh Electric Grid Dashboard** consistently. A static About BEGD section describes the dashboard and its sources before JavaScript loads. Both HTML pages declare clean canonical URLs, and the published `/Projects/sitemap.xml` lists only those canonical pages rather than the many query/hash view combinations. Open Graph and Twitter description tags provide consistent link-preview text.

After publishing, verify the `/Projects/` URL-prefix property in Google Search Console, submit `sitemap.xml`, and request indexing for the dashboard. These steps require access to the site owner's Search Console account and are not performed by the build. Google determines indexing and titles after crawling; adding an acronym does not guarantee a ranking. A dedicated domain or subdomain is needed for a distinct Google site-name preference: Google does not support site names scoped to a subdirectory such as `/Projects/begd/`. Do not place a misleading `robots.txt` under that subdirectory; crawler rules are read from the hostname root.

References: [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide), [canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [site names](https://developers.google.com/search/docs/appearance/site-names), and [requesting a recrawl](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl).

## Figure exports and X sharing

Figure titles have accessible icon buttons for Download PNG, Copy figure and sharing on X. Each icon has a tooltip and screen-reader label. Operating regions and Power plant locations offer Download PNG only. Controls stay attached through report, fuel, range and unit changes. Exports preserve visible chart data, theme, legends and source context; titles, source notes and attribution use the active theme background and text colors; the website URL and `© Bangladesh Electric Grid Dashboard` appear together at bottom right. Generation/demand and its optional temperature subplot export together to retain their aligned date axis. The exact source/footer text is listed in [the figure footer inventory](../docs/figure-footer-inventory.md).

The X-logo-plus-“.com” control opens an in-site progress dialog and starts copying the PNG. After copying succeeds, it shows exactly “PNG copied to your clipboard. Opening X... Paste the image into your post.” It waits 2.5 seconds, then opens the X composer with the figure title and view URL. Paste the image into the post and customize the message in X. No blank tab is opened or reserved. Cancel/Escape prevents navigation. Copy failures keep X closed; if the browser blocks delayed popups, the same dialog offers an X.com link. Nothing posts automatically. Image clipboard access needs a supported browser, HTTPS (or localhost), and permission; Download PNG remains available when copying fails.

The global Share dashboard button and theme toggle sit together beside the website title on every tab. Dashboard sharing offers an editable message, initially “Check out Bangladesh Electric Grid Dashboard. See how the grid is performing live or any given day!”, and an X.com link. Fuel figure controls appear below Chart style. Voltage exports omit interactive reading/help boxes and distribution statistics controls, including when the statistics are expanded; those controls remain available on the live page. There is no LinkedIn or native Share image option.

Exports use vendored MIT-licensed html2canvas 1.4.1 and do not send figure data to an export service. Browser regression against a local preview containing published `live-data.js` and `trends-data.json`:

```sh
BEGD_TEST_URL=http://127.0.0.1:8765/begd/ node tests/e2e/figure-sharing.cjs
```

Playwright and an installed Chromium browser are required; `BEGD_BROWSER_EXECUTABLE` can select a system browser. The test checks title-row icons, header placement across tabs/viewport sizes, actual PNG clipboard/downloads, the in-site confirmation and delayed X handoff without a blank tab, copy-denied and popup-blocked fallbacks, exact dashboard text, voltage export omissions, every chart/map export, fuel rerenders, all recent Trends windows with temperature/MW/°F, the historical heatmap and mobile/dark layouts. Social navigation is stubbed; it never posts to an account.

## Real-time snapshot delivery

The Pages site serves ERP snapshots produced by its scheduled build, rather than calling ERP directly from the browser. The build now emits compact `current-day.json`. Each three-minute `/api/current-day` poll fetches that file with `cache: no-store`, so an open page can receive a newly published snapshot without reloading or changing its selected daily report. The most recent valid snapshot is retained if a request fails, an artifact is malformed, the build reports an ERP failure, or an older artifact is encountered. The view distinguishes snapshot capture time and latest reading time, explains publication cadence, and warns when a snapshot is older than 90 minutes. The Python API server fetches ERP with its three-minute cache and reads already-generated independent forecasts from the same daily cache. It does not fit models while polling; run the build first to prepare forecasts.

This does not speed up GitHub Actions scheduling or publish data between deployments. The existing approximately hourly workflow can be delayed or skipped by GitHub. See [the real-time diagnosis](../docs/realtime-refresh.md). No workflow was dispatched or site deployed during this work.

Substation load and voltage has a keyboard-accessible bounded scroll area and sticky table headers. Figure headings are enlarged both in the dashboard and exported PNGs. Download completion/errors appear immediately below that figure's download button and dismiss after five seconds.

To check newer snapshot delivery and fallback in a local browser, run `node tests/e2e/realtime-refresh.cjs` against a preview containing published `live-data.js` and a newer `current-day.json` (the test uses routed local fixtures and does not publish).

## Social previews and dashboard screenshots

Both entry pages publish a static 1200 × 630 BEGD logo/name card through Open Graph and Twitter metadata, with SVG/PNG browser icons and an Apple touch icon. Social platforms may cache older previews until they crawl the URL again.

Share dashboard → X.com copies a PNG of National overview for the selected operating report before opening the composer. It preserves the Overview chart selections and report comparisons, excludes the Optional report comparisons controls, and leaves the current tab unchanged. Paste the copied image into X; the browser cannot attach clipboard images automatically. Clipboard failures keep X closed and show feedback; blocked popups provide an explicit X link.

Real time always displays generation/demand above a separate reported-load-shedding subplot, with aligned time axes and independent MW scales. Hover, tap or keyboard focus on either plot shows values from both at the same timestamp, with missing readings displayed as unavailable. Escape or leaving the plot clears both cursors.

To check every chart's PNG title and footer backgrounds in both themes, run `BEGD_TEST_URL=http://127.0.0.1:8765/begd/ node tests/e2e/figure-theme.cjs` with the same browser setup and published data described above.

Fuel mix PNGs preserve pie slices, full ring strokes and theme-colored labels using self-contained SVG presentation styles. Check actual fuel-colored PNG pixels for bar, pie and ring in both themes with `BEGD_TEST_URL=http://127.0.0.1:8765/begd/ node tests/e2e/fuel-exports.cjs`.


### Experimental plant map slides

The plant view has seven map slides: fuel type, daily energy (MWh), daily peak generation (MW), operating region, producer, present capacity (MW), and online/offline. Legends filter actual units; clicking again or elsewhere restores the map. Generation icons above the map show counts, support hover previews and pinned selection, and distinguish matching units from all units in a nearby group. Shared dual-fuel units count in each applicable fuel type.

Zero numeric readings are gray, positive values run yellow → orange → red, and missing readings are purple. Energy/peak markers use combined values for grouped units; summed unit peaks may occur at different times. Present-capacity ring segments remain per unit to avoid adding shared capacities twice. Sidebar peak/capacity swatches use their respective slide scales. Scroll-wheel/touchpad zoom uses cursor anchoring and easing, respects reduced motion, and preserves marker screen size while animating. The unit table scrolls within a bounded height with sticky headers and filters.

Icon authors and source links are in [plant-icons/README.md](plant-icons/README.md) and the visible map credits. New map regressions run with `node --test tests/plant-map-slides.test.cjs`; they also run with the existing JavaScript suite.

Daily reports with all-zero regional total cells can still be imported when every regional fuel cell is numeric and every fuel column reconciles to its national subtotal. Regional energy is then calculated by adding the reported fuel values; raw reported totals and calculation provenance are retained, and the report status discloses the calculation. Plant, national fuel, regional and import reconciliation checks remain required.

Real time URLs omit the archived operating date and ignore that parameter in legacy live links. Explicit dates on archived report views still restore the exact selected operating date. **Latest report** returns to the newest published workbook in the available archive and synchronizes its operating date with the picker and URL. A report published on 27 October normally contains actuals for operating date 26 October.

Energy Curve shows reported BPDB costs for the selected operating date when available. Otherwise it shows an explicitly **CALCULATED** estimate: each selected-day P1 fuel energy (MWh × 1,000) multiplied by that fuel's energy-weighted BPDB rate over the preceding 30 calendar days. A rate equals summed cost divided by summed matching positive generation (kWh), using only reported same-fuel cost/energy pairs. The target day and future days are excluded. Zero generation gives zero estimated cost; absent rates or generation remain unavailable and make the displayed subtotal partial. Calculated estimates never enter reported history or historical averages. A coverage table discloses the date range, rates, generation and matched days. The date selector also retains separately dated historical BPDB reports.

Under Trends → Cost of consumed fuel, the original daily-cost chart is followed by **Average cost per kWh by fuel type**. Its independent 7/30/60/90/365-day averaging selector controls the trailing window at each plotted operating date, ending the day before that date. The global Trends range controls which points are plotted. The final rates and matched-day coverage appear in a table. Shared URLs preserve the averaging period and independent fuel-layer visibility. Daily estimates always use 30 days regardless of the selected chart period.

The Power plants table also overlays hourly Kaptai Lake readings for Karnaphuli Hydro PP, using the selected workbook's Water Level column and an independent right axis in ft MSL. The same-named Karnaphuli Power Ltd. receives no lake overlay. The water legend toggle, tooltip units and missing-reading gaps are retained. The table is taller by default and grows to fit an expanded detail; its chart fits the visible table width, with resizing handled automatically. The Trends daily-mean water overlay remains separate.

## Realtime yesterday comparison

A shared, initially unchecked **Yesterday’s data** option above the realtime plots adds the previous calendar day before the snapshot date across demand/supply, reported load shedding, both forecast plots, import dependence and renewable share, fuel mix, total imports and imports by route. Dates and tooltips use Bangladesh time. The selection survives in-session rerenders and snapshot refreshes.

The snapshot includes exact-date ERP fuel and import history in a separate `realtime_history` display bundle. This uses a dedicated detailed-generation cache, preserving the model-training generation schema and frozen forecasts. India routes come from the imports page; Nepal comes from generation. The forecast plots use matching historical actuals and forecast issues; their displayed MAE remains today's score. Missing historical readings stay blank and plots with no matching series explain the gap. Total imports and import dependence require all four routes at the same timestamp.

**Today’s BEGD & PGCB forecasts** starts collapsed. Click its summary, or focus it and press Enter/Space, to expand it. This state is retained when toggling yesterday.

## News (TEST)

The final sidebar tab, after Forecast and a divider, opens `#news`. It loads independently of ERP workbooks from `news-data.json`, currently a saved catalog of 94 articles (18 Bangla) spanning 30 July–27 October 2026. This is selective research coverage, not an exhaustive archive. Automatic news collection is not enabled. The refresh status records the catalog update date rather than page-load time. The original refresh time was not recorded.

Search, publisher, manually assigned story group, and All / English / বাংলা filters combine; Reset clears them and returns to page 1. The list is newest first and shows 20 articles per page, with numbered pagination. Verified posting times use AM/PM in Asia/Dhaka; unknown times are explicitly labeled. Date-only articles have no assumed posting time. New badges and pale-yellow cards apply only to verified timestamps less than 24 hours old and expire on a one-minute check. Related coverage uses manually curated event IDs and names, not automatic clustering.

The Pages build copies the catalog and assets without adding a service or credentials. To update coverage, review source links, publication dates/times, language, short paraphrased summaries and group assignments in the JSON. Update successful-refresh metadata only after validating the catalog. Source-evidence notes are retained per article. Grid-history links remain a proposed feature.

The 30/60/90/365-day Long-term trends windows end with **Operational Event Explorer (logs)**, a paginated P1 log table with description search and category filters. Dates display as plain text without workbook or navigation links. Dates are operating-report dates; outage/event and restoration clock fields remain separate, including missing values. Categories follow explicit action wording rather than reasons such as maintenance; all source entries remain visible. The separate `operational-events.json` bundle covers the same latest 365-day window as the trends, including logs recovered by the national-totals fallback parser. Header-aware extraction joins wrapped descriptions and records P1 row numbers. Missing event sheets/headers remain unavailable rather than zero-event days. Historical cached reports in the explorer window are refreshed once when their event-extraction version is old. The 10y view shows the separate BengalGrid history and Power Division annual system-loss panels.

On screens wider than 600px, the explorer's **Category × hour** tab counts matching entries in hourly bins, showing all categories and source-entry inspection for each cell. **Additional settings** starts collapsed, with defaults: all assets, reported action time, workbook report date, and raw entry counts. Alternate asset, time-column, overnight-date and value options are available there. Date-basis selection affects cell-evidence dates, not category/hour totals. The map retains all source notifications and excludes only entries without the selected time field; empty and missing logs retain distinct meanings in the data. The optional per-day rate divides by days with available logs, including reported empty logs. Cell evidence also uses plain-text dates.

Long category labels wrap inside the sticky heatmap column. Phone layouts (600px or narrower) hide the Category × hour tab and switch an open heatmap back to Logs when the viewport narrows.

Category × hour rows rank by their timed entry totals, highest first, including when cell values show rates or percentages. Regional chart legends separate measure keys from compact numbered date keys, using fixed-size pattern/line swatches. The sticky date bar retains native control behavior without global scroll padding, so focusing it no longer scrolls the page to the top; content anchors keep their own header offset.


The **10y** Trends view includes Power Division / Power Cell annual transmission, distribution, combined loss, and six utility series (BPDB, REB, DPDC, DESCO, WZPDCO, NESCO). It shows the full published fiscal-year record, with its own coverage labels, interactive chart legends, fiscal-year tooltips and a source-value table. Source percentages are preserved; blanks stay missing and combined loss uses the published value.

`scripts/system_loss.py` fetches the [official system-loss page](https://powerdivision.gov.bd/pages/static-pages/694032ba35ce18e1c056155a). The Pages build writes `system-loss-data.json` independently of ERP data. A persisted `.cache/system-loss` snapshot limits source checks to once every 30 days, including failed checks. Failed refreshes retain the last successful snapshot and its original fetch timestamp. The bundled initial snapshot comes from the provided `system_loss/data/system_loss.json` reference; it is labeled with its saved time, not a successful live-fetch time. The first build attempts a live fetch. No extra plotting dependencies are needed.


Reported load shedding in Trends includes all nine operating regions, with individual checkboxes and a **Select / unselect all** checkbox. The national line uses the P4 daily maximum; regional dashed lines use P1 evening snapshots (G60:G68, matched to B17:B25). These measurements cover different times and should not be expected to sum to the national daily maximum. Missing readings remain gaps and explicit zero stays zero. Daily aggregates include `regional_shed_mw`; older national-recovery caches refresh to include regions.

Daily Operations opens the event log in **Timeline** on desktop (wider than 760px), and **Table** on phones. A selected view persists during subsequent report renders.

The Operations EWIC flow map uses the same local Bangladesh country and administrative basemap assets and projection as Plants. `ewic-locations.json` retains six user-approved endpoint records from `Substation Coordinate Matches.xlsx`, including workbook hash, row numbers, OSM identifiers and original site/voltage review notes. Endpoint approval is not verification of circuit terminal identities or surveyed transmission routes: the three connections are explicitly schematic. In particular, Sreepur and Gopalganj retain voltage/site matching caveats in the coordinate evidence.

The map slider selects actual EWIC timestamps in Bangladesh time for the selected report. Branch width uses absolute MW on one fixed scale across that day. Blue denotes west-to-east, orange east-to-west, grey zero, and dashed grey missing data. Values are not interpolated; absent reports disable the slider. Comparison-day overlays remain in the hourly chart, while the map uses only the selected report.
