#!/usr/bin/env python3
"""Decide whether a scheduled run should refresh the data.

The workflow is scheduled hourly, but only refreshes at 02:xx and 19:xx UTC (after overnight
price changes and evening matches) or within two hours after a gameweek deadline, when
FPL makes everyone's new teams public. Pushes and manual runs always refresh.
Writes run=true/false to $GITHUB_OUTPUT.
"""
import datetime
import json
import os

REFRESH_HOURS = {2, 19}
AFTER_DEADLINE = datetime.timedelta(minutes=120)


def should_run(now, event, deadlines):
    if event != "schedule" or now.hour in REFRESH_HOURS:
        return True
    for d in deadlines:
        passed = now - datetime.datetime.fromisoformat(d.replace("Z", "+00:00"))
        if datetime.timedelta(0) <= passed <= AFTER_DEADLINE:
            return True
    return False


def main():
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "meta.json")) as f:
            deadlines = list(json.load(f).get("deadlines", {}).values())
    except (FileNotFoundError, json.JSONDecodeError):
        deadlines = []
    run = should_run(datetime.datetime.now(datetime.timezone.utc), os.environ.get("GITHUB_EVENT_NAME", ""), deadlines)
    print(f"Refresh: {run}")
    with open(os.environ.get("GITHUB_OUTPUT", os.devnull), "a") as out:
        out.write(f"run={'true' if run else 'false'}\n")


if __name__ == "__main__":
    main()
