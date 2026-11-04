#!/usr/bin/env python3
"""Ask Claude for a short review of the configured FPL team; writes data/advice.json.

Runs after fetch_data.py, and only when ANTHROPIC_API_KEY is set (a repository secret).
"""
import datetime
import json
import os
import sys

import anthropic

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
MODEL = "claude-opus-5-5"
POSITIONS = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}

SYSTEM = """You are an experienced Fantasy Premier League analyst reviewing one manager's squad before the next deadline.
Work only from the data provided: never invent injuries, news, or fixtures that aren't in it. Prices are in £m.
Rules to respect: 15-man squad (2 GKP, 5 DEF, 5 MID, 3 FWD), at most 3 players per club, transfers must fit the bank plus the outgoing player's price,
an extra transfer beyond the free one costs 4 points. Each chip (wildcard, freehit, bboost = Bench Boost, 3xc = Triple Captain) can be used once in each half of the season (GW1-19, GW20-38).
Be direct and specific, like a sharp friend who knows the game: name players, give the reason in a sentence, and suggest at most two transfers.
Only suggest an incoming player who appears in the squad or the candidate list."""

SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "Two or three sentences on the state of the squad and the plan for the next deadline."},
        "captain": {
            "type": "object",
            "properties": {"player": {"type": "string"}, "reason": {"type": "string"}},
            "required": ["player", "reason"], "additionalProperties": False,
        },
        "transfers": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"out": {"type": "string"}, "in": {"type": "string"}, "reason": {"type": "string"}},
                "required": ["out", "in", "reason"], "additionalProperties": False,
            },
        },
        "chip": {
            "type": "object",
            "properties": {"recommendation": {"type": "string", "description": "e.g. 'Hold all chips' or 'Bench Boost in GW14'"}, "reason": {"type": "string"}},
            "required": ["recommendation", "reason"], "additionalProperties": False,
        },
        "watchlist": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"player": {"type": "string"}, "reason": {"type": "string"}},
                "required": ["player", "reason"], "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "captain", "transfers", "chip", "watchlist"],
    "additionalProperties": False,
}


def load(name):
    with open(os.path.join(DATA, name)) as f:
        return json.load(f)


def per90(value, mins):
    return round(value * 90 / mins, 2) if mins >= 90 else None


def build_context():
    meta, team = load("meta.json"), load("myteam.json")
    players = {p["id"]: p for p in load("players.json")}
    teams = {t["id"]: t["short"] for t in load("teams.json")}
    next_gw = meta.get("nextGw") or (meta.get("currentGw") or 0) + 1

    fixtures = {}
    for f in sorted(load("fixtures.json"), key=lambda f: (f["gw"] or 99, f["kickoff"] or "")):
        if f["finished"] or not f["gw"] or not next_gw <= f["gw"] < next_gw + 5:
            continue
        fixtures.setdefault(f["home"], []).append(f'GW{f["gw"]} {teams[f["away"]]} (H, difficulty {f["homeFdr"]})')
        fixtures.setdefault(f["away"], []).append(f'GW{f["gw"]} {teams[f["home"]]} (A, difficulty {f["awayFdr"]})')

    def describe(p, **extra):
        return {
            "name": p["name"], "position": POSITIONS[p["pos"]], "club": teams[p["team"]], "price": p["price"],
            "status": p["status"], "news": p["news"] or None, "form": p["form"], "points": p["points"],
            "minutes": p["mins"], "xGI_per_90": per90(p["xgi"], p["mins"]), "defensive_contributions_per_90": per90(p["defcon"], p["mins"]),
            "owned_percent": p["own"], "next_fixtures": fixtures.get(p["team"], []), **extra,
        }

    squad = [
        describe(players[pk["id"]], starting=pk["slot"] <= 11, captain=pk["captain"], vice_captain=pk["vice"])
        for pk in sorted(team["picks"], key=lambda pk: pk["slot"]) if pk["id"] in players
    ]
    owned = {pk["id"] for pk in team["picks"]}
    candidates = {}
    for pos, label in POSITIONS.items():
        pool = [p for p in players.values() if p["pos"] == pos and p["id"] not in owned and p["mins"] >= 270 and p["status"] == "a"]
        candidates[label] = [describe(p) for p in sorted(pool, key=lambda p: -p["form"])[:12]]

    return {
        "next_gameweek": next_gw,
        "team": {
            "name": team["name"], "bank": team["bank"], "squad_value": team["value"], "overall_rank": team["overallRank"],
            "chips_used": team["chips"], "points_last_gameweek": team["gwPoints"],
        },
        "squad": squad,
        "candidates_by_position": candidates,
    }, team["id"], next_gw


def main():
    if not os.environ.get("ANTHROPIC_API_KEY") or not os.path.exists(os.path.join(DATA, "myteam.json")):
        print("Skipping Claude advice: no API key or no team configured.")
        return
    context, team_id, next_gw = build_context()

    client = anthropic.Anthropic()
    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
            system=SYSTEM,
            messages=[{"role": "user", "content": "Review this squad for the next deadline.\n\n" + json.dumps(context)}],
        )
    except anthropic.APIStatusError as err:
        print(f"::warning::Claude advice failed ({err.status_code}): {err.message}", file=sys.stderr)
        return
    except anthropic.APIConnectionError as err:
        print(f"::warning::Claude advice failed: could not reach the API ({err})", file=sys.stderr)
        return

    if response.stop_reason != "end_turn":
        print(f"::warning::Claude advice skipped: stop_reason={response.stop_reason}", file=sys.stderr)
        return
    text = next((b.text for b in response.content if b.type == "text"), "")
    advice = json.loads(text)
    advice.update({
        "teamId": team_id,
        "gw": next_gw,
        "model": response.model,
        "generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    })
    with open(os.path.join(DATA, "advice.json"), "w") as f:
        json.dump(advice, f, separators=(",", ":"))
    print(f"Saved Claude advice for GW{next_gw} ({response.usage.input_tokens} in / {response.usage.output_tokens} out tokens).")


if __name__ == "__main__":
    main()
