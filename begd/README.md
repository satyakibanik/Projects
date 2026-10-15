# BEGD static deployment

The dashboard is published by the GitHub Actions workflow in `.github/workflows/pages.yml`. On each hourly run, it fetches the current Power Grid report list, recent workbooks, and today's ERP readings, then builds a static Pages artifact.

The generated data is bundled as `live-data.js` inside the deployment artifact. It is not committed as report JSON files to the repository. The dashboard includes reports from the latest two weeks; older daily reports are not available in this static build.

After merging the workflow, set the repository's Pages source to **GitHub Actions**. Scheduled runs are approximately hourly; GitHub may delay or drop scheduled runs during high load.