#!/usr/bin/env python3
"""Download Fantasy Premier League data into data/ for the static site.

Writes:
  data/meta.json         when the data was fetched and the current gameweek
  data/teams.json        the 20 Premier League teams
  data/players.json      every player with season stats
  data/fixtures.json     every fixture with FPL difficulty ratings
  data/players/<id>.json one player's gameweek-by-gameweek history
  data/prices.json       one price snapshot per day, appended on each run
  data/myteam.json       the FPL team named in config.json, if one is set

Uses only the standard library, so it runs on a bare GitHub Actions runner.
"""
import concurrent.futures
import datetime
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "data")
API = os.environ.get("FPL_API", "https://fantasy.premierleague.com/api")
USER_AGENT = "fpl-hub data fetcher (+https://github.com/rfeasey1213/fpl-hub)"


def fetch_json(url, headers=None, tries=4):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip" or body[:2] == b"\x1f\x8b":
                    body = gzip.decompress(body)
            try:
                return json.loads(body)
            except json.JSONDecodeError as err:
                raise ValueError(f"{url} returned non-JSON ({resp.headers.get('Content-Type')}): {body[:160]!r}") from err
        except (urllib.error.URLError, TimeoutError, ValueError):
            if attempt == tries - 1:
                raise
            time.sleep(2 ** attempt)


def get(path):
    return fetch_json(f"{API}/{path}")


def write(name, obj):
    path = os.path.join(DATA, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"))


def read(name, default=None):
    try:
        with open(os.path.join(DATA, name)) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


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
        "first": p["first_name"],
        "last": p["second_name"],
        "team": p["team"],
        "pos": p["element_type"],
        "price": p["now_cost"] / 10,
        "points": p["total_points"],
        "form": num(p["form"]),
        "ppg": num(p["points_per_game"]),
        "own": num(p["selected_by_percent"]),
        "mins": p["minutes"],
        "starts": p.get("starts", 0),
        "goals": p["goals_scored"],
        "assists": p["assists"],
        "cs": p["clean_sheets"],
        "gc": p.get("goals_conceded", 0),
        "saves": p.get("saves", 0),
        "bonus": p["bonus"],
        "bps": p.get("bps", 0),
        "yellow": p.get("yellow_cards", 0),
        "red": p.get("red_cards", 0),
        "xg": num(p.get("expected_goals")),
        "xa": num(p.get("expected_assists")),
        "xgi": num(p.get("expected_goal_involvements")),
        "xgc": num(p.get("expected_goals_conceded")),
        "influence": num(p.get("influence")),
        "creativity": num(p.get("creativity")),
        "threat": num(p.get("threat")),
        "ict": num(p["ict_index"]),
        "defcon": p.get("defensive_contribution", 0),
        "cbi": p.get("clearances_blocks_interceptions", 0),
        "tackles": p.get("tackles", 0),
        "recoveries": p.get("recoveries", 0),
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
        "starts": h.get("starts", 0),
        "goals": h["goals_scored"],
        "assists": h["assists"],
        "cs": h["clean_sheets"],
        "saves": h.get("saves", 0),
        "bonus": h["bonus"],
        "bps": h.get("bps", 0),
        "defcon": h.get("defensive_contribution", 0),
        "xg": num(h.get("expected_goals")),
        "xa": num(h.get("expected_assists")),
        "xgc": num(h.get("expected_goals_conceded")),
        "price": h["value"] / 10,
        "score": f'{h["team_h_score"]}-{h["team_a_score"]}' if h["team_h_score"] is not None else None,
    }


def update_prices(players, today):
    """Append today's prices to data/prices.json, or replace today's if it already ran."""
    store = read("prices.json", {"dates": [], "prices": {}})
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


def team_id_from_config():
    if os.environ.get("FPL_TEAM_ID"):
        return int(os.environ["FPL_TEAM_ID"])
    try:
        with open(os.path.join(ROOT, "config.json")) as f:
            value = json.load(f).get("teamId")
    except FileNotFoundError:
        return None
    return int(value) if value else None


def fetch_my_team(team_id, gw):
    entry = get(f"entry/{team_id}/")
    history = get(f"entry/{team_id}/history/")
    picks = get(f"entry/{team_id}/event/{gw}/picks/") if gw else {"picks": [], "active_chip": None}
    live = get(f"event/{gw}/live/") if gw else {"elements": []}
    gw_points = {e["id"]: e["stats"]["total_points"] for e in live["elements"]}
    return {
        "id": team_id,
        "name": entry["name"],
        "manager": f'{entry["player_first_name"]} {entry["player_last_name"]}',
        "overallPoints": entry["summary_overall_points"],
        "overallRank": entry["summary_overall_rank"],
        "gwPoints": entry["summary_event_points"],
        "gwRank": entry.get("summary_event_rank"),
        "bank": (entry.get("last_deadline_bank") or 0) / 10,
        "value": (entry.get("last_deadline_value") or 0) / 10,
        "gw": gw,
        "activeChip": picks.get("active_chip"),
        "picks": [
            {
                "id": p["element"],
                "slot": p["position"],
                "multiplier": p["multiplier"],
                "captain": p["is_captain"],
                "vice": p["is_vice_captain"],
                "gwPoints": gw_points.get(p["element"], 0),
            }
            for p in picks["picks"]
        ],
        "history": [
            {
                "gw": h["event"],
                "points": h["points"],
                "total": h["total_points"],
                "rank": h.get("rank"),
                "overallRank": h.get("overall_rank"),
                "bank": h["bank"] / 10,
                "value": h["value"] / 10,
                "transfers": h["event_transfers"],
                "hits": h["event_transfers_cost"],
                "bench": h["points_on_bench"],
            }
            for h in history["current"]
        ],
        "chips": [{"name": c["name"], "gw": c["event"]} for c in history.get("chips", [])],
    }


def main():
    boot = get("bootstrap-static/")
    fixtures = get("fixtures/")

    players = [player_row(p) for p in boot["elements"]]
    teams = [{"id": t["id"], "name": t["name"], "short": t["short_name"], "code": t["code"]} for t in boot["teams"]]
    events = boot["events"]
    current = next((e["id"] for e in events if e["is_current"]), None)
    upcoming = next((e["id"] for e in events if e["is_next"]), None)
    now = datetime.datetime.now(datetime.timezone.utc)
    season = int(events[0]["deadline_time"][:4]) if events else now.year

    write("meta.json", {
        "updated": now.isoformat(timespec="seconds"),
        "currentGw": current,
        "nextGw": upcoming,
        "season": season,
        "deadlines": {e["id"]: e["deadline_time"] for e in events},
    })
    write("teams.json", teams)
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

    def save_player(pid):
        summary = get(f"element-summary/{pid}/")
        write(f"players/{pid}.json", {"history": [history_row(h) for h in summary["history"]]})

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(save_player, [p["id"] for p in players]))

    update_prices(players, now.date().isoformat())

    team_id = team_id_from_config()
    if team_id:
        try:
            write("myteam.json", fetch_my_team(team_id, current))
            print(f"Saved team {team_id}.")
        except Exception as err:  # noqa: BLE001 - a bad team ID shouldn't stop the rest
            print(f"::warning::Could not fetch FPL team {team_id}: {err}", file=sys.stderr)

    print(f"Saved {len(players)} players, {len(fixtures)} fixtures (GW {current}).")


if __name__ == "__main__":
    main()
