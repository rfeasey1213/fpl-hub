"use strict";
// Projected FPL points ("xPts") per player per fixture.
//
// Team side: every team's xG for and against, split home/away and weighted toward recent
// matches, gives the expected goals each side scores in a fixture.
// Player side: expected minutes (recent starts weighted over the season), open-play xG/xA
// per 90 (recent and season blended, shrunk toward the position average), penalty duty,
// defensive-contribution, save and bonus rates. Points follow FPL's scoring rules.

const Model = (() => {
  const GOAL = { 1: 10, 2: 6, 3: 5, 4: 4 };
  const CLEAN_SHEET = { 1: 4, 2: 4, 3: 1, 4: 0 };
  const DEFCON_THRESHOLD = { 2: 10, 3: 12, 4: 12 };
  const DECAY = 0.92;          // weight of a match drops 8% per match further back
  const LEAGUE_PRIOR = 3;      // matches' worth of league average mixed into each team rate
  const VENUE_PRIOR = 2;       // matches' worth of the team's overall rate mixed into its home/away rate
  const PRIOR_MINUTES = 180;   // minutes' worth of position average mixed into player per-90 rates
  const RECENT_WEIGHT = 0.4;   // share of the per-90 rate taken from the last few matches
  const PEN_RATE = 0.12;       // penalties awarded per team per match (Premier League average)
  const PEN_XG = 0.78;         // xG of a penalty
  const PEN_SHARE = { 1: 0.9, 2: 0.1 }; // share of penalties taken by first and second choice

  let teams = new Map(), league = 1.35, posAvg = {}, upcoming = new Map(), cache = new Map();
  let takers = new Map(); // team id -> { 1: player, 2: player }

  function weighted(matches, key) {
    let sum = 0, w = 0;
    matches.forEach((m, i) => { const wt = DECAY ** (matches.length - 1 - i); sum += m[key] * wt; w += wt; });
    return { sum, w };
  }

  function init(D, upcomingByTeam) {
    upcoming = upcomingByTeam;
    cache = new Map();
    const all = D.teams.flatMap((t) => t.matches || []);
    league = all.length ? all.reduce((a, m) => a + m.xg, 0) / all.length : 1.35;
    teams = new Map(D.teams.map((t) => {
      const ms = t.matches || [];
      const rate = (list, key, prior, k) => { const { sum, w } = weighted(list, key); return (sum + prior * k) / (w + k); };
      const attack = rate(ms, "xg", league, LEAGUE_PRIOR), defence = rate(ms, "xga", league, LEAGUE_PRIOR);
      const home = ms.filter((m) => m.home), away = ms.filter((m) => !m.home);
      return [t.id, {
        games: ms.length, attack, defence,
        attackHome: rate(home, "xg", attack, VENUE_PRIOR), attackAway: rate(away, "xg", attack, VENUE_PRIOR),
        defenceHome: rate(home, "xga", defence, VENUE_PRIOR), defenceAway: rate(away, "xga", defence, VENUE_PRIOR),
      }];
    }));

    takers = new Map();
    for (const p of D.players) {
      if (p.penOrder === 1 || p.penOrder === 2) {
        if (!takers.has(p.team)) takers.set(p.team, {});
        takers.get(p.team)[p.penOrder] = p;
      }
    }

    for (const pos of [1, 2, 3, 4]) {
      const regs = D.players.filter((p) => p.pos === pos && p.mins >= 450);
      const mins = regs.reduce((a, p) => a + p.mins, 0) || 1;
      const rate = (f) => (regs.reduce((a, p) => a + f(p), 0) * 90) / mins;
      posAvg[pos] = { xg: rate((p) => openPlayXg(p, p.xg, p.mins)), xa: rate((p) => p.xa), bonus: rate((p) => p.bonus),
        saves: rate((p) => p.saves), defcon: rate((p) => p.defcon), yellow: rate((p) => p.yellow) };
    }
  }

  // A penalty taker's xG includes their penalties; strip the expected share so penalties are counted once.
  function openPlayXg(p, xg, mins) {
    const share = PEN_SHARE[p.penOrder] || 0;
    return Math.max(0, xg - share * PEN_RATE * PEN_XG * (mins / 90));
  }

  // Season and recent per-90 rates blended, then shrunk toward the position average.
  function rate(p, key) {
    const r = p.recent || {};
    const seasonVal = key === "xg" ? openPlayXg(p, p.xg, p.mins) : p[key];
    const recentVal = key === "xg" ? openPlayXg(p, r.xg || 0, r.mins || 0) : r[key] || 0;
    const season = p.mins ? (seasonVal * 90) / p.mins : 0;
    const recent = r.mins >= 90 ? (recentVal * 90) / r.mins : null;
    const blended = recent == null ? season : (1 - RECENT_WEIGHT) * season + RECENT_WEIGHT * recent;
    const w = p.mins / (p.mins + PRIOR_MINUTES);
    return w * blended + (1 - w) * posAvg[p.pos][key];
  }

  function poissonAtLeast(mean, k) {
    let term = Math.exp(-mean), below = 0;
    for (let i = 0; i < k; i++) { below += term; term *= mean / (i + 1); }
    return Math.max(0, 1 - below);
  }

  // How much a player is likely to play: recent starts and minutes weigh more than the season.
  function availability(p) {
    const games = teams.get(p.team)?.games || 0;
    const fit = ["i", "s", "u", "n"].includes(p.status) ? 0 : p.chance != null ? p.chance / 100 : p.status === "d" ? 0.5 : 1;
    if (!games) return { mins: 0, p60: 0, pPlay: 0, fit };
    const r = p.recent || {};
    const blend = (seasonV, recentV) => (r.games ? 0.6 * recentV + 0.4 * seasonV : seasonV);
    const share = Math.min(1, blend(p.mins / (games * 90), (r.mins || 0) / (r.games * 90 || 1)));
    const startRate = Math.min(1, blend(p.starts / games, (r.starts || 0) / (r.games || 1)));
    return { mins: 90 * share * fit, p60: startRate * fit, pPlay: Math.min(1, Math.max(startRate, share * 1.25)) * fit, fit };
  }

  // Expected goals for and against `team` in a fixture.
  function fixtureGoals(teamId, fx) {
    const t = teams.get(teamId), o = teams.get(fx.opp);
    if (!t || !o) return null;
    const scored = (fx.home ? t.attackHome : t.attackAway) * (fx.home ? o.defenceAway : o.defenceHome) / league;
    const conceded = (fx.home ? o.attackAway : o.attackHome) * (fx.home ? t.defenceHome : t.defenceAway) / league;
    return { scored, conceded, attackMult: scored / t.attack, csProb: Math.exp(-conceded) };
  }

  function penaltyShare(p) {
    const t = takers.get(p.team);
    if (!t || !p.penOrder) return 0;
    if (p.penOrder === 1) return PEN_SHARE[1];
    // A second-choice taker takes most penalties when the first choice is out.
    const firstFit = t[1] ? availability(t[1]).fit : 0;
    return p.penOrder === 2 ? PEN_SHARE[2] + (1 - firstFit) * PEN_SHARE[1] : 0;
  }

  // Points for one fixture, by source.
  function breakdown(p, fx, av = availability(p)) {
    const g = fixtureGoals(p.team, fx);
    const parts = { appearance: 0, goals: 0, assists: 0, penalties: 0, cleanSheet: 0, conceded: 0, saves: 0, defcon: 0, bonus: 0, cards: 0 };
    if (!av.mins || !g) return { parts, total: 0, goals: g };
    const m = av.mins / 90;
    parts.appearance = av.p60 * 2 + Math.max(0, av.pPlay - av.p60);
    parts.goals = rate(p, "xg") * m * g.attackMult * GOAL[p.pos];
    parts.assists = rate(p, "xa") * m * g.attackMult * 3;
    parts.penalties = penaltyShare(p) * PEN_RATE * Math.sqrt(g.attackMult) * PEN_XG * m * GOAL[p.pos];
    parts.cleanSheet = av.p60 * g.csProb * CLEAN_SHEET[p.pos];
    if (p.pos <= 2) parts.conceded = -(g.conceded * m) / 2;
    if (p.pos === 1) parts.saves = (rate(p, "saves") * m * (g.conceded / league)) / 3;
    else parts.defcon = 2 * poissonAtLeast(rate(p, "defcon") * m, DEFCON_THRESHOLD[p.pos]);
    parts.bonus = rate(p, "bonus") * m * Math.sqrt(g.attackMult);
    parts.cards = -rate(p, "yellow") * m;
    const total = Math.max(0, Object.values(parts).reduce((a, v) => a + v, 0));
    return { parts, total, goals: g };
  }

  // Projected points per gameweek for the next `n` gameweeks starting at `fromGw`.
  function project(p, fromGw, n) {
    const key = `${p.id}:${fromGw}:${n}`;
    if (cache.has(key)) return cache.get(key);
    const av = availability(p);
    const byGw = Array.from({ length: n }, (_, i) => ({ gw: fromGw + i, pts: 0, fixtures: 0, detail: [] }));
    for (const fx of upcoming.get(p.team) || []) {
      const slot = byGw[fx.gw - fromGw];
      if (!slot) continue;
      const b = breakdown(p, fx, av);
      slot.pts += b.total;
      slot.fixtures++;
      slot.detail.push({ fx, ...b });
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

  return { init, project, availability, bestXI, fixtureGoals, penaltyShare, league: () => league };
})();
