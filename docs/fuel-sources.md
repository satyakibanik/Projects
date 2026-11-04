# Fuel dashboard

Started from GitHub Pages' successful deployment of `742f1703dc83d0430191ba15ed33e1ab351c5003` on 4 November 2026. Fuel is directly below Forecast (`#fuel`) and uses dates independently of the electricity workbook picker.

## Source comparison

Sources checked on 4 November 2026:

- [Petrobangla daily operational reports](https://petrobangla.org.bd/pages/reports?filters=%7B%22reports_type%22%3A%20%226922d2b181fc96cef9e99f16%22%7D): primary national gas supply and sector allocations. Structured, dated PDF tables, generally one decimal place. The [homepage](https://petrobangla.org.bd/) stated 2,561.7 MMCFD for 2 November 08:00–3 November 08:00, matching the latest PDF's grand total. The homepage alone cannot provide historical components.
- [GTCL operational reports](https://gtcl.gov.bd/pages/reports?filters=%7B%22reports_type%22%3A%20%226922d2b181fc96cef9e99f16%22%7D): secondary, provisional/operational check. More decimal precision and detailed transmission information, but greater precision alone does not establish greater accuracy. GTCL throughput must not replace national production.
- [BCMCL coal production](https://bcmcl.org.bd/pages/static-pages/6922dd3c933eb65569e140ed): primary **annual** domestic mine production in metric tonnes. The content-specific update date was 13 July 2026. FY 2025–2026 is 762,752.630 tonnes. Construction-period production is excluded from the fiscal-year chart. This source does not establish daily coal stocks, imports, or consumption.
- [EMRD](https://emrddashboard.gov.bd/): homepage showed natural gas supply rounded to 2,562 MMCFD. This is consistent numerically with the latest Petrobangla headline, but its matched reporting period was not established; do not splice it into the daily series. No authenticated or undocumented API is used.

The four supplied PDFs were compared with their publisher-hosted copies. All four have identical SHA-256 hashes to the downloaded public copies used for this draft.

| Period ending, 08:00 BST | Petrobangla total | GTCL total | Difference (PB − GTCL) | Petrobangla power supply | GTCL power supply |
| --- | ---: | ---: | ---: | ---: | ---: |
| 27 October 2026 | 2,539.1 | 2,539.0713 | +0.0287 | 830.8 | 838.110 |
| 2 November 2026 | 2,561.9 | 2,561.8610 | +0.0390 | 932.1 | 880.057 |

All values in this table are million cubic feet for the 24-hour period, expressed numerically as an average daily rate (MMCFD). GTCL labels its period volumes MMSCF. This comparison assumes the publishers' stated conventions; no pressure/temperature conversion is inferred.

**The supplied pairs agree on the national total at Petrobangla's one-decimal precision; they do not match in every measure.** For example, on 2 November Petrobangla lists 124 producing wells and 3,870 capacity, whereas GTCL lists 112 wells and 3,760 capacity. On 27 October the BAPEX subtotals are 69.1 versus 69.0154. Published power-sector allocations differ substantially; the dashboard preserves Petrobangla's allocation series and shows GTCL's separately. The reason for those differences is not established by these PDFs.

The additional ten-date comparison also has differences beyond rounding, notably 25 October (2,537.9 vs 2,537.6187) and 1 November (2,560.8 vs 2,560.6727). The comparison panel exposes every overlap; no blanket “verified” flag is applied to the archive.

## Coverage and interpretation

The initial bundle contains 100 actual daily Petrobangla reports ending 27 July–3 November 2026, ten GTCL checks ending 24 October–2 November, and 21 fiscal years of BCMCL production (2005–2006 through 2025–2026). No synthetic daily history is generated. The requested Daily / 7 / 30 / 60 / 90 / 365 day / Long term controls select calendar windows ending on the chosen gas report date. Longer windows explicitly show missing coverage. Annual coal stays separate from these gas controls.

Report dates come from PDF headings, not upload dates or filenames; cross-month headings are supported. A date of 3 November means the period **2 November 08:00 through 3 November 08:00 Bangladesh time**. Gas is not an hourly electricity series. Power-sector gas-demand gaps are not electricity load shedding. Production and distribution totals are preserved separately and are not presented as a calculated system loss. Domestic production sums published state and IOC subtotals, so a 0.1 rounding difference from the grand total less LNG can remain.

Rows retain original PDF URLs and SHA-256 hashes. SVG charts have corresponding exact-value tables; CSV exports contain the selected gas window. `fuelWindow` and `fuelDate` query parameters retain the Fuel view's range/date across navigation and shared links.

## Collection and local use

`scripts/fuel.py` collects the latest ten reports from each gas publisher during the existing Pages build, merges dates with the saved seed and Actions cache, and refreshes the annual coal table. Downloads use trusted HTTPS through system curl. Layout/column/range/reconciliation failures leave existing rows intact and publish a partial/failed source status. A collection timestamp describes the attempt; PDF period dates describe the actual data age. This is saved official data, not a live gas telemetry feed.

The Actions cache retains `.cache/fuel`, so historical reports accumulate across builds. The committed seed provides a baseline after cache eviction. Older accumulated rows beyond the committed seed depend on cache retention; backfill explicitly when needed:

```sh
python scripts/fuel.py --page-size 100 --output begd/fuel-data.json
```

The existing local application server serves the new files:

```sh
python scripts/server.py --port 8790
# Open http://127.0.0.1:8790/begd/#fuel
```

The Fuel view loads independently of ERP report availability. For an isolated static review, `python -m http.server 8790` also serves the Fuel tab; other dashboard tabs need the normal ERP server or a published static data bundle.

Validation: the full JavaScript and Python suites, real PDF parsing of the 100+10 report seed, supplied-PDF comparisons, month-boundary dates, invalid layouts, preserved history on collection failure, calendar ranges, chart gaps, and browser checks of local range/date controls and navigation. Six existing Python tests skip optional integrations in this environment.
