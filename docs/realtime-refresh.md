# Real-time refresh diagnosis

Checked the successful [Pages workflow run](https://github.com/satyakibanik/Projects/actions/runs/39692782557), the [published data bundle](https://satyakibanik.github.io/Projects/begd/live-data.js), the local preview, and the public ERP demand/generation pages.

- The scheduled run began **21 October 2026, 19:20:33 EDT** and completed successfully at **19:22:49 EDT**.
- The published bundle was generated at **23:22:31 UTC** (22 October, 05:22:31 Bangladesh time). It contained one reading at **00:00 Bangladesh time**, for both demand and generation. The local preview held the identical snapshot.
- At inspection, ERP demand and generation pages exposed seven readings for 22 October, through **06:00 Bangladesh time**. This proves newer upstream readings existed at inspection; it does not establish which readings ERP returned to the earlier build.
- The five latest recorded scheduled runs were separated by several hours despite the workflow's hourly cron. No newer Pages run was shown after the successful run above. A successful deployment confirms publication, not continuous live updates.
- The static adapter captured `BEGD_STATIC_DATA` at page load. Its three-minute current-day requests returned that same in-memory object, so an open page could not see later publications until reload. The local preview also used a fixed downloaded bundle.

The change publishes a separate `current-day.json` artifact and refetches it on every current-day poll. It keeps the latest valid readings across network/build failures and older artifacts, without changing the selected workbook report. The UI labels capture time, latest reading time, polling/publication cadence and stale snapshots.

The local preview's compact real-time file was refreshed from captured current public ERP pages for verification: seven demand and generation readings through 06:00. Its daily report and Trends data remain the published snapshots. No GitHub workflow was dispatched, merged or deployed. Production gains the changed refresh behavior only after an explicitly approved merge/deployment, and remains limited by upstream reporting and scheduled publication timing.
