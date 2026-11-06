#!/usr/bin/env python3
"""Decide whether a scheduled run should refresh the data.

The workflow is scheduled hourly, but GitHub often runs scheduled jobs late or skips them, so
this doesn't depend on the clock time. A scheduled run refreshes when a gameweek deadline has
passed since the last refresh (FPL makes everyone's new teams public at the deadline) or when
the data is more than 8 hours old. Pushes and manual runs always refresh.
Writes run=true/false to $GITHUB_OUTPUT.
"""
import datetime
import json
import os

MAX_AGE = datetime.timedelta(hours=8)


def parse(ts):
    return datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))


def should_run(now, event, last_update, deadlines):
    if event != "schedule" or last_update is None:
        return True
    if now - last_update >= MAX_AGE:
        return True
    return any(last_update < parse(d) <= now for d in deadlines)


def main():
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "meta.json")) as f:
            meta = json.load(f)
        last_update, deadlines = parse(meta["updated"]), list(meta.get("deadlines", {}).values())
    except (FileNotFoundError, KeyError, json.JSONDecodeError):
        last_update, deadlines = None, []
    run = should_run(datetime.datetime.now(datetime.timezone.utc), os.environ.get("GITHUB_EVENT_NAME", ""), last_update, deadlines)
    print(f"Refresh: {run}")
    with open(os.environ.get("GITHUB_OUTPUT", os.devnull), "a") as out:
        out.write(f"run={'true' if run else 'false'}\n")


if __name__ == "__main__":
    main()
