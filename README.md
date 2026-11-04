# FPL Hub

Premier League player data for Fantasy Premier League, hosted on GitHub Pages.

- **Players**: every player in Overview, Attack, Defence and Value views: price, points, form, ownership, xG/xA, Understat shots, key passes, xGChain, defensive contributions, points per £m and more. Sort by any column; filter by name, position, team, price and minutes.
- **Player profiles**: percentile bars against players in the same position, an Understat shot map, points and price for each gameweek, and a row per game. Goalkeepers get saves, xG conceded and goals prevented instead of a shot map.
- **My Team**: your squad on a pitch with this gameweek's points, your rank and points history, chips used, and a transfer planner that checks budget and the three-per-club rule. Plans are saved in your browser only.
- **Fixtures**: each team's next gameweeks, coloured by FPL's difficulty rating, with doubles and blanks shown.
- **Prices**: risers and fallers since the last daily snapshot, plus the most transferred in and out this gameweek.

## How it works

`scripts/fetch_data.py` downloads the official FPL API into `data/`, and `scripts/understat.py` adds Understat season stats and shots, matching players by team and name. If Understat is unavailable, the last good copy is kept. The **Update data and deploy** workflow runs it twice a day (02:23 and 19:23 UTC), commits the data, and deploys the site. The browser can't call the FPL API directly, so the site reads the committed JSON files.

FPL doesn't publish past prices, so the daily price history in `data/prices.json` starts from the first run. Gameweek-by-gameweek prices on player pages come from FPL and cover the whole season.

## Your team

Set your FPL team ID in `config.json` (it's the number in the address bar when you view your Points page on the FPL site) and commit. Every push to `main` refreshes the data, so your team appears a few minutes later.

## Setup

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Actions → Update data and deploy → Run workflow** to fetch data for the first time.

The site is then live at `https://rfeasey1213.github.io/fpl-hub/`.

## Running locally

```sh
python3 scripts/fetch_data.py   # needs internet access to fantasy.premierleague.com
python3 -m http.server          # then open http://localhost:8000
```
