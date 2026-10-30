import copy
import datetime as dt
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import realtime_alerts as alerts


class Checkpoint:
    def __init__(self, state=None):
        self.state = state
        self.saves = 0

    def load(self):
        return copy.deepcopy(self.state)

    def save(self, state):
        self.state = copy.deepcopy(state)
        self.saves += 1


class AlertTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 10, 31, 14, 10, tzinfo=alerts.TZ)
        self.snapshot = {
            "date": "2026-10-31", "updated_at": self.now.isoformat(),
            "source_dates": {"demand": "2026-10-31", "generation": "2026-10-31"},
            "demand_hourly": [{"time": "13:00", "demand_mw": 10000}],
            "generation_hourly": [{"time": "13:00", "total_mw": 10000}],
        }
        self.state, _ = alerts.evaluate(self.snapshot, None, self.now)

    def add_reading(self, demand=11500, generation=8500, hour="14:00"):
        self.snapshot["demand_hourly"].append({"time": hour, "demand_mw": demand})
        self.snapshot["generation_hourly"].append({"time": hour, "total_mw": generation})

    def test_first_run_silent_even_if_historical_crossings(self):
        self.add_reading()
        state, events = alerts.evaluate(self.snapshot, None, self.now)
        self.assertEqual(events, [])
        self.assertEqual(len(state["readings"]["demand"]), 2)

    def test_exact_threshold_both_directions_separate_metrics(self):
        self.add_reading()
        _, events = alerts.evaluate(self.snapshot, self.state, self.now)
        self.assertEqual([e["change"] for e in events], [15, -15])

    def test_below_threshold(self):
        self.add_reading(11499, 8501)
        self.assertEqual(alerts.evaluate(self.snapshot, self.state, self.now)[1], [])

    def test_unchanged_readings_ignore_rebuild_timestamp(self):
        self.snapshot["updated_at"] = (self.now + dt.timedelta(minutes=1)).isoformat()
        state, events = alerts.evaluate(self.snapshot, self.state, self.now)
        self.assertEqual(state, self.state)
        self.assertEqual(events, [])

    def test_requires_exact_hour_not_previous_available_row(self):
        self.add_reading(hour="14:30")
        later = self.now + dt.timedelta(minutes=30)
        self.assertEqual(alerts.evaluate(self.snapshot, self.state, later)[1], [])

    def test_invalid_and_missing_values_are_not_zero(self):
        for invalid in (None, -10, float("nan"), float("inf"), "0", True):
            with self.subTest(invalid=invalid):
                self.snapshot["demand_hourly"] = [{"time": "14:00", "demand_mw": invalid}]
                self.assertEqual(alerts.evaluate(self.snapshot, self.state, self.now)[1], [])

    def test_zero_current_is_a_drop_but_zero_baseline_not_percentage(self):
        self.add_reading(0, 10000)
        _, events = alerts.evaluate(self.snapshot, self.state, self.now)
        self.assertEqual(events[0]["change"], -100)
        self.state["readings"]["demand"]["2026-10-31T13:00:00+06:00"] = 0
        self.snapshot["demand_hourly"][0]["demand_mw"] = 0
        self.assertEqual(alerts.evaluate(self.snapshot, self.state, self.now)[1], [])

    def test_midnight_uses_previous_day_checkpoint(self):
        now = dt.datetime(2026, 11, 1, 0, 10, tzinfo=alerts.TZ)
        self.state["readings"]["demand"] = {"2026-10-31T23:00:00+06:00": 10000}
        self.snapshot.update(date="2026-11-01", source_dates={"demand": "2026-11-01"},
                             demand_hourly=[{"time": "00:00", "demand_mw": 8000}])
        self.assertEqual(alerts.evaluate(self.snapshot, self.state, now)[1][0]["change"], -20)

    def test_stale_future_and_wrong_source_dates_do_not_alert(self):
        self.add_reading()
        self.assertEqual(alerts.evaluate(self.snapshot, self.state, self.now + dt.timedelta(hours=4))[1], [])
        self.assertEqual(alerts.evaluate(self.snapshot, self.state, self.now - dt.timedelta(minutes=20))[1], [])
        self.snapshot["source_dates"] = {}
        self.assertEqual(alerts.evaluate(self.snapshot, self.state, self.now)[1], [])

    def test_revision_can_trigger_but_sent_event_is_not_repeated(self):
        self.add_reading(11000, 10000)
        state, _ = alerts.evaluate(self.snapshot, self.state, self.now)
        self.snapshot["demand_hourly"][-1]["demand_mw"] = 12000
        state, events = alerts.evaluate(self.snapshot, state, self.now)
        self.assertEqual(len(events), 1)
        state["sent"] = [events[0]["id"]]
        self.snapshot["demand_hourly"][-1]["demand_mw"] = 12500
        self.assertEqual(alerts.evaluate(self.snapshot, state, self.now)[1], [])

    def test_email_failure_does_not_advance_checkpoint(self):
        self.state["snapshot_at"] = (self.now - dt.timedelta(minutes=15)).isoformat()
        checkpoint = Checkpoint(self.state)
        self.add_reading()
        def fail(events):
            raise RuntimeError("delivery failed")
        with self.assertRaises(RuntimeError):
            alerts.process(self.snapshot, checkpoint, self.now, deliver=fail)
        self.assertEqual(checkpoint.saves, 0)
        self.assertEqual(checkpoint.state, self.state)

    def test_batches_events_and_checkpoints_successful_delivery(self):
        self.state["snapshot_at"] = (self.now - dt.timedelta(minutes=15)).isoformat()
        checkpoint = Checkpoint(self.state)
        self.add_reading()
        delivered = []
        result = alerts.process(self.snapshot, checkpoint, self.now, deliver=delivered.append)
        self.assertEqual(result["events"], 2)
        self.assertEqual(len(delivered), 1)
        self.assertEqual(len(checkpoint.state["sent"]), 2)
        alerts.process(self.snapshot, checkpoint, self.now, deliver=delivered.append)
        self.assertEqual(len(delivered), 1)

    def test_older_workflow_completion_does_not_rewind_state(self):
        self.state["snapshot_at"] = (self.now + dt.timedelta(minutes=1)).isoformat()
        checkpoint = Checkpoint(self.state)
        self.add_reading()
        result = alerts.process(self.snapshot, checkpoint, self.now, deliver=lambda e: self.fail())
        self.assertFalse(result["changed"])
        self.assertEqual(checkpoint.saves, 0)

    def test_email_contains_source_timestamps_units_and_links(self):
        self.add_reading()
        _, events = alerts.evaluate(self.snapshot, self.state, self.now)
        email = alerts.make_email(events, "sender@example.org", "recipient@example.org")
        body = email.get_content()
        self.assertIn("2026-10-31 13:00", body)
        self.assertIn("+15.0%", body)
        self.assertIn("-1,500.0 MW", body)
        self.assertIn(alerts.DASHBOARD, body)

    def test_pages_archive_reads_json_without_extracting(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "artifact.tar"
            with tarfile.open(archive, "w") as tar:
                raw = json.dumps(self.snapshot).encode()
                member = tarfile.TarInfo("./begd/current-day.json")
                member.size = len(raw)
                tar.addfile(member, io.BytesIO(raw))
            self.assertEqual(alerts.read_snapshot(archive), self.snapshot)


if __name__ == "__main__":
    unittest.main()
