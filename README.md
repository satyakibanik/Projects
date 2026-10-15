# satyakibanik.github.io
Personal site

## Bangladesh Electric Grid Dashboard

The Bangladesh Electric Grid Dashboard is available at [satyakibanik.github.io/begd](https://satyakibanik.github.io/begd/). It presents Power Grid Bangladesh daily report views for national operations, power plants, regions, imports, and current-day readings.

GitHub Actions rebuilds and publishes the Pages site hourly from Power Grid Bangladesh's public ERP archive. The generated report bundle is included in the Pages deployment artifact, not committed as report JSON files in this repository.

After merging the Pages workflow, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. Scheduled runs publish the latest two weeks of supported daily reports and current-day readings. The latest report, real-time readings, and available comparisons update hourly.

The workflow is scheduled at 17 minutes past each hour. GitHub may delay or drop scheduled runs during busy periods, so the refresh is approximately hourly rather than guaranteed to run at an exact time.