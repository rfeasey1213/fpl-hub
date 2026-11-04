"use strict";
// Projected FPL points ("xPts") per player per fixture, built from underlying stats:
// expected minutes, xG/xA per 90 adjusted for the opponent's defence, clean-sheet odds
// from both teams' xG, defensive-contribution odds, saves and bonus rates.

const Model = (() => {
  const GOAL = { 1: 10, 2: 6, 3: 5, 4: 4 };
  const CLEAN_SHEET = { 1: 4, 2: 4, 3: 1, 4: 0 };
  const DEFCON_THRESHOLD = { 2: 10, 3: 12, 4: 12 };
  const HOME_ATTACK = 1.08, AWAY_ATTACK = 0.92;
  const PRIOR_GAMES = 3;      // shrink team rates toward the league average early in the season
  const PRIOR_MINUTES = 450;  // shrink player per-90 rates toward their position's average

  let teams = new Map(), league = 1.3, posAvg = {}, upcoming = new Map(), cache = new Map();

  function init(D, upcomingByTeam) {
    upcoming = upcomingByTeam;
    cache = new Map();
    const rows = new Map(D.teams.map((t) => [t.id, { games: 0, xgf: 0, xga: 0 }]));
    for (const f of D.fixtures) {
      if (!f.finished) continue;
      rows.get(f.home).games++;
      rows.get(f.away).games++;
    }
    for (const p of D.players) {
      const r = rows.get(p.team);
      r.xgf += p.xg;
      if (p.pos === 1) r.xga += p.xgc;
    }
    const played = [...rows.values()].filter((r) => r.games);
    league = played.length ? played.reduce((a, r) => a + r.xgf / r.games, 0) / played.length : 1.3;
    teams = new Map([...rows].map(([id, r]) => [id, {
      games: r.games,
      xgf: (r.xgf + league * PRIOR_GAMES) / (r.games + PRIOR_GAMES),
      xga: (r.xga + league * PRIOR_GAMES) / (r.games + PRIOR_GAMES),
    }]));

    // Position averages per 90 among regulars, used as the prior for small samples.
    for (const pos of [1, 2, 3, 4]) {
      const regs = D.players.filter((p) => p.pos === pos && p.mins >= 450);
      const mins = regs.reduce((a, p) => a + p.mins, 0) || 1;
      const rate = (k) => (regs.reduce((a, p) => a + p[k], 0) * 90) / mins;
      posAvg[pos] = { xg: rate("xg"), xa: rate("xa"), bonus: rate("bonus"), saves: rate("saves"), defcon: rate("defcon"), yellow: rate("yellow") };
    }
  }

  const per90 = (p, key) => {
    const w = p.mins / (p.mins + PRIOR_MINUTES);
    const own = p.mins ? (p[key] * 90) / p.mins : 0;
    return w * own + (1 - w) * posAvg[p.pos][key];
  };

  function poissonAtLeast(mean, k) {
    let term = Math.exp(-mean), below = 0;
    for (let i = 0; i < k; i++) { below += term; term *= mean / (i + 1); }
    return Math.max(0, 1 - below);
  }

  // How much a player is likely to play next time out.
  function availability(p) {
    const games = teams.get(p.team)?.games || 0;
    const fit = ["i", "s", "u", "n"].includes(p.status) ? 0 : p.chance != null ? p.chance / 100 : p.status === "d" ? 0.5 : 1;
    if (!games) return { mins: 0, p60: 0, pPlay: 0, fit };
    const share = Math.min(1, p.mins / (games * 90));
    const startRate = Math.min(1, p.starts / games);
    return { mins: 90 * share * fit, p60: startRate * fit, pPlay: Math.min(1, Math.max(startRate, share * 1.25)) * fit, fit };
  }

  function fixturePoints(p, fx, av = availability(p)) {
    if (!av.mins) return 0;
    const team = teams.get(p.team), opp = teams.get(fx.opp);
    if (!team || !opp) return 0;
    const m = av.mins / 90;
    const attack = (opp.xga / league) * (fx.home ? HOME_ATTACK : AWAY_ATTACK);
    const conceded = team.xga * (opp.xgf / league) * (fx.home ? AWAY_ATTACK : HOME_ATTACK);
    let pts = av.p60 * 2 + Math.max(0, av.pPlay - av.p60);
    pts += per90(p, "xg") * m * attack * GOAL[p.pos];
    pts += per90(p, "xa") * m * attack * 3;
    pts += av.p60 * Math.exp(-conceded) * CLEAN_SHEET[p.pos];
    if (p.pos <= 2) pts -= (conceded * m) / 2;
    if (p.pos === 1) pts += (per90(p, "saves") * m * (opp.xgf / league)) / 3;
    else pts += 2 * poissonAtLeast(per90(p, "defcon") * m, DEFCON_THRESHOLD[p.pos]);
    pts += per90(p, "bonus") * m;
    pts -= per90(p, "yellow") * m;
    return Math.max(0, pts);
  }

  // Projected points per gameweek for the next `n` gameweeks starting at `fromGw`.
  function project(p, fromGw, n) {
    const key = `${p.id}:${fromGw}:${n}`;
    if (cache.has(key)) return cache.get(key);
    const av = availability(p);
    const byGw = Array.from({ length: n }, (_, i) => ({ gw: fromGw + i, pts: 0, fixtures: 0 }));
    for (const fx of upcoming.get(p.team) || []) {
      const slot = byGw[fx.gw - fromGw];
      if (!slot) continue;
      slot.pts += fixturePoints(p, fx, av);
      slot.fixtures++;
    }
    const result = { byGw, total: byGw.reduce((a, g) => a + g.pts, 0), av };
    cache.set(key, result);
    return result;
  }

  // Best XI for one gameweek from a 15-man squad: every legal formation, best players by xPts.
  function bestXI(squad, ptsOf) {
    const by = (pos) => squad.filter((p) => p.pos === pos).sort((a, b) => ptsOf(b) - ptsOf(a));
    const gk = by(1), d = by(2), mid = by(3), f = by(4);
    let best = null;
    for (let nd = 3; nd <= 5; nd++) for (let nm = 2; nm <= 5; nm++) {
      const nf = 10 - nd - nm;
      if (nf < 1 || nf > 3 || nd > d.length || nm > mid.length || nf > f.length || !gk.length) continue;
      const xi = [gk[0], ...d.slice(0, nd), ...mid.slice(0, nm), ...f.slice(0, nf)];
      const total = xi.reduce((a, p) => a + ptsOf(p), 0);
      if (!best || total > best.total) best = { xi, total, formation: `${nd}-${nm}-${nf}` };
    }
    if (!best) return null;
    const inXI = new Set(best.xi);
    const bench = [...squad.filter((p) => !inXI.has(p) && p.pos !== 1).sort((a, b) => ptsOf(b) - ptsOf(a)),
      ...squad.filter((p) => !inXI.has(p) && p.pos === 1)];
    return { ...best, bench };
  }

  return { init, project, availability, bestXI, league: () => league };
})();
