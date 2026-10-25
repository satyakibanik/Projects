# ERP update diagnostic replay

This is a small diagnostic replay, not observed accuracy of updates actually issued in production. Fixed parameters were selected before running this replay. Live update scores remain pending until real saved issues have later matching actuals.

- Input: public `begd/live-data.js`, generated **2026-10-25T01:50:37.962325+00:00**.
- Input SHA-256: `b244e76767586e90232d0e7b95d9f9b50177978376445223e31728e78c4816da`.
- Eligible date: **25 October 2026**, original forecast issued **24 October at 13:59 BST**.
- Other dates with forecasts issued after their operating day began were excluded.
- Replay availability assumption: at `hh:05`, readings only through `(hh−1):00` are supplied. Historical ERP publication timestamps are unavailable, so the assumed delay cannot establish actual historical availability.
- Correction: median of up to three consecutive residuals (at least two), 80% weight, six-hour half-life, maximum 15% of the original prediction. The original forecast is retained.
- Scored hours: **03:00–06:00**, four hours per target. Original and corrected forecasts use identical scored hours. Earlier hours lack enough available readings under the assumed delay.

| Target | Original MAE | Updated MAE | Matched hours |
| --- | ---: | ---: | ---: |
| Substation demand | 706.5 MW | 149.8 MW | 4 |
| ERP generation | 789.5 MW | 282.0 MW | 4 |

This sample covers one overnight decline. It does not establish improvement across other operating days, peaks or changing dispatch conditions. Future live issues must be evaluated prospectively; parameters should be reconsidered using a separate validation window if that evidence warrants it.

Reproduce against the snapshot with the stated hash:

```sh
python scripts/evaluate_forecast_updates.py live-data.js --output update-replay.json
```

The JSON output includes each simulated issue time, original prediction, updated prediction and actual value, plus the dates excluded from evaluation. The dashboard never substitutes these simulated issues for real issue journals.

## Operator precedent and scope of the claim

BEGD includes an experimental intraday bias-adjustment layer informed by recent ERP observations. It follows the operational principle of refreshing short-term forecasts as observations arrive; its parameters and accuracy are evaluated independently.

Primary operator references checked on 25 October 2026:

- [ISO New England, CROP.25004, revision 16, effective 22 July 2026](https://www.iso-ne.com/static-assets/documents/rules_proceds/operating/sysop/cr_ops/crop_25004.pdf): pages 4–8 describe changing forecast methods when the load forecast deviates from actual load, adjusting future curves and using recent actual observations in the internal forecast. This supports intraday correction as an operational practice.
- [CAISO, Market Operations BPM, version 101, §7.8.1.3, printed pages 379–380](https://bpmcm.caiso.com/BPM%20Document%20Library/Market%20Operations/BPM_for_Market%20Operations_V101_Redline.pdf): describes real-time load forecasts using actual load and updated weather, forecasts produced every five minutes, operator adjustment and forecast blending. This supports an updated outlook alongside an earlier forecast.
- [ERCOT, Hurricane Harvey Event Analysis Report, §6.3, printed page 9](https://www.ercot.com/files/docs/2018/05/22/Hurricane_Harvey_Event_Analysis_Report.pdf): records forecast adjustment when historical demand levels no longer reflected conditions, including forecasts based on lagged actual load. This is a specific documented event, rather than evidence that the same method is always used.

These sources do not establish that any operator uses BEGD's three-reading median, 80% weight, six-hour half-life or 15% cap. They do not establish PGCB/NLDC adoption or endorsement. The references concern load forecasting; applying the correction to aggregate generation is a statistical extension, without explicit plant availability, dispatch schedules, import schedules or ramp constraints. Delayed hourly ERP observations also differ from operators' real-time telemetry.

## Prospective evaluation before stronger claims

Keep the parameters fixed while accumulating saved real issues over several weeks. Compare the update and frozen baseline on identical target hours, separately for 1-, 3- and 6-hour horizons measured from each issue time. Report matched coverage, MAE, signed bias and peak-hour errors, including weekdays, weekends and changing operating conditions. Scores must distinguish issue creation time from actual website publication time. The existing latest-eligible-issue MAE is one aggregate measure and does not replace evaluation by horizon.

Compare with a simple recent-actual persistence forecast as well. Any parameter selection should use an earlier validation window, followed by a separate evaluation period. The four-hour replay above cannot establish general reliability or suitability for dispatch decisions.
