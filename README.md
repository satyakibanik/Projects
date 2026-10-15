# satyakibanik.github.io

Personal site

## Bangladesh Electric Grid Dashboard

[Open the BEGD dashboard](https://satyakibanik.github.io/satyakibanik/begd/)

BEGD is an interactive dashboard for Power Grid Bangladesh PLC and the National Load Dispatch Centre (NLDC) daily operating reports. It summarizes Bangladesh’s electricity demand, generation, fuel mix, load shedding, regional supply, and cross-border imports.

### Dashboard views

- **Overview** — hourly generation-side demand and generation; daily fuel mix; reported load shedding; evening-peak demand and generation; and published daily energy totals.
- **Power plants** — plant capacity, peak output, reported energy, producer, region, and source remarks, with search and filters.
- **Regions** — regional energy and fuel mix alongside evening-peak demand and load shedding.
- **Imports** — hourly MW and daily energy by cross-border route, with imports’ share of reported national energy.
- **Real time** — ERP demand, generation, and India-import readings dated today in Bangladesh time.
- **Comparisons and download** — optional adjacent-day and highest-generation comparisons, chart controls, and JSON export.

All times use Bangladesh time (Asia/Dhaka). Workbook publication date can differ from its operating date. The static Pages build contains supported reports from the latest two weeks and refreshes approximately hourly; GitHub may delay or drop scheduled runs. Real-time panels use only source rows dated today and do not backfill older readings. The data bundle is generated during deployment and is not committed to the repository.

### Data sources

BEGD’s daily views are parsed from Power Grid Bangladesh PLC / NLDC workbooks in the [Power Grid ERP daily report archive](https://erp.powergrid.gov.bd/w/report/eyJpdiI6IldsU2ZQTGkvbkRnQU9FMjZ5UHhmeGc9PSIsInZhbHVlIjoiQzhONVl5ZGxRY3E3T3ZVNCtLZGt1Zz09IiwibWFjIjoiN2JiNTI5MzNhOWIxZDVjY2NkMmFlZWU4ZDU1N2I4OWZlYjNlZWM1ZGU4NzRiNWU4ZjQ3ZDc1ODRlMTk3MDc0YyIsInRhZyI6IiJ9/show_report). The parser reads P1 (national summary, fuel mix, and regions), P2 (plant records), P4 (hourly demand, generation, and load shedding), and GenLog (imports).

Real-time readings and the highest-generation comparison use these Power Grid ERP pages:

- [Demand, supply, and load shedding](https://erp.powergrid.gov.bd/web/generations/view_demand_supply_loadshed)
- [Generation by source](https://erp.powergrid.gov.bd/w/generations/view_generations)
- [India imports](https://erp.powergrid.gov.bd/w/generations/imported_power_india)
- [Maximum generation](https://erp.powergrid.gov.bd/w/maximum_generations/show_maximum_generations)

### Reading the figures

- Generation totals include imports.
- Power readings are in MW; daily energy totals are in MWh or GWh. Hourly MW samples are not added up to calculate daily MWh.
- Generation-side demand, substation-side demand, and reported load shedding are distinct measures.
- Regional figures are evening-peak snapshots rather than full-day demand.
- Zero plant output alone does not establish an outage.

### Publishing

The dashboard lives in the `begd/` folder of this repository. The GitHub Actions workflow builds a static data bundle from the ERP archive and deploys the project at the link above. If the link is not available yet, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions** and run the Pages workflow.

