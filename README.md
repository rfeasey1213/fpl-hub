# FPL Hub

Premier League player data for Fantasy Premier League, hosted on GitHub Pages.

- **Players**: every player in Overview, Attack, Defence and Value views: price, points, form, ownership, xG/xA per 90, threat, creativity, ICT, defensive contributions, tackles, recoveries, points per £m and more. Sort by any column; filter by name, position, team, price and minutes.
- **Player profiles**: percentile bars against players in the same position, goals vs xG and assists vs xA, points and price for each gameweek, and a row per game. Goalkeepers get saves, xG conceded and goals prevented instead.
- **Ratings**: every player rated 45–99 within their position, from projected points (35%), position-specific underlying stats (25%), season performance (20%), form (10%) and minutes security (10%), with value per £m shown alongside. FIFA-style cards for the top 12 in each position and a full table; ratings also appear in the Players table, player pages, My Team and Moneyball.
- **Moneyball**: projected points for every regular over the next 5 gameweeks (expected minutes, xG/xA per 90 vs each opponent, clean-sheet odds, defensive contributions, saves, bonus), the price line for each position, budget beasts that beat it, a best-value XI, and overpriced players to sell.
- **My Team**: your squad on a pitch with this gameweek's points, your rank and points history, chips used, a transfer planner that checks budget and the three-per-club rule (plans are saved in your browser only), and an assistant that suggests your captain, best XI, bench order, transfers and when to play each chip.
- **Fixtures**: each team's next gameweeks, coloured by FPL's difficulty rating, with doubles and blanks shown.
- **Prices**: risers and fallers since the last daily snapshot, plus the most transferred in and out this gameweek.

## How it works

`scripts/fetch_data.py` downloads the official FPL API into `data/`. The **Update data and deploy** workflow checks hourly and refreshes twice a day (02:23 and 19:23 UTC) and within two hours after every gameweek deadline, when FPL makes new teams public. It commits the data and deploys the site. The browser can't call the FPL API directly, so the site reads the committed JSON files.

FPL doesn't publish past prices, so the daily price history in `data/prices.json` starts from the first run. Gameweek-by-gameweek prices on player pages come from FPL and cover the whole season.

## Your team

Set your FPL team ID in `config.json` (it's the number in the address bar when you view your Points page on the FPL site) and commit. Every push to `main` refreshes the data, so your team appears a few minutes later.

## Claude's take (optional)

Add an Anthropic API key as a repository secret named `ANTHROPIC_API_KEY` (Settings → Secrets and variables → Actions). Each update then runs `scripts/ai_advice.py`, which sends your squad and a shortlist of in-form players to Claude and saves its review to `data/advice.json` for the My Team page. Without the secret the step is skipped.

## Setup

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Actions → Update data and deploy → Run workflow** to fetch data for the first time.

The site is then live at `https://rfeasey1213.github.io/fpl-hub/`.

## Running locally

```sh
python3 scripts/fetch_data.py   # needs internet access to fantasy.premierleague.com
python3 -m http.server          # then open http://localhost:8000
```
