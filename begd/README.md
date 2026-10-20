# BEGD static deployment

The dashboard is published by `.github/workflows/pages.yml`. Each hourly run fetches the current Power Grid report list, supported workbooks, and today's ERP readings, then builds a static Pages artifact.

`live-data.js` contains recent workbooks and report metadata. Older supported reports are published as individual files under `archive/`, loaded on demand by the date controls. Parsed historical workbooks are cached by GitHub Actions.

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
