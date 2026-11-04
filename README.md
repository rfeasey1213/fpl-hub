# FPL Hub

Premier League player data for Fantasy Premier League, hosted on GitHub Pages.

- **Players**: every player's price, points, form, ownership, minutes, goals, assists, xG/xA and next three fixtures. Sort by any column; filter by name, position, team, price and minutes.
- **Fixtures**: each team's next gameweeks, coloured by FPL's difficulty rating, with doubles and blanks shown.
- **Player pages**: points and price for each gameweek, with a row per game.
- **Prices**: risers and fallers since the last daily snapshot, plus the most transferred in and out this gameweek.

## How it works

`scripts/fetch_data.py` downloads the official FPL API into `data/`. The **Update data and deploy** workflow runs it twice a day (02:23 and 19:23 UTC), commits the data, and deploys the site. The browser can't call the FPL API directly, so the site reads the committed JSON files.

FPL doesn't publish past prices, so the daily price history in `data/prices.json` starts from the first run. Gameweek-by-gameweek prices on player pages come from FPL and cover the whole season.

## Setup

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Actions → Update data and deploy → Run workflow** to fetch data for the first time.

The site is then live at `https://rfeasey1213.github.io/fpl-hub/`.

## Running locally

```sh
python3 scripts/fetch_data.py   # needs internet access to fantasy.premierleague.com
python3 -m http.server          # then open http://localhost:8000
```
