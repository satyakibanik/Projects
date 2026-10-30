# BEGD real-time email alerts

The `BEGD real-time email alerts` workflow runs after a successful `Refresh live data and publish BEGD` run on main. It reads `begd/current-day.json` from that exact run's Pages artifact. There is no additional ERP polling schedule and no email when the source readings are unchanged.

## Enable Gmail delivery

In repository **Settings → Secrets and variables → Actions**, configure:

| Type | Name | Value |
| --- | --- | --- |
| Secret | `BEGD_SMTP_USER` | Gmail account sending the alerts |
| Secret | `BEGD_SMTP_PASSWORD` | That account's Google app password, not its normal login password |
| Secret | `BEGD_ALERT_TO` | Recipient email address |

Store all three values as encrypted repository secrets. Do not put actual email addresses or credentials in source files, documentation, repository variables, screenshots or workflow output. Gmail app passwords require 2-Step Verification and may be unavailable for some accounts: https://support.google.com/accounts/answer/185833

Secret names are public in workflow source; their configured values are not. The runner must receive the values to send email, and Gmail receives the sender, recipient and authentication data over TLS. The application does not deliberately print these values or store them in the site bundle, artifacts or numeric alert checkpoint. GitHub's automatic log masking is a fallback, not an absolute guarantee; anyone able to change privileged workflow code can potentially misuse available secrets. See https://docs.github.com/en/actions/concepts/security/secrets

The workflow explicitly reports **not active** in its summary if configuration is missing. It does not advance its checkpoint in that case. The first configured run saves a baseline without sending old alerts. Subsequent successful site refreshes monitor new readings and corrections. No test email is sent automatically.

## Rule

- Check demand (`demand_hourly.demand_mw`, substation side) and generation (`generation_hourly.total_mw`, including imports) independently.
- Compare against exactly one hour earlier: `100 × (current − previous) / previous`. Alert at an absolute change of **15% or greater**.
- Only source readings from today's Bangladesh operating date and no more than three hours old are eligible. Ignore future timestamps, missing/negative/nonfinite values, missing exact-hour baselines and zero denominators. A valid current zero with a positive baseline is a 100% drop.
- Batch all newly detected crossings into one email per refresh. Each metric/timestamp is emailed at most once during ordinary successful operation, including repeated rebuilds and revisions of an already emailed event.
- Preserve 72 hours of readings and sent-event identifiers in `state.json` on the dedicated orphan branch `begd-alert-state`. This preserves midnight comparisons. The branch contains no workflows or credentials. No changes are made to main by the running monitor.
- Process workflows serially; ignore older snapshots that complete out of order. Delivery failures fail the alert job and leave its checkpoint unchanged for retry.

GitHub Actions schedules are best effort: email detection follows successful refreshes, not the instant ERP publishes. Source updates can be delayed, revised or invalid; these emails flag reported changes, not confirmed grid incidents. Pending workflow runs can be coalesced by GitHub concurrency. If a skipped snapshot contained an event that is absent from the subsequent snapshot, that event may be missed.

SMTP and the GitHub checkpoint cannot be committed atomically. If SMTP accepts an email but the checkpoint save then fails, or the runner stops between those steps, a retry can send a duplicate. Check the failed run before retrying. Do not delete the state branch unless intentionally resetting the baseline.

Disable by disabling the alert workflow in Actions. It does not affect site publication. Run the detector tests with `python3 -m unittest discover -s tests -p 'test_realtime_alerts.py' -v`.

## Possible later rules (not enabled)

Sudden changes in substation supply; reported load-shedding spikes or sustained levels; import-route loss or sharp reductions; large fuel-specific generation changes; and unusual deviations from a sufficiently evaluated forecast. Thresholds should combine MW and percentage limits when baselines can be small. Data freshness/missing-source alerts require a separate timed health check because no new reading arrives to trigger them. Frequency or grid-disturbance alerts require an appropriate frequency/event data source, which these ERP series do not provide.
