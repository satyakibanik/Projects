# BEGD static deployment

The dashboard is published by `.github/workflows/pages.yml`. Each hourly run fetches the current Power Grid report list, supported workbooks, and today's ERP readings, then builds a static Pages artifact.

`live-data.js` contains recent workbooks and report metadata. Older supported reports are published as individual files under `archive/`, loaded on demand by the date controls. The header uses the same native operating-date picker as Optional report comparisons: choose a date and click **Load report**, or press Enter. Previous/next buttons navigate available operating dates in the published archive. Missing dates leave the displayed report in place with an explanation; report publication dates remain separately labeled. Load report and Add comparison share the same button styling in both themes. Parsed historical workbooks are cached by GitHub Actions.

## Long-term trends

The `#trends` tab offers 30, 60, 90, and 365 calendar days ending on the latest available operating day. The build emits a compact `trends-data.json` from parsed workbooks, so opening this tab does not download hundreds of full reports. It refreshes with the existing hourly build. The daily workbook selection uses the same next-day-publication preference as the archive and counts each operating date once.

- **Generation:** published P1 daily energy, including imports, in GWh.
- **Demand requirement:** matching-date En-Curve total energy requirement when available; otherwise P1 generation plus reported energy not served. This is an energy requirement, not independently metered demand. The data bundle records which method was used.
- **Reported load shedding:** maximum available P4 reading for each day, in MW. The window summary shows the maximum of those daily observations. P1 energy not served is shown separately in GWh. Neither is inferred from demand minus generation.
- **Fuel mix:** daily shares of P1 energy totals, with imports as a separate source. Only days with every fuel value present and a positive total are drawn.
- **Imports:** P1 total and GenLog route energy, in GWh, retaining workbook route names.

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

For deployment, set the repository's Pages source to **GitHub Actions**. Scheduled runs are approximately hourly; GitHub may delay or drop scheduled runs during high load.

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

Optional report comparisons includes a persistent **Operating date · Bangladesh time** picker and **Add comparison** button. Add multiple exact archived operating dates, then remove individual items. The list identifies each report's operating and publication dates separately. Duplicate dates are rejected; missing reports stay listed with an explanation and never fall back to a neighboring date. Every comparison has a deterministic date color and line pattern. Custom reports participate in the existing Overview, plant detail, Regions, and Imports comparisons.

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

Figure titles have accessible icon buttons for Download PNG, Copy figure and sharing on X. Each icon has a tooltip and screen-reader label. Operating regions and Power plant locations offer Download PNG only. Controls stay attached through report, fuel, range and unit changes. Exports preserve visible chart data, theme, legends and source context; the website URL and `© Bangladesh Electric Grid Dashboard` appear together at bottom right. Generation/demand and its optional temperature subplot export together to retain their aligned date axis. The exact source/footer text is listed in [the figure footer inventory](../docs/figure-footer-inventory.md).

The X-logo-plus-“.com” control opens an in-site progress dialog and starts copying the PNG. After copying succeeds, it shows exactly “PNG copied to your clipboard. Opening X... Paste the image into your post.” It waits 2.5 seconds, then opens the X composer with the figure title and view URL. Paste the image into the post and customize the message in X. No blank tab is opened or reserved. Cancel/Escape prevents navigation. Copy failures keep X closed; if the browser blocks delayed popups, the same dialog offers an X.com link. Nothing posts automatically. Image clipboard access needs a supported browser, HTTPS (or localhost), and permission; Download PNG remains available when copying fails.

The global Share dashboard button and theme toggle sit together beside the website title on every tab. Dashboard sharing offers an editable message, initially “Check out Bangladesh Electric Grid Dashboard. See how the grid is performing live or any given day!”, and an X.com link. Fuel figure controls appear below Chart style. Voltage exports omit interactive reading/help boxes and distribution statistics controls, including when the statistics are expanded; those controls remain available on the live page. There is no LinkedIn or native Share image option.

Exports use vendored MIT-licensed html2canvas 1.4.1 and do not send figure data to an export service. Browser regression against a local preview containing published `live-data.js` and `trends-data.json`:

```sh
BEGD_TEST_URL=http://127.0.0.1:8765/begd/ node tests/e2e/figure-sharing.cjs
```

Playwright and an installed Chromium browser are required; `BEGD_BROWSER_EXECUTABLE` can select a system browser. The test checks title-row icons, header placement across tabs/viewport sizes, actual PNG clipboard/downloads, the in-site confirmation and delayed X handoff without a blank tab, copy-denied and popup-blocked fallbacks, exact dashboard text, voltage export omissions, every chart/map export, fuel rerenders, all recent Trends windows with temperature/MW/°F, the historical heatmap and mobile/dark layouts. Social navigation is stubbed; it never posts to an account.
