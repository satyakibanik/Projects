# Collecting fuel data outside GitHub-hosted runners

On 4 November 2026 the same trusted-HTTPS requests succeeded on the development Mac but timed out after 35 seconds on a GitHub-hosted Ubuntu runner. The exact network cause is unknown. Moving parsing code or increasing the report limit alone does not solve that connectivity problem.

## Recommended arrangement

Use a dedicated checkout on an always-on machine whose network has passed a real listing + PDF download + parsing test. This Mac is a proven starting point. An always-on Mac, Linux computer, or server can do the same job, but test its network before paying for hosting.

1. The machine downloads the latest ten reports per gas publisher every two hours, merging them with the committed history and its persistent PDF cache.
2. The collector checks PDF dates, expected columns, plausible ranges and national supply reconciliation. Failed requests or unrecognized PDFs preserve existing rows.
3. Run the fuel validation tests. Check `source_status`, the newest PDF period date, and whether any new reporting dates were added; a completed command alone does not mean a successful source refresh.
4. Commit the validated JSON to a dedicated data branch and open or update a pull request using an authenticated GitHub client. Keep credentials in the machine's credential store, outside the repository.
5. Existing GitHub CI checks the proposed data. Merging the data PR lets the existing Pages workflow publish the committed history even if its own upstream request fails.

This arrangement requires a separate publishing step: scheduling `fuel.py` alone updates a local file, not the public dashboard. A review-based PR still needs a merge; fully unattended publication additionally needs an explicitly configured data-only approval/merge policy. Neither a background job nor automatic merging has been installed by this change.

## Set up and verify the collector

Run these commands in a dedicated clean checkout, not a work directory with unrelated edits. Python 3.12 and system `curl` must be available.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python scripts/fuel.py --page-size 10 --cache .cache/fuel --output begd/fuel-data.json
.venv/bin/python -m unittest discover -s tests -p 'test_*fuel*.py' -v
```

Inspect `source_status` and reporting dates:

```sh
.venv/bin/python - <<'PY'
import json
from pathlib import Path
bundle = json.loads(Path('begd/fuel-data.json').read_text())
print(json.dumps(bundle['source_status'], indent=2))
print('Gas:', len(bundle['gas']), bundle['gas'][0]['date'], bundle['gas'][-1]['date'])
PY
```

For a one-time larger backfill, the existing CLI supports up to 1,000 listing entries per publisher:

```sh
.venv/bin/python scripts/fuel.py --page-size 1000 --cache .cache/fuel --output begd/fuel-data.json
```

The CLI currently reads one listing page per publisher. A limit of 1,000 is not the full Petrobangla archive: its listing reported 2,412 entries when checked. Old layouts may fail parsing and must be inspected before accepting them. Never invent records to fill missing dates. Keep the backfill's downloaded PDFs and rejection log for investigation.

## Scheduling on macOS

Apple's `launchd` supports timed per-user jobs. Create a LaunchAgent with absolute `ProgramArguments` paths for the checkout's `.venv/bin/python` and `scripts/fuel.py`, the checkout as `WorkingDirectory`, `StartInterval` set to `7200`, and absolute `StandardOutPath` / `StandardErrorPath` log paths. Do not rely on a shell profile, relative paths or `~` expansion. The logged-in user's Mac must be online and awake for collection to run at the intended interval. A separate wrapper would implement validation and authenticated PR publication after collection.

Apple reference: https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html

## Always-on alternative

A separately scheduled service on an always-on server avoids dependence on a laptop. Verify all three official pages and at least one PDF from each gas publisher there first. Keep Pages builds on GitHub; transfer only validated data through the repository. A self-hosted Actions runner is another way to run GitHub jobs on your own network, but requires runner maintenance and careful isolation from untrusted pull-request code; a dedicated collector service is sufficient for this task.

GitHub runner reference: https://docs.github.com/en/actions/concepts/runners/self-hosted-runners

A collection-only LaunchAgent template follows. Replace `/absolute/path/to/fuel-collector` everywhere with the dedicated checkout's path and create its `logs` directory. Save it as `~/Library/LaunchAgents/org.begd.fuel-collector.plist`. This template does not push data or open PRs.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>org.begd.fuel-collector</string>
  <key>ProgramArguments</key>
  <array>
    <string>/absolute/path/to/fuel-collector/.venv/bin/python</string>
    <string>/absolute/path/to/fuel-collector/scripts/fuel.py</string>
    <string>--page-size</string><string>10</string>
  </array>
  <key>WorkingDirectory</key><string>/absolute/path/to/fuel-collector</string>
  <key>StartInterval</key><integer>7200</integer>
  <key>StandardOutPath</key><string>/absolute/path/to/fuel-collector/logs/fuel.log</string>
  <key>StandardErrorPath</key><string>/absolute/path/to/fuel-collector/logs/fuel-error.log</string>
</dict>
</plist>
```

Load it after running the collection command successfully by hand:

```sh
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/org.begd.fuel-collector.plist"
launchctl kickstart "gui/$(id -u)/org.begd.fuel-collector"
```

Stop and remove the scheduled job with:

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/org.begd.fuel-collector.plist"
```
