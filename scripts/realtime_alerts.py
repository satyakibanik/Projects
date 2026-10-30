#!/usr/bin/env python3
"""Email on new ERP hour-over-hour threshold crossings, after Pages refreshes."""
import argparse
import base64
import copy
import datetime as dt
import json
import math
import os
from pathlib import Path
import smtplib
import ssl
import tarfile
from email.message import EmailMessage
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Dhaka")
STATE_BRANCH = "begd-alert-state"
DASHBOARD = "https://satyakibanik.github.io/Projects/begd/#realtime"
METRICS = {
    "demand": ("demand_hourly", "demand_mw", "Demand (substation side)"),
    "generation": ("generation_hourly", "total_mw", "Generation (including imports)"),
}


def timestamp(day, hour):
    return dt.datetime.fromisoformat(f"{day}T{hour}").replace(tzinfo=TZ)


def valid_number(value):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and value >= 0)


def evaluate(snapshot, previous, now, threshold=15):
    """Return next checkpoint and events; bootstrap silently, retain 72h of readings."""
    if previous is not None and previous.get("version") != 1:
        raise ValueError("Unsupported alert state version; refusing to reset deduplication")
    state = copy.deepcopy(previous) if previous is not None else {
        "version": 1, "readings": {}, "sent": []}
    readings = state["readings"]
    before = copy.deepcopy(readings)
    today = now.astimezone(TZ).date().isoformat()
    day = snapshot.get("date") or snapshot.get("today_date")
    # An unavailable/stale source is not a zero reading or an anomaly.
    if day != today:
        return state, []
    for metric, (table, field, _) in METRICS.items():
        values = readings.setdefault(metric, {})
        if snapshot.get("source_dates", {}).get(metric) != day:
            continue
        for row in snapshot.get(table, []):
            value = row.get(field)
            try:
                when = timestamp(day, row["time"])
            except (ValueError, KeyError, TypeError):
                continue
            if valid_number(value) and when <= now.astimezone(TZ):
                values[when.isoformat()] = value

    events = []
    sent = set(state["sent"])
    for metric, values in readings.items():
        for stamp, current in sorted(values.items()):
            when = dt.datetime.fromisoformat(stamp)
            if not dt.timedelta(0) <= now - when <= dt.timedelta(hours=3):
                continue
            baseline_stamp = (when - dt.timedelta(hours=1)).isoformat()
            baseline = values.get(baseline_stamp)
            if baseline is None or baseline <= 0:
                continue
            old = before.get(metric, {})
            if old.get(stamp) == current and old.get(baseline_stamp) == baseline:
                continue
            change = 100 * (current - baseline) / baseline
            event_id = f"{metric}|{stamp}"
            if previous is not None and abs(change) >= threshold and event_id not in sent:
                events.append({"id": event_id, "metric": metric, "at": stamp,
                               "before": baseline, "after": current, "change": change})

    cutoff = now - dt.timedelta(hours=72)
    state["readings"] = {metric: {stamp: value for stamp, value in values.items()
                                   if dt.datetime.fromisoformat(stamp) >= cutoff}
                         for metric, values in readings.items()}
    state["sent"] = [key for key in state["sent"]
                     if dt.datetime.fromisoformat(key.split("|", 1)[1]) >= cutoff]
    return state, events


def make_email(events, sender, recipient):
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = recipient
    msg["Subject"] = f"BEGD alert: {len(events)} reported hourly change(s) of 15% or more"
    lines = ["New ERP readings crossed the ±15% one-hour threshold.", ""]
    for event in events:
        when = dt.datetime.fromisoformat(event["at"])
        lines += [METRICS[event["metric"]][2],
                  f"{(when - dt.timedelta(hours=1)):%Y-%m-%d %H:%M} → {when:%Y-%m-%d %H:%M} BST (UTC+06:00)",
                  f"{event['before']:,.1f} MW → {event['after']:,.1f} MW",
                  f"Change: {event['change']:+.1f}% ({event['after'] - event['before']:+,.1f} MW)", ""]
    lines += [f"Dashboard: {DASHBOARD}",
              "Demand: https://erp.powergrid.gov.bd/web/generations/view_demand_supply_loadshed",
              "Generation: https://erp.powergrid.gov.bd/w/generations/view_generations", "",
              "Threshold crossing in reported data; not confirmation of a grid disturbance.",
              "Demand and generation use different measurement bases and are checked separately."]
    msg.set_content("\n".join(lines))
    return msg


