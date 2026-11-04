"""Add Understat stats and shots to FPL players.

Understat has no shared player IDs with FPL, so players are matched by team and name.
"""
import concurrent.futures
import os
import re
import unicodedata

BASE = os.environ.get("UNDERSTAT_BASE", "https://understat.com")
HEADERS = {
    "X-Requested-With": "XMLHttpRequest",
    "Referer": f"{BASE}/",
    "Accept": "application/json, text/javascript, */*; q=0.01",
}

# FPL short team names that don't share words with Understat's full names.
TEAM_ALIASES = {
    "man city": "manchester city",
    "man utd": "manchester united",
    "spurs": "tottenham",
    "nott m forest": "nottingham forest",
    "wolves": "wolverhampton wanderers",
}


def norm(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z]+", " ", text.lower()).strip()


def tokens(text):
    return set(norm(text).split())


def overlap(a, b):
    return len(a & b) / len(a | b) if a and b else 0.0


def match_teams(teams, titles):
    """Map FPL team id -> Understat team title."""
    result = {}
    for t in teams:
        name = TEAM_ALIASES.get(norm(t["name"]), norm(t["name"]))
        best = max(titles, key=lambda title: (norm(title) == name, overlap(tokens(name), tokens(title))), default=None)
        if best and (norm(best) == name or overlap(tokens(name), tokens(best)) > 0):
            result[t["id"]] = best
    return result


def name_score(fpl, us_name):
    us = tokens(us_name)
    full = tokens(f'{fpl["first"]} {fpl["last"]}')
    web = tokens(fpl["name"])
    score = overlap(full, us)
    if web and web <= us:
        score += 0.5
    if norm(us_name) == norm(fpl["name"]):
        score += 1
    return score


def match_players(players, us_players, team_titles):
    """Return {fpl_id: understat_player}, matching each Understat player at most once."""
    candidates = []
    for p in players:
        title = team_titles.get(p["team"])
        for u in us_players:
            same_team = title and title in u["team_title"].split(",")
            score = name_score(p, u["player_name"])
            # Across teams (e.g. a January signing) only an exact full-name match counts.
            exact = norm(u["player_name"]) == norm(f'{p["first"]} {p["last"]}')
            if (same_team and score >= 0.5) or exact:
                candidates.append((score + (1 if same_team else 0), p["id"], u["id"], u))
    taken_fpl, taken_us, matches = set(), set(), {}
    for score, fid, uid, u in sorted(candidates, key=lambda c: -c[0]):
        if fid not in taken_fpl and uid not in taken_us:
            taken_fpl.add(fid)
            taken_us.add(uid)
            matches[fid] = u
    return matches


def f(value):
    try:
        return round(float(value), 3)
    except (TypeError, ValueError):
        return 0.0


def shot_row(s):
    return {
        "x": f(s["X"]),
        "y": f(s["Y"]),
        "xg": f(s["xG"]),
        "result": s["result"],
        "situation": s.get("situation"),
        "type": s.get("shotType"),
        "minute": int(s.get("minute") or 0),
        "date": (s.get("date") or "")[:10],
        "home": s.get("h_a") == "h",
        "opp": s.get("a_team") if s.get("h_a") == "h" else s.get("h_team"),
    }


def enrich(players, teams, season, fetch_json):
    """Attach `us` stats to matched players. Returns (match count, {fpl_id: [shots]})."""
    league = fetch_json(f"{BASE}/getLeagueData/EPL/{season}", HEADERS)
    us_players = league["players"]
    titles = {t for u in us_players for t in u["team_title"].split(",")}
    matches = match_players(players, us_players, match_teams(teams, titles))

    for p in players:
        u = matches.get(p["id"])
        if not u:
            continue
        p["us"] = {
            "id": int(u["id"]),
            "games": int(u["games"]),
            "mins": int(u["time"]),
            "shots": int(u["shots"]),
            "keyPasses": int(u["key_passes"]),
            "xg": f(u["xG"]),
            "xa": f(u["xA"]),
            "npg": int(u["npg"]),
            "npxg": f(u["npxG"]),
            "xgChain": f(u["xGChain"]),
            "xgBuildup": f(u["xGBuildup"]),
        }

    def player_shots(item):
        fpl_id, u = item
        if int(u["shots"]) == 0:
            return fpl_id, []
        try:
            data = fetch_json(f"{BASE}/getPlayerData/{u['id']}", HEADERS)
        except Exception:  # noqa: BLE001 - one player's shots failing is fine
            return fpl_id, None
        return fpl_id, [shot_row(s) for s in data.get("shots", []) if str(s.get("season")) == str(season)]

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        shots = {fid: rows for fid, rows in pool.map(player_shots, matches.items()) if rows is not None}
    return len(matches), shots
