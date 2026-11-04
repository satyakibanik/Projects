# Collecting fuel data outside GitHub-hosted runners

On 4 November 2026 the same trusted-HTTPS requests succeeded on the development Mac but timed out after 35 seconds on a GitHub-hosted Ubuntu runner. The exact network cause is unknown. Moving parsing code or increasing the report limit alone does not solve that connectivity problem.

## Existing automatic collection

A Mac is not required by the dashboard. `.github/workflows/pages.yml` already schedules the Pages build at minutes 11, 26, 41 and 56 of every hour. During each build, `scripts/fuel.py` attempts the latest ten report entries per gas publisher, merges saved observations and refreshes coal. When the runner can reach the source websites, new daily reports are collected automatically. The schedule and job completion times are best effort; a successful website deployment does not prove each upstream fetch succeeded. Inspect `source_status` and the latest reporting date.

The 4 November diagnostic found connection timeouts from one GitHub-hosted runner. This is the reason to consider a fallback collector, not evidence that GitHub Actions cannot perform collection in general. Keep the existing automatic path; a separate machine is only a workaround if that access problem persists.

## Fallback if GitHub source access remains unavailable

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

For a one-time complete walk of the advertised PDF/spreadsheet archives, run the separate resumable command:

```sh
.venv/bin/python scripts/backfill_fuel.py --cache .cache/fuel --audit docs/fuel-backfill-2026-11-04.json
```

It follows pagination, stores original PDFs/spreadsheets and parser-versioned results locally, preserves original reporting dates, records failures and conflicts, and writes the dataset on completion. `--max-pages 1` limits a trial run. Backfill is intentionally separate from frequent Pages builds. Missing links, unsupported files and conflicting dates remain documented gaps; no values are estimated.

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


## Optional OCR for historical GTCL scans

Normal daily updates do not need OCR or macOS. The optional archive path can use the local Vision helper for older scanned reports. It accepts only one unambiguous date and a unique nine-component reconciliation; it does not turn uncertain OCR into observations. OCR national totals are labelled in the dashboard and audit, with power-sector values left missing. Original PDFs, hashes, OCR observations and rejection reasons remain available for review.

Build the helper with a compatible installed macOS SDK. On the development Mac, the installed 15.4 SDK works with the command-line compiler:

```sh
clang -isysroot /Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk -fobjc-arc -fmodules -framework Foundation -framework Vision scripts/fuel_vision_ocr.m -o /tmp/begd-fuel-ocr
.venv/bin/python scripts/backfill_fuel.py --ocr-program /tmp/begd-fuel-ocr --cache .cache/fuel --audit docs/fuel-backfill-2026-11-04.json
```

Use `--retry-failed` to reparse prior failed records. Parsed results are invalidated when parser code or their cached source-file hash changes. The compiled helper is optional and is never invoked by the regular Pages build or its tests. Uncertain scans still need manual source review; they are not filled from Petrobangla or estimated.
