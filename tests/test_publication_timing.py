import datetime as dt
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import backfill_workbook_timestamps as backfill
import publication_timing as timing


def instant(text):
    return dt.datetime.fromisoformat(f"2026-11-{text}+06:00")


def snapshot(start, *rows):
    readings = {f"2026-11-{day}T{hour}": {"date": f"2026-11-{day}", "reading_time": hour}
                for day, hour in rows}
    return instant(start), instant(start) + dt.timedelta(seconds=2), readings


def workbook_metadata(xml, path="docProps/core.xml"):
    stream = io.BytesIO()
    with ZipFile(stream, "w") as archive:
        archive.writestr(path, xml)
    return stream.getvalue()


class PublicationTimingTest(unittest.TestCase):
    def test_legacy_merge_keeps_collector_provenance_and_live_confirmation_separate(self):
        row = {"date": "2026-11-19", "reading_time": "11:00", "first_seen_at": instant("19T12:00").isoformat()}
        key = timing.observation_key(row)
        saved = {"feeds": {"demand": {"observations": [row], "seen": {key: row["date"]}}}}
        imported = {"demand": {"observations": [row]}}
        github = timing.github_checkpoint(saved, imported)
        self.assertEqual(github["demand"]["observations"], [])
        self.assertIn(key, github["demand"]["seen"])
        self.assertEqual(saved["feeds"]["demand"]["observations"], [row])
        first_live_check = instant("19T12:30").isoformat()
        confirmed = timing.confirm_publication({}, saved, first_live_check)
        repeated = timing.confirm_publication({"live_confirmed": confirmed}, saved, instant("19T13:00").isoformat())
        self.assertEqual(repeated["demand"][key], first_live_check)

    def test_document_properties_keep_explicit_or_unspecified_zone(self):
        workbook = workbook_metadata("""
          <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                             xmlns:dcterms="http://purl.org/dc/terms/">
            <dcterms:created>2026-11-18T05:46:45Z</dcterms:created>
            <dcterms:modified>2026-11-18T05:51:26</dcterms:modified>
          </cp:coreProperties>
        """)
        self.assertEqual(timing.workbook_timestamps(workbook), {
            "excel_created_at": "2026-11-18T05:46:45+00:00",
            "excel_modified_at": "2026-11-18T05:51:26",
        })
        self.assertEqual(timing.workbook_timestamps(workbook_metadata("<invalid")), {})
        self.assertEqual(timing.workbook_timestamps(workbook_metadata("<empty/>", "other.xml")), {})

    def test_archive_backfill_pages_past_newest_and_excludes_outside_dates(self):
        def report(key, date):
            return {"id": key, "published_date": date, "download_url": key}

        pages = [
            ([report("4", "2026-11-19"), report("3", "2026-11-18")], 4),
            ([report("3", "2026-11-18"), report("2", "2026-11-17")], None),
            ([report("1", "2026-11-16")], None),
        ]
        with (patch.object(timing.server, "fetch_listing_page", side_effect=pages) as listing,
              patch.object(timing.server, "fetch_bytes", return_value=b"unavailable properties")):
            history = backfill.collect("2026-11-17", "2026-11-18")
        self.assertEqual(listing.call_count, 3)
        self.assertEqual(history["reports"], [
            {"report_id": "3", "listed_date": "2026-11-18"},
            {"report_id": "2", "listed_date": "2026-11-17"},
        ])

    def test_baseline_new_reading_and_reappearance(self):
        state = timing.update_feed({}, "demand", snapshot("18T23:58", ("18", "23:00"), ("17", "23:00")))
        self.assertEqual(state["observations"], [])
        self.assertEqual(state["baseline_through"], "2026-11-18")
        state = timing.update_feed(state, "demand", snapshot("19T00:14", ("19", "00:00"), ("18", "23:00")))
        self.assertEqual(state["observations"], [{
            "date": "2026-11-19", "reading_time": "00:00",
            "absent_after": instant("18T23:58").isoformat(),
            "first_seen_at": instant("19T00:14:02").isoformat(),
        }])
        state = timing.update_feed(state, "demand", snapshot("19T00:28", ("19", "00:15"), ("18", "23:00")))
        state = timing.update_feed(state, "demand", snapshot("19T00:43", ("19", "00:15"), ("19", "00:00")))
        self.assertEqual(len(state["observations"]), 2)
        self.assertEqual(state["observations"][0]["first_seen_at"], instant("19T00:14:02").isoformat())

    def test_older_snapshot_and_truncated_date(self):
        state = timing.update_feed({}, "imports", snapshot("18T08:00", ("18", "07:00")))
        with self.assertRaises(ValueError):
            timing.update_feed(state, "imports", snapshot("18T08:15", ("17", "07:00")))
        state = timing.update_feed(state, "imports", snapshot("18T08:15", ("18", "08:00")))
        self.assertIsNone(state["observations"][0]["absent_after"])

    def test_real_time_requires_a_usable_measurement(self):
        def row(*cells):
            return "<tr>" + "".join(f"<td>{cell}</td>" for cell in cells) + "</tr>"

        body = "<table>" + "".join([
            row("19-11-2026", "00:00", "-", "", "NaN", ""),
            row("19-11-2026", "99:00", "1", "2", "0", ""),
            row("19-11-2026", "01:00", "1", "2", "0", ""),
        ]) + "</table>"
        with patch.object(timing.server, "fetch_bytes", return_value=body.encode()):
            _, _, records = timing.poll("demand", lambda: instant("19T01:05"))
        self.assertEqual(list(records), ["2026-11-19T01:00"])

    def test_workbook_retry_holds_original_listing_bound(self):
        def listing(start, *days):
            records = {day: {"date": f"2026-11-{day}", "download_url": "fake", "name": day} for day in days}
            return instant(start), instant(start) + dt.timedelta(seconds=1), records

        state = timing.update_feed({}, "operations", listing("19T08:00", "18", "17"))
        with patch.object(timing.server, "fetch_bytes", side_effect=RuntimeError("temporary")):
            state = timing.update_feed(state, "operations", listing("19T08:15", "19", "18"))
        self.assertEqual(state["observations"], [])
        self.assertEqual(state["pending"]["19"]["after"], instant("19T08:00").isoformat())
        workbook = workbook_metadata("""
            <properties xmlns:t="http://purl.org/dc/terms/">
                <t:created>2026-11-19T08:01:00+06:00</t:created>
                <t:modified>unavailable</t:modified>
            </properties>
        """)
        with (patch.object(timing.server, "fetch_bytes", return_value=workbook),
              patch.object(timing.server, "parse_report", return_value={"date": "2026-11-18"})):
            state = timing.update_feed(state, "operations", listing("19T08:30", "19", "18"),
                                       lambda: instant("19T08:30:05"))
        self.assertFalse(state["pending"])
        self.assertEqual(state["observations"][0]["operating_date"], "2026-11-18")
        self.assertEqual(state["observations"][0]["excel_created_at"], "2026-11-19T08:01:00+06:00")
        self.assertNotIn("excel_modified_at", state["observations"][0])
        self.assertEqual(state["observations"][0]["absent_after"], instant("19T08:00").isoformat())
        self.assertEqual(state["observations"][0]["first_seen_at"], instant("19T08:30:05").isoformat())

    def test_independent_errors_preserve_checkpoint_and_other_feeds_advance(self):
        baseline = snapshot("18T23:58", ("18", "23:00"), ("17", "23:00"))
        updated = snapshot("19T00:14", ("19", "00:00"), ("18", "23:00"))
        demand = timing.update_feed({}, "demand", baseline)
        generation = timing.update_feed({}, "generation", baseline)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "history.json"
            path.write_text(json.dumps({"version": 1, "feeds": {"demand": demand, "generation": generation}}))
            def request(source):
                if source == "generation":
                    return updated
                raise ValueError("bad response")
            with patch.object(timing, "poll", side_effect=request):
                state = timing.collect(path)
            self.assertEqual(state["feeds"]["demand"], demand)
            self.assertEqual(len(state["feeds"]["generation"]["observations"]), 1)
            self.assertEqual(json.loads(path.read_text()), state)

    def test_recovery_distinguishes_initial_404_and_outage(self):
        missing = Path("/nonexistent") / "history.json"
        for code in (404, 503):
            with patch.object(timing, "urlopen", side_effect=HTTPError("https://example.test", code, "", {}, None)):
                if code == 404:
                    self.assertEqual(timing.read_state(missing, "https://example.test"), {})
                else:
                    with self.assertRaises(HTTPError):
                        timing.read_state(missing, "https://example.test")
