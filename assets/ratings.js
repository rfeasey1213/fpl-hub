"use strict";
// Player ratings (45–99), per position. Each part is a percentile among players in the same
// position with 270+ minutes; the overall is a weighted blend mapped onto a FIFA-style scale.

const Ratings = (() => {
  const WEIGHTS = { fut: 0.35, und: 0.25, per: 0.2, frm: 0.1, min: 0.1 };
  const MIN_SAMPLE = 270;     // minutes needed to join the comparison group
  const FULL_CONFIDENCE = 900; // minutes after which past numbers are fully trusted
  const HORIZON = 5;
  const PARTS = {
    fut: "Future: projected points, next 5 gameweeks",
    und: "Underlying: position-specific quality per 90",
    per: "Performance: points per 90, points per game, bonus",
    frm: "Form: FPL form, last 30 days",
    min: "Minutes: how secure the starting spot is",
    val: "Value: projected points per £m (not in the overall)",
  };

  const p90 = (v, mins) => (mins >= 90 ? (v * 90) / mins : 0);
  // Each metric: [getter, higher is better?]
  const UNDERLYING = {
    1: [[(p) => p90(p.saves, p.mins), true], [(p) => p90(p.xgc - p.gc, p.mins), true], [(p) => p90(p.xgc, p.mins), false], [(p) => p90(p.cs, p.mins), true]],
    2: [[(p) => p90(p.defcon, p.mins), true], [(p) => p90(p.xgc, p.mins), false], [(p) => p90(p.cs, p.mins), true], [(p) => p90(p.xgi, p.mins), true]],
    3: [[(p) => p90(p.xgi, p.mins), true], [(p) => p90(p.creativity, p.mins), true], [(p) => p90(p.threat, p.mins), true], [(p) => p90(p.defcon, p.mins), true]],
    4: [[(p) => p90(p.xg, p.mins), true], [(p) => p90(p.xa, p.mins), true], [(p) => p90(p.threat, p.mins), true]],
  };
  const PERFORMANCE = [[(p) => p90(p.points, p.mins), true], [(p) => p.ppg, true], [(p) => p90(p.bonus, p.mins), true]];

  let table = new Map();

  // Share of the reference values a value beats (0..1), counting ties as half.
  function pct(ref, v, higher = true) {
    if (!ref.length) return 0.5;
    let below = 0, equal = 0;
    for (const r of ref) { if (r === v) equal++; else if (higher ? r < v : r > v) below++; }
    return (below + equal / 2) / ref.length;
  }

  function compute(D, from) {
    table = new Map();
    for (const pos of [1, 2, 3, 4]) {
      const players = D.players.filter((p) => p.pos === pos);
      const fut = new Map(players.map((p) => [p.id, Model.project(p, from, HORIZON).total]));
      const av = new Map(players.map((p) => [p.id, Model.availability(p)]));
      const ref = players.filter((p) => p.mins >= MIN_SAMPLE);
      const refVals = (f) => ref.map(f);
      const metricPct = (metrics, p) => metrics.reduce((a, [f, hi]) => a + pct(refVals(f), f(p), hi), 0) / metrics.length;
      const futRef = refVals((p) => fut.get(p.id)), valRef = refVals((p) => fut.get(p.id) / p.price);
      const minsRef = refVals((p) => av.get(p.id).mins + 30 * av.get(p.id).p60);
      const formRef = refVals((p) => p.form);

      for (const p of players) {
        const conf = Math.min(1, p.mins / FULL_CONFIDENCE);
        const trusted = (x) => conf * x + (1 - conf) * 0.35; // little evidence: assume below average
        const parts = {
          fut: pct(futRef, fut.get(p.id)),
          und: trusted(metricPct(UNDERLYING[pos], p)),
          per: trusted(metricPct(PERFORMANCE, p)),
          frm: pct(formRef, p.form),
          min: pct(minsRef, av.get(p.id).mins + 30 * av.get(p.id).p60),
          val: pct(valRef, fut.get(p.id) / p.price),
        };
        const score = Object.entries(WEIGHTS).reduce((a, [k, w]) => a + w * parts[k], 0);
        const sub = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(1 + v * 98)]));
        table.set(p.id, { ovr: Math.round(45 + 54 * score), ...sub, xpts: fut.get(p.id) });
      }
    }
  }

  const get = (id) => table.get(id);
  const tier = (ovr) => (ovr >= 88 ? "elite" : ovr >= 80 ? "high" : ovr >= 70 ? "mid" : "low");
  return { compute, get, tier, PARTS, WEIGHTS };
})();
