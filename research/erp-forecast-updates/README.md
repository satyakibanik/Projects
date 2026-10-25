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