def send_email(events):
    user = os.environ["BEGD_SMTP_USER"]
    recipient = os.environ["BEGD_ALERT_TO"]
    msg = make_email(events, user, recipient)
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30,
                              context=ssl.create_default_context()) as smtp:
            smtp.login(user, os.environ["BEGD_SMTP_PASSWORD"])
            refused = smtp.send_message(msg)
            if refused:
                raise RuntimeError("SMTP recipient was refused")
    except Exception:
        # SMTP server responses can echo addresses. Do not print them into public logs.
        raise RuntimeError("Email delivery failed; check sender configuration privately") from None


class GitHubState:
    """One orphan branch stores numeric readings only, never email credentials."""
    def __init__(self):
        self.repository = os.environ["GITHUB_REPOSITORY"]
        self.token = os.environ["GH_TOKEN"]
        self.sha = None

    def api(self, path, method="GET", data=None):
        request = Request(f"https://api.github.com/repos/{self.repository}/{path}",
                          method=method,
                          data=json.dumps(data).encode() if data is not None else None,
                          headers={"Authorization": f"Bearer {self.token}",
                                   "Accept": "application/vnd.github+json",
                                   "Content-Type": "application/json",
                                   "X-GitHub-Api-Version": "2022-11-28"})
        with urlopen(request, timeout=30) as response:
            return json.load(response)

    def load(self):
        try:
            self.api(f"git/ref/heads/{STATE_BRANCH}")
        except HTTPError as error:
            if error.code == 404:
                return None
            raise
        # If a branch exists but state is missing/corrupt, fail closed; do not re-bootstrap.
        result = self.api(f"contents/state.json?ref={STATE_BRANCH}")
        self.sha = result["sha"]
        return json.loads(base64.b64decode(result["content"]))

    def save(self, state):
        content = json.dumps(state, sort_keys=True, separators=(",", ":"))
        if self.sha:
            self.api("contents/state.json", "PUT", {
                "branch": STATE_BRANCH, "message": "Checkpoint BEGD alert readings",
                "sha": self.sha, "content": base64.b64encode(content.encode()).decode()})
        else:
            tree = self.api("git/trees", "POST", {"tree": [
                {"path": "state.json", "mode": "100644", "type": "blob", "content": content}]})
            commit = self.api("git/commits", "POST", {
                "message": "Initialize BEGD alert checkpoint", "tree": tree["sha"], "parents": []})
            self.api("git/refs", "POST", {
                "ref": f"refs/heads/{STATE_BRANCH}", "sha": commit["sha"]})


def read_snapshot(archive):
    # Read a single known JSON member; never extract or execute the Pages artifact.
    with tarfile.open(archive) as tar:
        members = [member for member in tar.getmembers()
                   if member.name.lstrip("./") == "begd/current-day.json"]
        if len(members) != 1 or not members[0].isfile() or members[0].size > 32 * 1024 * 1024:
            raise ValueError("Pages artifact must contain one regular begd/current-day.json")
        return json.load(tar.extractfile(members[0]))


def process(snapshot, checkpoint, now, deliver=send_email):
    previous = checkpoint.load()
    updated = dt.datetime.fromisoformat(snapshot["updated_at"])
    if updated.tzinfo is None or updated > now + dt.timedelta(minutes=5):
        raise ValueError("Invalid snapshot publication timestamp")
    if previous and updated <= dt.datetime.fromisoformat(previous["snapshot_at"]):
        return {"initialized": False, "events": 0, "changed": False}
    state, events = evaluate(snapshot, previous, now)
    if events:
        deliver(events)  # Do not mark sent or checkpoint if SMTP fails.
        state["sent"].extend(event["id"] for event in events)
    if state != previous:
        state["snapshot_at"] = updated.isoformat()
        checkpoint.save(state)
    return {"initialized": previous is None, "events": len(events),
            "changed": state != previous}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pages-archive", required=True, type=Path)
    args = parser.parse_args()
    if any(not os.environ.get(key) for key in
           ("BEGD_SMTP_USER", "BEGD_SMTP_PASSWORD", "BEGD_ALERT_TO")):
        raise SystemExit("Missing email configuration; no readings or alert state changed")
    result = process(read_snapshot(args.pages_archive), GitHubState(), dt.datetime.now(dt.timezone.utc))
    summary = ("Initialized baseline; no historical alerts sent." if result["initialized"] else
               f"New alerts emailed: {result['events']}. Reading checkpoint changed: {result['changed']}.")
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
            output.write(f"### BEGD real-time alerts\n\n{summary}\n")


if __name__ == "__main__":
    main()
