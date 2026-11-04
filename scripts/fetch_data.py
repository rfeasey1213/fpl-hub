#!/usr/bin/env python3
"""Download Fantasy Premier League data into data/ for the static site.

Writes:
  data/meta.json         when the data was fetched and the current gameweek
  data/teams.json        the 20 Premier League teams
  data/players.json      every player with season stats
  data/fixtures.json     every fixture with FPL difficulty ratings
  data/players/<id>.json one player's gameweek-by-gameweek history
  data/prices.json       one price snapshot per day, appended on each run

Uses only the standard library, so it runs on a bare GitHub Actions runner.
"""
import concurrent.futures
import datetime
import json
import os
import time
import urllib.error
import urllib.request

API = os.environ.get("FPL_API", "https://fantasy.premierleague.com/api")
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
USER_AGENT = "fpl-hub data fetcher (+https://github.com/rfeasey1213/fpl-hub)"


def get(path, tries=4):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(f"{API}/{path}", headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.load(resp)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            if attempt == tries - 1:
                raise
            time.sleep(2 ** attempt)


def write(name, obj):
    path = os.path.join(DATA, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"))


def num(value):
    """FPL sends many decimals as strings ("4.5"); missing values become 0."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def player_row(p):
    return {
        "id": p["id"],
        "name": p["web_name"],
        "full": f'{p["first_name"]} {p["second_name"]}',
        "team": p["team"],
        "pos": p["element_type"],
        "price": p["now_cost"] / 10,
        "points": p["total_points"],
        "form": num(p["form"]),
        "ppg": num(p["points_per_game"]),
        "own": num(p["selected_by_percent"]),
        "mins": p["minutes"],
        "goals": p["goals_scored"],
        "assists": p["assists"],
        "cs": p["clean_sheets"],
        "bonus": p["bonus"],
        "xg": num(p.get("expected_goals")),
        "xa": num(p.get("expected_assists")),
        "xgi": num(p.get("expected_goal_involvements")),
        "ict": num(p["ict_index"]),
        "status": p["status"],
        "news": p["news"],
        "chance": p["chance_of_playing_next_round"],
        "changeGw": p["cost_change_event"] / 10,
        "changeStart": p["cost_change_start"] / 10,
        "transfersIn": p["transfers_in_event"],
        "transfersOut": p["transfers_out_event"],
        "code": p["code"],
    }


def history_row(h):
    return {
        "gw": h["round"],
        "opp": h["opponent_team"],
        "home": h["was_home"],
        "kickoff": h["kickoff_time"],
        "points": h["total_points"],
        "mins": h["minutes"],
        "goals": h["goals_scored"],
        "assists": h["assists"],
        "cs": h["clean_sheets"],
        "bonus": h["bonus"],
        "xg": num(h.get("expected_goals")),
        "xa": num(h.get("expected_assists")),
        "price": h["value"] / 10,
        "score": f'{h["team_h_score"]}-{h["team_a_score"]}' if h["team_h_score"] is not None else None,
    }


def update_prices(players, today):
    """Append today's prices to data/prices.json, or replace today's if it already ran."""
    path = os.path.join(DATA, "prices.json")
    try:
        with open(path) as f:
            store = json.load(f)
    except FileNotFoundError:
        store = {"dates": [], "prices": {}}

    dates, prices = store["dates"], store["prices"]
    rerun = bool(dates) and dates[-1] == today
    if not rerun:
        dates.append(today)
    current = {str(p["id"]): p["price"] for p in players}
    for pid in set(prices) | set(current):
        series = prices.setdefault(pid, [None] * (len(dates) - (0 if rerun else 1)))
        if rerun:
            series[-1] = current.get(pid)
        else:
            series.append(current.get(pid))
    write("prices.json", store)


def main():
    boot = get("bootstrap-static/")
    fixtures = get("fixtures/")

    players = [player_row(p) for p in boot["elements"]]
    events = boot["events"]
    current = next((e["id"] for e in events if e["is_current"]), None)
    upcoming = next((e["id"] for e in events if e["is_next"]), None)
    now = datetime.datetime.now(datetime.timezone.utc)

    write("meta.json", {
        "updated": now.isoformat(timespec="seconds"),
        "currentGw": current,
        "nextGw": upcoming,
        "deadlines": {e["id"]: e["deadline_time"] for e in events},
    })
    write("teams.json", [
        {"id": t["id"], "name": t["name"], "short": t["short_name"], "code": t["code"]}
        for t in boot["teams"]
    ])
    write("players.json", players)
    write("fixtures.json", [
        {
            "id": f["id"],
            "gw": f["event"],
            "home": f["team_h"],
            "away": f["team_a"],
            "homeFdr": f["team_h_difficulty"],
            "awayFdr": f["team_a_difficulty"],
            "kickoff": f["kickoff_time"],
            "finished": f["finished"],
            "homeScore": f["team_h_score"],
            "awayScore": f["team_a_score"],
        }
        for f in fixtures
    ])

    def fetch_history(pid):
        summary = get(f"element-summary/{pid}/")
        write(f"players/{pid}.json", [history_row(h) for h in summary["history"]])

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(fetch_history, [p["id"] for p in players]))

    update_prices(players, now.date().isoformat())
    print(f"Saved {len(players)} players, {len(fixtures)} fixtures (GW {current}).")


if __name__ == "__main__":
    main()
