"use strict";

// ---------- data ----------

const POSITIONS = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
const POSITION_NAMES = { 1: "Goalkeeper", 2: "Defender", 3: "Midfielder", 4: "Forward" };
const D = { meta: null, teams: [], players: [], fixtures: [], prices: { dates: [], prices: {} }, myteam: null, advice: null };
const teamById = new Map();
const playerById = new Map();
const historyCache = new Map();
let upcomingByTeam = new Map(); // team id -> [{gw, opp, home, fdr}] in gameweek order

async function getJson(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}
const optionalJson = (path, fallback) => getJson(path).catch(() => fallback);

async function loadData() {
  const [meta, teams, players, fixtures] = await Promise.all(
    ["meta", "teams", "players", "fixtures"].map((n) => getJson(`data/${n}.json`))
  );
  const [prices, myteam, advice] = await Promise.all([
    optionalJson("data/prices.json", D.prices),
    optionalJson("data/myteam.json", null),
    optionalJson("data/advice.json", null),
  ]);
  Object.assign(D, { meta, teams, players, fixtures, prices, myteam, advice });
  teams.forEach((t) => teamById.set(t.id, t));
  players.forEach((p) => playerById.set(p.id, p));
  upcomingByTeam = buildUpcoming();
  Model.init(D, upcomingByTeam);
  Ratings.compute(D, firstUpcomingGw());
}

function firstUpcomingGw() {
  const m = D.meta;
  return m.nextGw ?? (m.currentGw ? m.currentGw + 1 : 1);
}

function buildUpcoming() {
  const start = firstUpcomingGw();
  const map = new Map(D.teams.map((t) => [t.id, []]));
  D.fixtures
    .filter((f) => f.gw && f.gw >= start && !f.finished)
    .sort((a, b) => a.gw - b.gw || String(a.kickoff).localeCompare(String(b.kickoff)))
    .forEach((f) => {
      map.get(f.home)?.push({ gw: f.gw, opp: f.away, home: true, fdr: f.homeFdr });
      map.get(f.away)?.push({ gw: f.gw, opp: f.home, home: false, fdr: f.awayFdr });
    });
  return map;
}

async function playerDetail(id) {
  if (!historyCache.has(id)) {
    historyCache.set(id, getJson(`data/players/${id}.json`).then((d) => (Array.isArray(d) ? { history: d } : d)));
  }
  return historyCache.get(id);
}

// ---------- helpers ----------

const app = document.getElementById("app");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const money = (v) => (v == null ? "–" : `£${v.toFixed(1)}m`);
const dec = (v, n = 1) => (v == null || Number.isNaN(v) ? "–" : Number(v).toFixed(n));
const int = (v) => (v == null ? "–" : Number(v).toLocaleString());
const teamShort = (id) => teamById.get(id)?.short ?? "?";
const teamName = (id) => teamById.get(id)?.name ?? "?";
const signed = (v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));
const per90 = (v, mins) => (v == null || !mins || mins < 90 ? null : (v * 90) / mins);
const teamPill = (id) => `<span class="team-pill">${esc(teamShort(id))}</span>`;
const posTag = (pos) => `<span class="pos pos-${pos}">${POSITIONS[pos]}</span>`;
const shortRank = (r) => (r == null ? "–" : r >= 1e6 ? `${(r / 1e6).toFixed(2)}M` : r >= 1e4 ? `${Math.round(r / 1e3)}K` : r.toLocaleString());

function fdrChip(fx, compact = false) {
  const label = compact ? `${teamShort(fx.opp)}${fx.home ? "" : " (a)"}` : `${teamShort(fx.opp)} (${fx.home ? "H" : "A"})`;
  return `<span class="fdr fdr-${fx.fdr}" title="GW${fx.gw}: ${esc(teamName(fx.opp))} ${fx.home ? "home" : "away"}, difficulty ${fx.fdr}">${esc(label)}</span>`;
}

function statusFlag(p) {
  if (p.status === "a") return "";
  const out = p.status === "i" || p.status === "s" || p.status === "u" || p.chance === 0;
  const text = p.chance != null ? `${p.chance}%` : "!";
  return `<span class="flag ${out ? "out" : ""}" title="${esc(p.news || "Availability doubt")}">${esc(text)}</span>`;
}

function ratingBadge(p, size = "") {
  const r = Ratings.get(p.id);
  return r ? `<span class="ovr ovr-${Ratings.tier(r.ovr)} ${size}" title="Overall rating">${r.ovr}</span>` : "";
}

// Set-piece duties FPL lists for the player (first choice only, to keep tables tidy).
function roleTags(p) {
  const tags = [];
  if (p.penOrder === 1) tags.push(["PEN", "First-choice penalty taker"]);
  if (p.fkOrder === 1) tags.push(["FK", "First-choice direct free kicks"]);
  if (p.cornerOrder === 1) tags.push(["CRN", "First-choice corners and indirect free kicks"]);
  return tags.map(([t, title]) => `<span class="role" title="${title}">${t}</span>`).join("");
}

function emptyState(html) {
  app.innerHTML = `<div class="empty">${html}</div>`;
}

function onRowClick(root) {
  root.addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-id]");
    if (row) location.hash = `#/player/${row.dataset.id}`;
  });
}

const tile = (label, value, sub = "", accent = false) =>
  `<div class="tile ${accent ? "accent" : ""}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;

// Player photos are linked from the Premier League's image server; the shirt shows if one is missing.
function photo(p, size = "") {
  const url = D.meta.photoUrl?.replace("{code}", p.code);
  if (!url) return `<span class="photo ${size} fallback">${shirt(p)}</span>`;
  return `<span class="photo ${size}"><img src="${url}" alt="" loading="lazy" onerror="this.parentNode.classList.add('fallback');this.remove()">${shirt(p)}</span>`;
}

// Primary kit colour per club, for the shirt icons on the My Team pitch.
const KIT = {
  ARS: "#ef0107", AVL: "#670e36", BOU: "#da291c", BRE: "#e30613", BHA: "#0057b8", BUR: "#6c1d45", CHE: "#034694",
  COV: "#59b4e4", CRY: "#1b458f", EVE: "#003399", FUL: "#f2f2f2", HUL: "#f5a12d", IPS: "#3a64a3", LEE: "#f2f2f2",
  LEI: "#003090", LIV: "#c8102e", MCI: "#6cabdd", MUN: "#da291c", NEW: "#241f20", NFO: "#dd0000", SHU: "#ee2737",
  SOU: "#d71920", SUN: "#eb172b", TOT: "#f2f2f2", WHU: "#7a263a", WOL: "#fdb913",
};
function shirt(p) {
  const fill = p.pos === 1 ? "#00ff85" : KIT[teamShort(p.team)] || "#8f7b98";
  return `<svg class="shirt" viewBox="0 0 34 30" aria-hidden="true"><path d="M11 1l-9 5 3 8 4-2v17h16V12l4 2 3-8-9-5c-1 3-3.5 4.5-6 4.5S12 4 11 1z" fill="${fill}" stroke="rgba(0,0,0,0.45)" stroke-width="1"/></svg>`;
}

// ---------- players ----------

const rating = (k) => (p) => Ratings.get(p.id)?.[k] ?? null;
const COLUMNS = {
  price: { label: "Price", get: (p) => p.price, fmt: money },
  ovr: { label: "Rating", get: rating("ovr"), fmt: (v, p) => ratingBadge(p) },
  rFut: { label: "FUT", get: rating("fut") },
  rUnd: { label: "UND", get: rating("und") },
  rPer: { label: "PER", get: rating("per") },
  rFrm: { label: "FRM", get: rating("frm") },
  rMin: { label: "MIN", get: rating("min") },
  rVal: { label: "VAL", get: rating("val") },
  points: { label: "Pts", get: (p) => p.points, hot: true },
  form: { label: "Form", get: (p) => p.form, fmt: (v) => dec(v) },
  ppg: { label: "PPG", get: (p) => p.ppg, fmt: (v) => dec(v) },
  own: { label: "Own %", get: (p) => p.own, fmt: (v) => dec(v) },
  mins: { label: "Mins", get: (p) => p.mins, fmt: int },
  goals: { label: "G", get: (p) => p.goals },
  assists: { label: "A", get: (p) => p.assists },
  xg: { label: "xG", get: (p) => p.xg, fmt: (v) => dec(v, 2) },
  xa: { label: "xA", get: (p) => p.xa, fmt: (v) => dec(v, 2) },
  xgi: { label: "xGI", get: (p) => p.xgi, fmt: (v) => dec(v, 2) },
  xg90: { label: "xG/90", get: (p) => per90(p.xg, p.mins), fmt: (v) => dec(v, 2) },
  xa90: { label: "xA/90", get: (p) => per90(p.xa, p.mins), fmt: (v) => dec(v, 2) },
  xgi90: { label: "xGI/90", get: (p) => per90(p.xgi, p.mins), fmt: (v) => dec(v, 2) },
  threat: { label: "Threat", get: (p) => p.threat, fmt: (v) => dec(v, 0) },
  creativity: { label: "Creativity", get: (p) => p.creativity, fmt: (v) => dec(v, 0) },
  ict: { label: "ICT", get: (p) => p.ict, fmt: (v) => dec(v, 1) },
  bonus: { label: "Bonus", get: (p) => p.bonus },
  cs: { label: "CS", get: (p) => p.cs },
  gc: { label: "GC", get: (p) => p.gc },
  xgc: { label: "xGC", get: (p) => p.xgc, fmt: (v) => dec(v, 2) },
  defcon: { label: "Def. contr.", get: (p) => p.defcon },
  cbi: { label: "CBI", get: (p) => p.cbi },
  tackles: { label: "Tackles", get: (p) => p.tackles },
  recoveries: { label: "Recov.", get: (p) => p.recoveries },
  saves: { label: "Saves", get: (p) => p.saves },
  ptsPerM: { label: "Pts/£m", get: (p) => p.points / p.price, fmt: (v) => dec(v, 1) },
  formPerM: { label: "Form/£m", get: (p) => p.form / p.price, fmt: (v) => dec(v, 2) },
  net: { label: "Net transfers", get: (p) => p.transfersIn - p.transfersOut, fmt: (v) => `<span class="${v > 0 ? "up" : v < 0 ? "down" : ""}">${v > 0 ? "+" : ""}${v.toLocaleString()}</span>` },
};
const VIEWS = {
  overview: { label: "Overview", cols: ["price", "ovr", "points", "form", "ppg", "own", "mins", "goals", "assists", "xgi", "bonus"], next: true, sort: "points" },
  attack: { label: "Attack", cols: ["price", "points", "goals", "xg", "xg90", "assists", "xa", "xa90", "xgi90", "threat", "creativity", "ict"], sort: "xgi90" },
  defence: { label: "Defence", cols: ["price", "points", "cs", "gc", "xgc", "defcon", "cbi", "tackles", "recoveries", "saves"], sort: "defcon" },
  ratings: { label: "Ratings", cols: ["price", "ovr", "rFut", "rUnd", "rPer", "rFrm", "rMin", "rVal", "points"], sort: "ovr" },
  value: { label: "Value", cols: ["price", "points", "ptsPerM", "ppg", "form", "formPerM", "xgi90", "own", "net"], next: true, sort: "ptsPerM" },
};
const NAME_SORTS = { name: (p) => p.name, team: (p) => teamShort(p.team), pos: (p) => p.pos };

const playerView = { view: "overview", q: "", pos: "", team: "", maxPrice: "", minMins: "", sort: "points", asc: false };

function renderPlayers() {
  const teamOptions = [...D.teams].sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("");
  app.innerHTML = `
    <div class="eyebrow">Season ${D.meta.season ? `${D.meta.season}/${String(D.meta.season + 1).slice(2)}` : ""} · Gameweek ${D.meta.currentGw ?? "–"}</div>
    <h1>Player database</h1>
    <p class="lede">Every Premier League player in FPL. Switch views for attacking, defensive and value stats; click a player for their full profile.</p>
    <div class="filters">
      <div class="segmented" id="views">${Object.entries(VIEWS).map(([k, v]) =>
        `<button data-view="${k}" class="${k === playerView.view ? "on" : ""}">${v.label}</button>`).join("")}</div>
    </div>
    <div class="filters">
      <label>Search<input type="search" id="f-q" placeholder="Player name"></label>
      <label>Position<select id="f-pos"><option value="">All</option>${
        Object.entries(POSITIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <label>Team<select id="f-team"><option value="">All</option>${teamOptions}</select></label>
      <label>Max price (£m)<input type="number" id="f-price" min="3.5" max="16" step="0.5"></label>
      <label>Min minutes<input type="number" id="f-mins" min="0" step="90"></label>
      <span class="count" id="count"></span>
    </div>
    <div class="table-wrap"><table>
      <thead id="head"></thead>
      <tbody id="rows"></tbody>
    </table></div>`;

  const bind = (id, key) => {
    const el = document.getElementById(id);
    el.value = playerView[key];
    el.addEventListener("input", () => { playerView[key] = el.value; fillPlayerRows(); });
  };
  bind("f-q", "q"); bind("f-pos", "pos"); bind("f-team", "team"); bind("f-price", "maxPrice"); bind("f-mins", "minMins");

  document.getElementById("views").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (!b) return;
    playerView.view = b.dataset.view;
    playerView.sort = VIEWS[b.dataset.view].sort;
    playerView.asc = false;
    document.querySelectorAll("#views button").forEach((x) => x.classList.toggle("on", x === b));
    fillPlayerRows();
  });
  document.getElementById("head").addEventListener("click", (e) => {
    const th = e.target.closest("th.sortable");
    if (!th) return;
    const key = th.dataset.key;
    if (playerView.sort === key) playerView.asc = !playerView.asc;
    else { playerView.sort = key; playerView.asc = key in NAME_SORTS; }
    fillPlayerRows();
  });
  onRowClick(document.getElementById("rows"));
  fillPlayerRows();
}

function fillPlayerRows() {
  const v = playerView;
  const view = VIEWS[v.view];
  const q = v.q.trim().toLowerCase();
  const getter = NAME_SORTS[v.sort] || COLUMNS[v.sort]?.get || COLUMNS.points.get;
  const rows = D.players.filter((p) =>
    (!q || p.name.toLowerCase().includes(q) || p.full.toLowerCase().includes(q)) &&
    (!v.pos || p.pos === +v.pos) &&
    (!v.team || p.team === +v.team) &&
    (!v.maxPrice || p.price <= +v.maxPrice) &&
    (!v.minMins || p.mins >= +v.minMins)
  ).sort((a, b) => {
    const x = getter(a), y = getter(b);
    if (x == null || y == null) return (x == null) - (y == null);
    const cmp = typeof x === "string" ? x.localeCompare(y) : x - y;
    return (v.asc ? cmp : -cmp) || b.points - a.points;
  });

  const th = (key, label, left) =>
    `<th class="sortable ${left ? "left" : ""} ${v.sort === key ? `sorted ${v.asc ? "asc" : ""}` : ""}" data-key="${key}">${label}</th>`;
  document.getElementById("head").innerHTML = `<tr><th class="rank">#</th>${th("name", "Player", true)}${th("team", "Team", true)}${th("pos", "Pos", true)}${
    view.cols.map((k) => th(k, COLUMNS[k].label)).join("")}${view.next ? '<th class="left">Next 3</th>' : ""}</tr>`;
  document.getElementById("count").textContent = `${rows.length} of ${D.players.length} players`;
  document.getElementById("rows").innerHTML = rows.slice(0, 400).map((p, i) => `
    <tr class="clickable" data-id="${p.id}">
      <td class="rank">${i + 1}</td>
      <td class="name left"><span class="who">${photo(p, "sm")}${esc(p.name)}${statusFlag(p)}${roleTags(p)}</span></td>
      <td class="left">${teamPill(p.team)}</td>
      <td class="left">${posTag(p.pos)}</td>
      ${view.cols.map((k) => {
        const c = COLUMNS[k], val = c.get(p);
        return `<td class="${k === v.sort || c.hot ? "hot" : ""}">${val == null ? '<span class="muted">–</span>' : c.fmt ? c.fmt(val, p) : val}</td>`;
      }).join("")}
      ${view.next ? `<td class="left">${(upcomingByTeam.get(p.team) || []).slice(0, 3).map((fx) => fdrChip(fx)).join("")}</td>` : ""}
    </tr>`).join("") + (rows.length > 400 ? `<tr><td colspan="99" class="muted left">Showing the top 400 – filter to narrow it down.</td></tr>` : "");
}

// ---------- percentiles ----------

const MIN_PEER_MINS = 450;
const M = {
  xg90: { label: "xG", get: (p) => per90(p.xg, p.mins) },
  xa90: { label: "xA", get: (p) => per90(p.xa, p.mins) },
  threat90: { label: "Threat", get: (p) => per90(p.threat, p.mins) },
  creativity90: { label: "Creativity", get: (p) => per90(p.creativity, p.mins) },
  influence90: { label: "Influence", get: (p) => per90(p.influence, p.mins) },
  xgi90: { label: "xGI", get: (p) => per90(p.xgi, p.mins) },
  defcon90: { label: "Def. contributions", get: (p) => per90(p.defcon, p.mins) },
  cbi90: { label: "Clear/block/int", get: (p) => per90(p.cbi, p.mins) },
  tackles90: { label: "Tackles", get: (p) => per90(p.tackles, p.mins) },
  rec90: { label: "Recoveries", get: (p) => per90(p.recoveries, p.mins) },
  xgc90: { label: "xG conceded", get: (p) => per90(p.xgc, p.mins), lowerBetter: true },
  saves90: { label: "Saves", get: (p) => per90(p.saves, p.mins) },
  cs90: { label: "Clean sheets", get: (p) => per90(p.cs, p.mins) },
  pts90: { label: "FPL points", get: (p) => per90(p.points, p.mins) },
  bps90: { label: "BPS", get: (p) => per90(p.bps, p.mins) },
};
const METRICS_BY_POS = {
  1: ["saves90", "xgc90", "cs90", "pts90", "bps90"],
  2: ["xgi90", "defcon90", "cbi90", "tackles90", "rec90", "xgc90", "bps90", "pts90"],
  3: ["xg90", "xa90", "threat90", "creativity90", "influence90", "defcon90", "bps90", "pts90"],
  4: ["xg90", "xa90", "threat90", "creativity90", "influence90", "bps90", "pts90"],
};

function percentiles(p) {
  const peers = D.players.filter((x) => x.pos === p.pos && x.mins >= MIN_PEER_MINS);
  return METRICS_BY_POS[p.pos].map((key) => {
    const m = M[key];
    const value = m.get(p);
    if (value == null) return null;
    const vals = peers.map(m.get).filter((v) => v != null);
    if (vals.length < 5) return null;
    const below = vals.filter((v) => (m.lowerBetter ? v > value : v < value)).length;
    const equal = vals.filter((v) => v === value).length;
    return { key, label: m.label, value, pct: Math.round(((below + equal / 2) / vals.length) * 100), m, peers: vals.length };
  }).filter(Boolean);
}

function percentilePanel(p) {
  const rows = percentiles(p);
  if (!rows.length) return '<div class="empty">Not enough minutes this season for comparisons.</div>';
  return `<div class="pct-list">${rows.map((r) => `
    <div class="pct-row ${r.pct < 35 ? "low" : ""}" title="${r.pct}th percentile among ${r.peers} ${POSITIONS[p.pos]}s">
      <span class="lab">${r.label}<span class="muted"> /90</span></span>
      <div class="pct-track"><div class="pct-fill" style="width:${Math.max(2, r.pct)}%"></div></div>
      <span class="val"><b>${r.pct}</b><small>${dec(r.value, 2)}</small></span>
    </div>`).join("")}</div>
    <p class="note">Percentile against ${POSITIONS[p.pos]}s with ${MIN_PEER_MINS}+ minutes (the big number; 50 is average). The small number is the raw rate.${
      p.mins < MIN_PEER_MINS ? " This player has fewer minutes than that, so treat these with care." : ""}</p>`;
}

// ---------- output panels ----------

function attackSummary(p) {
  const kv = (label, value, cls = "") => `<div><span>${label}</span><b class="${cls}">${value}</b></div>`;
  const diff = (a, b) => kv(`${a.label} − ${b.label}`, signed(a.v - b.v), a.v - b.v >= 0 ? "up" : "down");
  return `<div class="kv">
    ${kv("Goals", p.goals)}${kv("xG", dec(p.xg, 2))}
    ${kv("Assists", p.assists)}${kv("xA", dec(p.xa, 2))}
    ${diff({ label: "Goals", v: p.goals }, { label: "xG", v: p.xg })}${diff({ label: "Assists", v: p.assists }, { label: "xA", v: p.xa })}
    ${kv("Threat", dec(p.threat, 0))}${kv("Creativity", dec(p.creativity, 0))}
  </div>
  <p class="note">Above zero means scoring or assisting more than the chances suggest, which often cools off; below zero can mean returns are due. Threat and creativity are FPL's ratings of shooting and chance-creating positions.</p>`;
}

function keeperSummary(p) {
  const prevented = p.xgc - p.gc;
  return `<div class="kv">
    <div><span>Saves</span><b>${p.saves}</b></div>
    <div><span>Saves /90</span><b>${dec(per90(p.saves, p.mins), 2)}</b></div>
    <div><span>Goals conceded</span><b>${p.gc}</b></div>
    <div><span>xG conceded</span><b>${dec(p.xgc, 2)}</b></div>
    <div><span>Goals prevented</span><b class="${prevented >= 0 ? "up" : "down"}">${signed(prevented)}</b></div>
    <div><span>Clean sheets</span><b>${p.cs}</b></div>
  </div>
  <p class="note">Goals prevented is xG conceded minus goals conceded: positive means the keeper is saving more than expected (it includes the defence's xG, so it's a rough guide).</p>`;
}

// ---------- player page ----------

const GOAL_POINTS = { 1: 10, 2: 6, 3: 5, 4: 4 };
const CLEAN_SHEET_POINTS = { 1: 4, 2: 4, 3: 1, 4: 0 };
const DEFCON_THRESHOLD = { 2: 10, 3: 12, 4: 12 };

// Rebuilds a season's points from FPL's scoring rules; anything the rules don't explain lands in `other`.
function pointsBreakdown(p, history) {
  const s = { appearances: 0, goals: 0, assists: 0, cleanSheets: 0, saves: 0, defcon: 0, bonus: 0, deductions: 0 };
  for (const h of history) {
    if (!h.mins) continue;
    s.appearances += h.mins >= 60 ? 2 : 1;
    s.goals += h.goals * GOAL_POINTS[p.pos];
    s.assists += h.assists * 3;
    s.cleanSheets += h.cs * CLEAN_SHEET_POINTS[p.pos];
    if (p.pos === 1) s.saves += Math.floor((h.saves ?? 0) / 3) + 5 * (h.pensSaved ?? 0);
    else if ((h.defcon ?? 0) >= DEFCON_THRESHOLD[p.pos]) s.defcon += 2;
    s.bonus += h.bonus;
    s.deductions -= (p.pos <= 2 ? Math.floor((h.gc ?? 0) / 2) : 0) + (h.yellow ?? 0) + 3 * (h.red ?? 0) + 2 * (h.ownGoals ?? 0) + 2 * (h.pensMissed ?? 0);
  }
  const total = history.reduce((a, h) => a + h.points, 0);
  const known = Object.values(s).reduce((a, v) => a + v, 0);
  return { ...s, other: total - known, total };
}

function breakdownPanel(container, p, history) {
  const b = pointsBreakdown(p, history);
  const parts = [
    { label: "Appearances", value: b.appearances, color: SERIES[0] },
    { label: "Goals", value: b.goals, color: SERIES[1] },
    { label: "Assists", value: b.assists, color: SERIES[2] },
    { label: "Clean sheets", value: b.cleanSheets, color: SERIES[3] },
    p.pos === 1 ? { label: "Saves", value: b.saves, color: SERIES[4] } : { label: "Def. contributions", value: b.defcon, color: SERIES[5] },
    { label: "Bonus", value: b.bonus, color: SERIES[6] },
  ];
  Charts.stacked(container, parts, {});
  container.insertAdjacentHTML("beforeend", `<p class="note">${b.total} points in total.${
    b.deductions ? ` Deductions (cards, goals conceded, own goals, missed penalties): <span class="down">${b.deductions}</span>.` : ""}${
    b.other ? ` ${b.other > 0 ? "+" : ""}${b.other} not explained by the standard scoring rules.` : ""}</p>`);
}

const TREND_METRICS = {
  1: [["saves", "Saves"], ["xgc", "xG conceded"], ["bps", "BPS"], ["mins", "Minutes"]],
  2: [["defcon", "Def. contributions"], ["xgi", "xGI"], ["bps", "BPS"], ["mins", "Minutes"]],
  3: [["xgi", "xGI"], ["ict", "ICT index"], ["bps", "BPS"], ["mins", "Minutes"]],
  4: [["xgi", "xGI"], ["ict", "ICT index"], ["bps", "BPS"], ["mins", "Minutes"]],
};

const ORDINAL = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th" };
function setPieceChips(p) {
  return [["penOrder", "Penalties"], ["fkOrder", "Direct free kicks"], ["cornerOrder", "Corners"]]
    .filter(([k]) => p[k]).map(([k, label]) => `<span class="chip role-chip">${label}: ${ORDINAL[p[k]] || `#${p[k]}`} choice</span>`).join("");
}

function projectionTable(p) {
  const from = firstUpcomingGw();
  const proj = Model.project(p, from, HORIZON);
  const av = proj.av;
  const rows = proj.byGw.flatMap((g) => g.detail.length ? g.detail.map((d) => ({ gw: g.gw, ...d })) : [{ gw: g.gw, blank: true }]);
  const f1 = (v) => (Math.abs(v) < 0.05 ? '<span class="muted">0</span>' : dec(v, 1));
  const gk = p.pos === 1;
  const pen = Model.penaltyShare(p);
  return `<div class="table-wrap"><table class="proj">
    <thead><tr><th>GW</th><th class="left">Opponent</th><th>Team xG</th><th>Opp. xG</th><th>Clean sheet</th>
      <th>Appear.</th><th>Goals</th><th>Assists</th><th>Pens</th><th>CS</th><th>${gk ? "Saves" : "Def. contr."}</th><th>Bonus</th><th>Conceded &amp; cards</th><th>xPts</th></tr></thead>
    <tbody>${rows.map((r) => r.blank
      ? `<tr><td>${r.gw}</td><td class="left muted" colspan="13">No fixture (blank gameweek)</td></tr>`
      : `<tr><td>${r.gw}</td><td class="left">${fdrChip(r.fx)}</td>
        <td>${dec(r.goals?.scored, 2)}</td><td>${dec(r.goals?.conceded, 2)}</td><td>${r.goals ? `${Math.round(r.goals.csProb * 100)}%` : "–"}</td>
        <td>${f1(r.parts.appearance)}</td><td>${f1(r.parts.goals)}</td><td>${f1(r.parts.assists)}</td><td>${f1(r.parts.penalties)}</td>
        <td>${f1(r.parts.cleanSheet)}</td><td>${f1(gk ? r.parts.saves : r.parts.defcon)}</td><td>${f1(r.parts.bonus)}</td>
        <td>${f1(r.parts.conceded + r.parts.cards)}</td><td class="hot">${dec(r.total, 1)}</td></tr>`).join("")}
      <tr class="total"><td colspan="13" class="left">Total, gameweeks ${from}–${from + HORIZON - 1}</td><td class="hot">${dec(proj.total, 1)}</td></tr>
    </tbody></table></div>
  <p class="note">Expected ${Math.round(av.mins)} minutes a match, ${Math.round(av.p60 * 100)}% chance of playing 60+ (recent starts count more than the season)${
    av.fit < 1 ? `, adjusted for a ${Math.round(av.fit * 100)}% chance of being fit` : ""}.
    Team and opponent xG come from each side's home or away record, weighted toward recent matches.${
    pen ? ` On penalties: expects to take ${Math.round(pen * 100)}% of the team's spot kicks.` : ""}
    Corners and free kicks are already in a player's xG and xA.</p>`;
}

function cumulative(values) {
  let run = 0;
  return values.map((v) => +(run += v).toFixed(2));
}

async function renderPlayer(id) {
  const p = playerById.get(id);
  if (!p) return emptyState(`No player with id ${esc(id)}. <a href="#/players">Back to players</a>`);
  const upcoming = (upcomingByTeam.get(p.team) || []).slice(0, 6);
  const rankIn = (key) => 1 + D.players.filter((x) => x.pos === p.pos && x[key] > p[key]).length;
  const posTiles = p.pos === 1
    ? tile("Saves", p.saves, `${dec(per90(p.saves, p.mins), 1)} per 90`) + tile("Clean sheets", p.cs)
    : p.pos === 2
      ? tile("Def. contributions", p.defcon, `${dec(per90(p.defcon, p.mins), 1)} per 90`) + tile("Clean sheets", p.cs)
      : tile("xG / xA", `${dec(p.xg, 1)} / ${dec(p.xa, 1)}`, `${dec(per90(p.xgi, p.mins), 2)} xGI per 90`) + tile("ICT index", dec(p.ict, 1));

  app.innerHTML = `
    <a class="back" href="#/players">← All players</a>
    <section class="hero">
      <div class="hero-top">
        <div class="hero-id">
          ${ratingCard(p)}
          ${photo(p, "xl")}
          <div>
            <div class="eyebrow">${POSITION_NAMES[p.pos]} · ${esc(teamName(p.team))}</div>
            <h1><small>${esc(p.first)}</small>${esc(p.last)}${statusFlag(p)}</h1>
            <div class="meta">
              <span class="chip">Selected by ${dec(p.own)}%</span>
              <span class="chip">#${rankIn("points")} ${POSITIONS[p.pos]} by points</span>
              <span class="chip">#${rankIn("form")} ${POSITIONS[p.pos]} by form</span>
              ${setPieceChips(p)}
            </div>
          </div>
        </div>
        <div class="price">
          <div class="big">${money(p.price)}</div>
          <div class="${p.changeStart > 0 ? "up" : p.changeStart < 0 ? "down" : "muted"}">${signed(p.changeStart)} this season</div>
        </div>
      </div>
      ${p.news ? `<div class="news">⚠ ${esc(p.news)}</div>` : ""}
      <div class="tiles">
        ${tile("Total points", p.points, `${dec(p.ppg)} per game`, true)}
        ${tile("Form", dec(p.form), "avg points, last 30 days")}
        ${tile("Minutes", int(p.mins), `${p.starts} starts`)}
        ${tile("Goals + assists", p.goals + p.assists, `${p.goals}G · ${p.assists}A`)}
        ${posTiles}
        ${tile("Bonus", p.bonus, `${p.bps} BPS`)}
      </div>
      <h2>Next fixtures</h2>
      <div class="legend">${upcoming.length ? upcoming.map((fx) => `<span class="muted">GW${fx.gw}</span>${fdrChip(fx)}`).join("&nbsp;") : '<span class="muted">None scheduled</span>'}</div>
    </section>

    <div class="grid-2">
      <section><h2>Percentile profile</h2><div class="panel pad">${percentilePanel(p)}</div></section>
      <section><h2>${p.pos === 1 ? "Goalkeeping" : "Attacking output"}</h2><div class="panel pad">
        ${p.pos === 1 ? keeperSummary(p) : attackSummary(p)}</div></section>
    </div>
    <h2>Projection · next ${HORIZON} gameweeks</h2>
    ${projectionTable(p)}
    <div id="history"><p class="muted">Loading gameweek history…</p></div>`;

  let detail;
  try { detail = await playerDetail(id); } catch {
    document.getElementById("history").innerHTML = '<div class="empty">No gameweek history saved for this player yet.</div>';
    return;
  }
  if (location.hash !== `#/player/${id}`) return; // navigated away while loading

  const history = detail.history;
  const el = document.getElementById("history");
  if (!history.length) { el.innerHTML = '<h2>Gameweek history</h2><div class="empty">No games played yet this season.</div>'; return; }
  const trends = TREND_METRICS[p.pos];
  const owned = D.meta.totalPlayers && history.some((h) => h.selected);

  el.innerHTML = `
    <h2>Where the points come from</h2>
    <div class="panel pad" id="breakdown"></div>
    <div class="grid-2">
      <section><h2>Points per gameweek</h2><div class="panel pad chart"><div id="points-chart"></div></div></section>
      <section><h2>${p.pos === 1 ? "Goals conceded vs xG conceded" : "Goals vs xG"}, cumulative</h2><div class="panel pad chart"><div id="cum-chart"></div></div></section>
    </div>
    <h2>Gameweek trends</h2>
    <div class="multiples wide">${trends.map(([key, label]) =>
      `<div class="panel pad chart"><h3>${label}</h3><div id="trend-${key}"></div></div>`).join("")}</div>
    <div class="grid-2">
      <section><h2>Price</h2><div class="panel pad chart"><div id="price-chart"></div></div></section>
      ${owned ? '<section><h2>Ownership</h2><div class="panel pad chart"><div id="own-chart"></div></div></section>' : ""}
    </div>
    <h2>Every game</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>GW</th><th class="left">Opponent</th><th>Result</th><th>Pts</th><th>Mins</th><th>G</th><th>A</th><th>xG</th><th>xA</th><th>CS</th>
        ${p.pos === 1 ? "<th>Saves</th>" : "<th>Def. contr.</th>"}<th>ICT</th><th>Bonus</th><th>BPS</th><th>Price</th></tr></thead>
      <tbody>${[...history].reverse().map((h) => `
        <tr><td>${h.gw}</td><td class="left">${teamPill(h.opp)} <span class="muted">${h.home ? "H" : "A"}</span></td>
          <td>${esc(h.score ?? "–")}</td><td class="hot">${h.points}</td><td>${h.mins}</td><td>${h.goals}</td><td>${h.assists}</td>
          <td>${dec(h.xg, 2)}</td><td>${dec(h.xa, 2)}</td><td>${h.cs}</td><td>${p.pos === 1 ? h.saves ?? 0 : h.defcon ?? 0}</td>
          <td>${dec(h.ict, 1)}</td><td>${h.bonus}</td><td>${h.bps ?? "–"}</td><td>${money(h.price)}</td></tr>`).join("")}
      </tbody></table></div>`;

  const tip = (h) => `<b>GW${h.gw}</b> ${h.home ? "vs" : "at"} ${esc(teamShort(h.opp))}<br>`;
  const gws = history.map((h) => h.gw);
  breakdownPanel(document.getElementById("breakdown"), p, history);
  Charts.bars(document.getElementById("points-chart"), history, {
    label: (h) => h.gw, value: (h) => h.points, dim: (h) => h.mins === 0,
    tooltip: (h) => `${tip(h)}${h.points} pts · ${h.mins} mins`,
  });
  const [actualKey, expectedKey, actualName, expectedName] = p.pos === 1 ? ["gc", "xgc", "Conceded", "xG conceded"] : ["goals", "xg", "Goals", "xG"];
  const actual = cumulative(history.map((h) => h[actualKey] ?? 0));
  const expected = cumulative(history.map((h) => h[expectedKey] ?? 0));
  Charts.lines(document.getElementById("cum-chart"), {
    labels: gws, fromZero: true, tickFmt: (v) => (Number.isInteger(v) ? v : v.toFixed(1)),
    series: [{ name: actualName, values: actual, color: SERIES[1] }, { name: expectedName, values: expected, color: SERIES[0] }],
    tooltip: (i) => `${tip(history[i])}${actualName} ${actual[i]} · ${expectedName} ${expected[i].toFixed(2)}`,
  });
  trends.forEach(([key, label]) => Charts.bars(document.getElementById(`trend-${key}`), history, {
    label: (h) => h.gw, value: (h) => h[key] ?? 0, h: 190, w: 460, tickFmt: (v) => (Number.isInteger(v) ? v : v.toFixed(1)),
    tooltip: (h) => `${tip(h)}${label}: ${Number.isInteger(h[key]) ? h[key] : dec(h[key], 2)}`,
  }));
  Charts.lines(document.getElementById("price-chart"), {
    labels: gws, series: [{ name: "Price", values: history.map((h) => h.price) }], pad: 0.1, minStep: 0.1,
    tickFmt: (v) => v.toFixed(1), tooltip: (i) => `${tip(history[i])}${money(history[i].price)}`,
  });
  if (owned) {
    const pct = history.map((h) => (h.selected / D.meta.totalPlayers) * 100);
    Charts.lines(document.getElementById("own-chart"), {
      labels: gws, series: [{ name: "Ownership", values: pct }], tickFmt: (v) => `${dec(v, v < 10 ? 1 : 0)}%`,
      tooltip: (i) => `${tip(history[i])}Owned by ${dec(pct[i])}% · net transfers ${history[i].transfers > 0 ? "+" : ""}${(history[i].transfers ?? 0).toLocaleString()}`,
    });
  }
}

// ---------- my team ----------

const planKey = () => `fplhub.plan.${D.myteam.id}.${D.myteam.gw}`;
function loadPlan() {
  try { return JSON.parse(localStorage.getItem(planKey())) || {}; } catch { return {}; }
}
function savePlan(plan) {
  try { localStorage.setItem(planKey(), JSON.stringify(plan)); } catch { /* storage unavailable */ }
}
const teamView = { selected: null, q: "" };

function renderMyTeam() {
  const t = D.myteam;
  if (!t) {
    return emptyState(`<h2 style="justify-content:center">Add your FPL team</h2>
      <p>Put your FPL team ID in <code>config.json</code> in the repo, for example <code>{"teamId": 1234567}</code>, and commit it.<br>
      The next update loads your squad, points and rank. Find the ID in the address bar when you view your Points page on the FPL site.</p>
      <p><a href="https://github.com/rfeasey1213/fpl-hub/edit/main/config.json" target="_blank" rel="noopener">Edit config.json on GitHub ↗</a></p>`);
  }
  if (!t.picks.length) return emptyState("Your team has no picks yet for this gameweek.");

  const plan = loadPlan(); // slot -> new player id
  const original = new Map(t.picks.map((pk) => [pk.slot, pk]));
  const squad = t.picks.map((pk) => ({ slot: pk.slot, pick: pk, p: playerById.get(plan[pk.slot] ?? pk.id), changed: plan[pk.slot] != null }))
    .filter((s) => s.p);
  const bank = t.bank + Object.entries(plan).reduce((sum, [slot, inId]) =>
    sum + (playerById.get(original.get(+slot).id)?.price ?? 0) - (playerById.get(inId)?.price ?? 0), 0);
  const last = t.history[t.history.length - 1];
  const prev = t.history[t.history.length - 2];
  const rankMove = last && prev && last.overallRank && prev.overallRank ? prev.overallRank - last.overallRank : null;
  const card = (s) => {
    const p = s.p;
    const next = (upcomingByTeam.get(p.team) || [])[0];
    const real = !s.changed;
    const pts = real ? s.pick.gwPoints * Math.max(1, s.pick.multiplier) : null;
    return `<div class="card ${teamView.selected === s.slot ? "selected" : ""} ${s.changed ? "new" : ""}" data-slot="${s.slot}" title="${esc(p.full)}">
      ${real && s.pick.captain ? `<span class="badge">${t.activeChip === "3xc" ? "3x" : "C"}</span>` : real && s.pick.vice ? '<span class="badge vice">V</span>' : ""}
      ${statusFlag(p)}
      ${photo(p, "card-photo")}
      <div class="nm">${esc(p.name)}</div>
      <div class="sub">${ratingBadge(p, "xs")} ${next ? fdrChip(next, true) : '<span class="muted">–</span>'}</div>
      <div class="pts">${real ? `${pts} pts` : `form ${dec(p.form)}`}</div>
    </div>`;
  };
  const starters = squad.filter((s) => s.slot <= 11);
  const bench = squad.filter((s) => s.slot > 11);
  const rows = [1, 2, 3, 4].map((pos) => starters.filter((s) => s.p.pos === pos && s.pick.slot <= 11 && playerById.get(original.get(s.slot).id)?.pos === pos));

  app.innerHTML = `
    <section class="hero">
      <div class="hero-top">
        <div>
          <div class="eyebrow">My team · Gameweek ${t.gw}${t.activeChip ? ` · ${esc(chipName(t.activeChip))} active` : ""}</div>
          <h1>${esc(t.name)}</h1>
          <div class="meta"><span class="chip">${esc(t.manager)}</span>
            <a class="chip" href="https://fantasy.premierleague.com/entry/${t.id}/event/${t.gw}" target="_blank" rel="noopener">View on FPL ↗</a></div>
        </div>
        <div class="price">
          <div class="muted">Overall rank</div>
          <div class="big">${shortRank(t.overallRank)}</div>
          ${rankMove != null ? `<div class="${rankMove >= 0 ? "up" : "down"}">${rankMove >= 0 ? "▲" : "▼"} ${Math.abs(rankMove).toLocaleString()} last GW</div>` : ""}
        </div>
      </div>
      <div class="tiles">
        ${tile(`GW${t.gw} points`, t.gwPoints, t.gwRank ? `rank ${shortRank(t.gwRank)}` : "", true)}
        ${tile("Total points", int(t.overallPoints))}
        ${tile("Team value", money(t.value))}
        ${tile("In the bank", money(t.bank))}
        ${tile("Points on bench", last?.bench ?? "–", "last gameweek")}
        ${tile("Hits taken", `-${t.history.reduce((a, h) => a + h.hits, 0)}`, "points this season")}
      </div>
    </section>

    <h2>Squad &amp; transfer planner</h2>
    <div class="squad-layout">
      <div class="squad-pitch">
        <svg class="markings" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <g fill="none" stroke="rgba(4,245,255,0.18)" stroke-width="0.4" vector-effect="non-scaling-stroke">
            <rect x="3" y="2" width="94" height="96" rx="1"></rect><rect x="28" y="2" width="44" height="13"></rect>
            <line x1="3" y1="60" x2="97" y2="60"></line></g></svg>
        ${rows.map((r) => `<div class="squad-row">${r.map(card).join("")}</div>`).join("")}
        <div class="bench"><div class="bench-label">Bench</div><div class="squad-row">${bench.map(card).join("")}</div></div>
      </div>
      <div class="panel pad plan-box" id="planner"></div>
    </div>

    <h2>Assistant</h2>
    <p class="lede" style="margin-bottom:12px">Suggestions from this site's projection model (the same one behind the Moneyball page), based on your squad including any planned transfers.</p>
    <div id="assistant"></div>
    <h2>Claude's take</h2>
    ${claudeHtml()}

    <div class="grid-2">
      <section><h2>Overall rank</h2><div class="panel pad chart"><div id="rank-chart"></div></div></section>
      <section><h2>Your points vs the average</h2><div class="panel pad chart"><div id="gw-chart"></div></div></section>
    </div>
    <div class="grid-2">
      <section><h2>Season points by player</h2><div class="panel pad"><div id="squad-bars"></div></div></section>
      <section><h2>Team value &amp; bench points</h2>
        <div class="panel pad chart"><h3>Team value</h3><div id="value-chart"></div></div>
        <div class="panel pad chart" style="margin-top:16px"><h3>Points left on the bench</h3><div id="bench-chart"></div></div></section>
    </div>
    <h2>Chips</h2>
    <div class="legend">${["wildcard", "freehit", "bboost", "3xc"].map((c) => {
      const used = t.chips.filter((x) => x.name === c);
      return `<span class="chip">${chipName(c)}: ${used.length ? `<span class="muted">used GW${used.map((u) => u.gw).join(", GW")}</span>` : '<span class="up">available</span>'}</span>`;
    }).join("")}</div>`;

  renderPlanner(squad, plan, bank, original);
  const assistant = document.getElementById("assistant");
  assistant.innerHTML = assistantHtml(assistantAdvice(t, squad, bank, t.picks.find((pk) => pk.captain)?.id));
  assistant.addEventListener("click", (e) => {
    const b = e.target.closest("[data-suggest]");
    if (!b) return;
    const [slot, id] = b.dataset.suggest.split(":").map(Number);
    plan[slot] = id;
    savePlan(plan);
    renderMyTeam();
    document.getElementById("planner").scrollIntoView({ behavior: "smooth" });
  });
  app.querySelector(".squad-pitch").addEventListener("click", (e) => {
    const c = e.target.closest(".card");
    if (!c) return;
    teamView.selected = teamView.selected === +c.dataset.slot ? null : +c.dataset.slot;
    teamView.q = "";
    renderMyTeam();
    // On narrow screens the replacement list sits below the pitch.
    if (teamView.selected && innerWidth < 900) document.getElementById("planner").scrollIntoView({ behavior: "smooth" });
  });

  const hist = t.history.filter((h) => h.overallRank);
  if (hist.length) {
    Charts.lines(document.getElementById("rank-chart"), {
      labels: hist.map((h) => h.gw), series: [{ name: "Rank", values: hist.map((h) => h.overallRank) }], invert: true, tickFmt: shortRank,
      tooltip: (i) => `<b>GW${hist[i].gw}</b><br>Rank ${hist[i].overallRank.toLocaleString()}`,
    });
  }
  const avgByGw = new Map((D.meta.events || []).map((e) => [e.gw, e.average]));
  const mine = t.history.map((h) => h.points);
  const avg = t.history.map((h) => avgByGw.get(h.gw) ?? null);
  Charts.lines(document.getElementById("gw-chart"), {
    labels: t.history.map((h) => h.gw), fromZero: true,
    series: [{ name: "You", values: mine, color: SERIES[0] }, { name: "Average", values: avg, color: SERIES[1] }],
    tooltip: (i) => { const h = t.history[i]; return `<b>GW${h.gw}</b><br>You ${h.points}${h.hits ? ` (−${h.hits} hit)` : ""} · average ${avg[i] ?? "–"}`; },
  });
  Charts.hbars(document.getElementById("squad-bars"),
    squad.map((s) => s.p).sort((a, b) => b.points - a.points).map((p) => ({
      label: `<span class="who">${photo(p, "sm")}${esc(p.name)}</span>`, sub: `${teamShort(p.team)} · ${POSITIONS[p.pos]}`, value: p.points, id: p.id })),
    { onClick: (r) => { location.hash = `#/player/${r.id}`; } });
  Charts.lines(document.getElementById("value-chart"), {
    labels: t.history.map((h) => h.gw), series: [{ name: "Value", values: t.history.map((h) => h.value) }], h: 160, pad: 0.1, minStep: 0.1,
    tickFmt: (v) => v.toFixed(1), tooltip: (i) => `<b>GW${t.history[i].gw}</b><br>Value ${money(t.history[i].value)} · bank ${money(t.history[i].bank)}`,
  });
  Charts.bars(document.getElementById("bench-chart"), t.history, {
    label: (h) => h.gw, value: (h) => h.bench, h: 150, color: SERIES[1],
    tooltip: (h) => `<b>GW${h.gw}</b><br>${h.bench} pts on the bench`,
  });
}

function chipName(c) {
  return { wildcard: "Wildcard", freehit: "Free Hit", bboost: "Bench Boost", "3xc": "Triple Captain", manager: "Assistant Manager" }[c] || c;
}

function renderPlanner(squad, plan, bank, original) {
  const box = document.getElementById("planner");
  const changes = Object.entries(plan).map(([slot, inId]) => ({ slot: +slot, out: playerById.get(original.get(+slot).id), in: playerById.get(inId) }));
  const fdrSum = (players) => players.reduce((sum, p) => sum + (upcomingByTeam.get(p.team) || []).slice(0, 5).reduce((a, fx) => a + fx.fdr, 0), 0) / players.length;
  const before = fdrSum(squad.map((s) => playerById.get(original.get(s.slot).id)).filter(Boolean));
  const after = fdrSum(squad.map((s) => s.p));
  const selected = squad.find((s) => s.slot === teamView.selected);

  let picker = '<p class="muted">Click a player on the pitch to find a replacement. Plans are saved in this browser only and never change your real team.</p>';
  if (selected) {
    const out = selected.p;
    const budget = bank + out.price;
    const inSquad = new Set(squad.map((s) => s.p.id));
    const perTeam = new Map();
    squad.forEach((s) => { if (s.slot !== selected.slot) perTeam.set(s.p.team, (perTeam.get(s.p.team) || 0) + 1); });
    const origId = original.get(selected.slot).id;
    const q = teamView.q.trim().toLowerCase();
    const options = D.players.filter((p) => p.pos === out.pos && (p.id === origId || !inSquad.has(p.id)) && p.id !== out.id &&
      p.price <= budget + 1e-9 && (perTeam.get(p.team) || 0) < 3 && (!q || p.name.toLowerCase().includes(q) || p.full.toLowerCase().includes(q)))
      .sort((a, b) => b.form - a.form || b.points - a.points).slice(0, 60);
    picker = `
      <div><h3>Replace ${esc(out.name)} <span class="muted">(${money(out.price)})</span></h3>
        <div class="filters" style="margin:0 0 10px"><input type="search" id="cand-q" placeholder="Search ${POSITIONS[out.pos]}s up to ${money(budget)}"></div>
        <div class="table-wrap candidates"><table>
          <thead><tr><th>Player</th><th class="left">Team</th><th>Price</th><th>Form</th><th>Pts</th><th class="left">Next 3</th></tr></thead>
          <tbody>${options.map((p) => `<tr class="clickable" data-pick="${p.id}">
            <td class="name left">${esc(p.name)}${statusFlag(p)}</td><td class="left">${teamPill(p.team)}</td><td>${money(p.price)}</td>
            <td class="hot">${dec(p.form)}</td><td>${p.points}</td>
            <td class="left">${(upcomingByTeam.get(p.team) || []).slice(0, 3).map((fx) => fdrChip(fx, true)).join("")}</td></tr>`).join("") ||
            '<tr><td colspan="6" class="muted left">No one fits the budget and the 3-per-club rule.</td></tr>'}</tbody>
        </table></div></div>`;
  }

  box.innerHTML = `
    <div class="kv">
      <div><span>Planned transfers</span><b>${changes.length}</b></div>
      <div><span>Bank after</span><b class="${bank < 0 ? "down" : ""}">${money(bank)}</b></div>
      <div><span>Fixture difficulty, next 5</span><b>${dec(after, 1)}</b></div>
      <div><span>Change</span><b class="${after < before ? "up" : after > before ? "down" : ""}">${after === before ? "0.0" : signed(after - before)}</b></div>
    </div>
    ${changes.length ? `<div class="plan-list">${changes.map((c) => `
      <div class="plan-item"><span class="out">− ${esc(c.out?.name)}</span><button data-undo="${c.slot}" title="Undo">✕</button><span class="in">+ ${esc(c.in?.name)}</span></div>`).join("")}
      <button id="reset-plan">Reset to my real team</button></div>` : ""}
    ${picker}
    <p class="note">Budget uses current prices; your real selling price can be up to £0.1m lower per player you've made a profit on. Fixture difficulty is the squad's average total FPL rating over the next 5 gameweeks (lower is easier).</p>`;

  box.querySelector("#cand-q")?.addEventListener("input", (e) => {
    teamView.q = e.target.value;
    const pos = e.target.selectionStart;
    renderMyTeam();
    const again = document.getElementById("cand-q");
    again.focus(); again.setSelectionRange(pos, pos);
  });
  const qEl = box.querySelector("#cand-q");
  if (qEl) qEl.value = teamView.q;
  box.addEventListener("click", (e) => {
    const pick = e.target.closest("tr[data-pick]");
    if (pick && selected) {
      const id = +pick.dataset.pick;
      if (id === original.get(selected.slot).id) delete plan[selected.slot];
      else plan[selected.slot] = id;
      savePlan(plan);
      teamView.selected = null;
      return renderMyTeam();
    }
    const undo = e.target.closest("[data-undo]");
    if (undo) { delete plan[+undo.dataset.undo]; savePlan(plan); return renderMyTeam(); }
    if (e.target.id === "reset-plan") { savePlan({}); teamView.selected = null; renderMyTeam(); }
  });
}

// ---------- fixtures ----------

const fixtureView = { horizon: 6, sort: "easiest" };

function renderFixtures() {
  const start = firstUpcomingGw();
  const gws = Array.from({ length: fixtureView.horizon }, (_, i) => start + i);
  const rows = D.teams.map((t) => {
    const byGw = new Map(gws.map((g) => [g, []]));
    (upcomingByTeam.get(t.id) || []).forEach((fx) => byGw.get(fx.gw)?.push(fx));
    const all = [...byGw.values()].flat();
    const avg = all.length ? all.reduce((s, fx) => s + fx.fdr, 0) / all.length : null;
    return { team: t, byGw, avg };
  }).sort((a, b) => fixtureView.sort === "name"
    ? a.team.name.localeCompare(b.team.name)
    : (a.avg ?? 9) - (b.avg ?? 9) || a.team.name.localeCompare(b.team.name));

  app.innerHTML = `
    <div class="eyebrow">From gameweek ${start}</div>
    <h1>Fixture difficulty</h1>
    <p class="lede">Every team's upcoming run, rated by FPL. Two fixtures in a cell is a double gameweek; a dash is a blank.</p>
    <div class="filters">
      <div class="segmented" id="horizon">${[3, 5, 6, 8].map((n) =>
        `<button data-n="${n}" class="${n === fixtureView.horizon ? "on" : ""}">${n} GWs</button>`).join("")}</div>
      <div class="segmented" id="fsort">
        <button data-s="easiest" class="${fixtureView.sort === "easiest" ? "on" : ""}">Easiest first</button>
        <button data-s="name" class="${fixtureView.sort === "name" ? "on" : ""}">A–Z</button>
      </div>
      <div class="legend" style="margin-left:auto">Difficulty
        ${[1, 2, 3, 4, 5].map((n) => `<span class="fdr fdr-${n}">${n}${n === 1 ? " easy" : n === 5 ? " hard" : ""}</span>`).join("")}
      </div>
    </div>
    <div class="table-wrap"><table class="fixture-grid">
      <thead><tr><th class="left">Team</th>${gws.map((g) => `<th style="text-align:center">GW${g}</th>`).join("")}<th>Avg</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr><td>${teamPill(r.team.id)} ${esc(r.team.name)}</td>
          ${gws.map((g) => {
            const list = r.byGw.get(g);
            return `<td>${list.length ? list.map((fx) => fdrChip(fx)).join("") : '<span class="fdr-blank">–</span>'}</td>`;
          }).join("")}
          <td class="avg">${dec(r.avg, 2)}</td></tr>`).join("")}
      </tbody>
    </table></div>`;

  document.getElementById("horizon").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    fixtureView.horizon = +b.dataset.n; renderFixtures();
  });
  document.getElementById("fsort").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    fixtureView.sort = b.dataset.s; renderFixtures();
  });
}

// ---------- prices ----------

const priceView = { showAll: {} };

function priceChanges() {
  const { dates, prices } = D.prices;
  if (dates.length < 2) return null;
  const changes = [];
  for (const [id, series] of Object.entries(prices)) {
    const now = series[series.length - 1], before = series[series.length - 2];
    if (now != null && before != null && now !== before) changes.push({ p: playerById.get(+id), delta: now - before });
  }
  return { since: dates[dates.length - 2], changes: changes.filter((c) => c.p) };
}

function priceTable(rows, valueLabel, value) {
  if (!rows.length) return '<div class="empty">None</div>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Player</th><th class="left">Team</th><th class="left">Pos</th><th>Price</th><th>${valueLabel}</th></tr></thead>
    <tbody>${rows.map((r) => `
      <tr class="clickable" data-id="${r.p.id}">
        <td class="name left">${esc(r.p.name)}${statusFlag(r.p)}</td>
        <td class="left">${teamPill(r.p.team)}</td>
        <td class="left">${posTag(r.p.pos)}</td>
        <td>${money(r.p.price)}</td>
        <td>${value(r)}</td>
      </tr>`).join("")}</tbody></table></div>`;
}

function renderPrices() {
  const daily = priceChanges();
  let changes, heading;
  if (daily) {
    changes = daily.changes;
    heading = `Since ${new Date(daily.since).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  } else {
    changes = D.players.filter((p) => p.changeGw).map((p) => ({ p, delta: p.changeGw }));
    heading = "This gameweek (daily tracking starts after the second update)";
  }
  const delta = (r) => `<span class="${r.delta > 0 ? "up" : "down"}">${r.delta > 0 ? "▲" : "▼"} ${signed(r.delta)}</span>`;
  const risers = changes.filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta || b.p.own - a.p.own);
  const fallers = changes.filter((c) => c.delta < 0).sort((a, b) => a.delta - b.delta || b.p.own - a.p.own);
  const net = D.players.map((p) => ({ p, net: p.transfersIn - p.transfersOut }));
  const fmtNet = (r) => `<span class="${r.net > 0 ? "up" : "down"}">${r.net > 0 ? "+" : ""}${r.net.toLocaleString()}</span>`;
  const LIMIT = 20;
  const changeSection = (title, rows, key) => {
    const all = priceView.showAll[key] || rows.length <= LIMIT;
    return `<section><h2>${title} (${rows.length})</h2>${priceTable(all ? rows : rows.slice(0, LIMIT), "Change", delta)}
      ${all ? "" : `<p><a href="#/prices" data-show="${key}">Show all ${rows.length}</a></p>`}</section>`;
  };

  app.innerHTML = `
    <div class="eyebrow">Market</div>
    <h1>Price changes</h1>
    <p class="lede">${esc(heading)}. Net transfers this gameweek are the best guide to the next moves.</p>
    <div class="columns">
      ${changeSection("Risers", risers, "risers")}
      ${changeSection("Fallers", fallers, "fallers")}
      <section><h2>Most transferred in</h2>${priceTable([...net].sort((a, b) => b.net - a.net).slice(0, 15), "Net transfers", fmtNet)}</section>
      <section><h2>Most transferred out</h2>${priceTable([...net].sort((a, b) => a.net - b.net).slice(0, 15), "Net transfers", fmtNet)}</section>
    </div>`;
  app.querySelectorAll("tbody").forEach(onRowClick);
  app.querySelectorAll("[data-show]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    priceView.showAll[a.dataset.show] = true;
    renderPrices();
  }));
}

// ---------- stats lab ----------

const SCATTER_Y = {
  points: { label: "Points", get: (p) => p.points, fmt: (v) => v },
  xgi90: { label: "xGI per 90", get: (p) => per90(p.xgi, p.mins), fmt: (v) => dec(v, 2) },
  form: { label: "Form", get: (p) => p.form, fmt: (v) => dec(v, 1) },
  ppg: { label: "Points per game", get: (p) => p.ppg, fmt: (v) => dec(v, 1) },
};
const BOARDS = {
  rating: { label: "Rating", get: (p) => Ratings.get(p.id)?.ovr ?? null, fmt: (v) => v },
  points: { label: "Points", get: (p) => p.points, fmt: (v) => v },
  form: { label: "Form", get: (p) => p.form, fmt: (v) => dec(v) },
  xgi: { label: "xGI", get: (p) => p.xgi, fmt: (v) => dec(v, 2) },
  xgi90: { label: "xGI/90", get: (p) => (p.mins >= 270 ? per90(p.xgi, p.mins) : null), fmt: (v) => dec(v, 2) },
  ptsPerM: { label: "Pts per £m", get: (p) => p.points / p.price, fmt: (v) => dec(v, 1) },
  defcon: { label: "Def. contributions", get: (p) => p.defcon, fmt: (v) => v },
  bps: { label: "BPS", get: (p) => p.bps, fmt: (v) => v },
  threat: { label: "Threat", get: (p) => p.threat, fmt: (v) => dec(v, 0) },
  creativity: { label: "Creativity", get: (p) => p.creativity, fmt: (v) => dec(v, 0) },
  net: { label: "Net transfers", get: (p) => p.transfersIn - p.transfersOut, fmt: (v) => v.toLocaleString() },
};
const statsView = { y: "points", board: "form", boardPos: "" };

function teamStats() {
  const rows = new Map(D.teams.map((t) => [t.id, { team: t, games: 0, gf: 0, ga: 0, xg: 0, xga: 0 }]));
  for (const f of D.fixtures) {
    if (!f.finished || f.homeScore == null) continue;
    const h = rows.get(f.home), a = rows.get(f.away);
    h.games++; a.games++;
    h.gf += f.homeScore; h.ga += f.awayScore;
    a.gf += f.awayScore; a.ga += f.homeScore;
  }
  for (const p of D.players) {
    const r = rows.get(p.team);
    r.xg += p.xg;
    if (p.pos === 1) r.xga += p.xgc; // keepers' xG conceded adds up to the team's
  }
  return [...rows.values()].filter((r) => r.games);
}

function segmented(id, options, current) {
  return `<div class="segmented" id="${id}">${Object.entries(options).map(([k, v]) =>
    `<button data-k="${k}" class="${k === current ? "on" : ""}">${typeof v === "string" ? v : v.label}</button>`).join("")}</div>`;
}

function renderStats() {
  const toPlayer = (pt) => { location.hash = `#/player/${pt.data.id}`; };
  app.innerHTML = `
    <div class="eyebrow">Gameweek ${D.meta.currentGw ?? "–"}</div>
    <h1>Stats lab</h1>
    <p class="lede">The whole league at a glance: who gives the most for the money, who's flying under the radar, which teams create and concede, and the leaders in every stat.</p>

    <h2>Price vs output</h2>
    <div class="filters">${segmented("scatter-y", SCATTER_Y, statsView.y)}<span class="count">Players with 270+ minutes · labelled: best value in each position</span></div>
    <div class="multiples wide">${[1, 2, 3, 4].map((pos) =>
      `<div class="panel pad chart"><h3>${POSITION_NAMES[pos]}s</h3><div id="sc-${pos}"></div></div>`).join("")}</div>

    <div class="grid-2">
      <section><h2>Differentials: form vs ownership</h2><div class="panel pad chart"><div id="diff-chart"></div>
        <p class="note">Labelled: the best form among players owned by under 10% of managers.</p></div></section>
      <section><h2>Team attack vs defence</h2><div class="panel pad chart"><div id="team-chart"></div>
        <p class="note">Per game. Bottom-right is best: lots of chances created, few conceded. xG for is the sum of the team's players; xG against is the sum of its keepers' xG conceded.</p></div></section>
    </div>

    <h2>Leaderboards</h2>
    <div class="filters">${segmented("board", BOARDS, statsView.board)}
      ${segmented("board-pos", { "": "All", 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" }, statsView.boardPos)}</div>
    <div class="panel pad"><div id="board-bars"></div></div>

    <div class="grid-2">
      <section><h2>Gameweek scores across FPL</h2><div class="panel pad chart"><div id="league-chart"></div></div></section>
      <section><h2>Gameweek stars</h2><div id="stars"></div></section>
    </div>`;

  const pts = (filter) => D.players.filter((p) => p.mins >= 270 && filter(p));

  // Price vs output, one panel per position.
  const ym = SCATTER_Y[statsView.y];
  for (const pos of [1, 2, 3, 4]) {
    const points = pts((p) => p.pos === pos && ym.get(p) != null)
      .map((p) => ({ x: p.price, y: ym.get(p), label: esc(p.name), data: p }));
    const best = new Set([...points].sort((a, b) => b.y / b.x - a.y / a.x).slice(0, 3));
    if (points.length) Charts.scatter(document.getElementById(`sc-${pos}`), points, {
      h: 280, w: 420, xFmt: (v) => `£${v}`, yFmt: ym.fmt, highlight: best, onClick: toPlayer, yMin: 0,
      xTitle: "Price (£m)", yTitle: ym.label,
      tooltip: (pt) => `<b>${esc(pt.data.name)}</b> · ${esc(teamShort(pt.data.team))}<br>${money(pt.x)} · ${ym.label} ${ym.fmt(pt.y)}`,
    });
  }

  // Differentials.
  const diff = pts(() => true).map((p) => ({ x: p.own, y: p.form, label: esc(p.name), data: p }));
  Charts.scatter(document.getElementById("diff-chart"), diff, {
    xFmt: (v) => `${v}%`, yFmt: (v) => v, xMin: 0, yMin: 0, xTitle: "Selected by", yTitle: "Form", onClick: toPlayer,
    highlight: new Set(diff.filter((d) => d.x < 10).sort((a, b) => b.y - a.y).slice(0, 6)),
    tooltip: (pt) => `<b>${esc(pt.data.name)}</b> · ${esc(teamShort(pt.data.team))} · ${money(pt.data.price)}<br>Form ${dec(pt.y)} · owned by ${dec(pt.x)}%`,
  });

  // Teams.
  const teams = teamStats().map((r) => ({ x: r.xg / r.games, y: r.xga / r.games, label: esc(r.team.short), data: r }));
  if (teams.length) Charts.scatter(document.getElementById("team-chart"), teams, {
    xFmt: (v) => dec(v, 1), yFmt: (v) => dec(v, 1), xTitle: "xG for", yTitle: "xG against", highlight: new Set(teams),
    tooltip: (pt) => `<b>${esc(pt.data.team.name)}</b><br>xG ${dec(pt.x, 2)} for · ${dec(pt.y, 2)} against per game<br>
      Goals ${pt.data.gf}–${pt.data.ga} in ${pt.data.games} games`,
  });

  // Leaderboard.
  const bm = BOARDS[statsView.board];
  const leaders = D.players.filter((p) => (!statsView.boardPos || p.pos === +statsView.boardPos) && bm.get(p) != null)
    .sort((a, b) => bm.get(b) - bm.get(a)).slice(0, 12);
  Charts.hbars(document.getElementById("board-bars"), leaders.map((p) => ({
    label: `<span class="who">${photo(p, "sm")}${esc(p.name)}</span>`, sub: `${teamShort(p.team)} · ${POSITIONS[p.pos]} · ${money(p.price)}`,
    value: Math.max(0, bm.get(p)), id: p.id })), { fmt: bm.fmt, onClick: (r) => { location.hash = `#/player/${r.id}`; } });

  // League-wide gameweek scores and stars.
  const events = (D.meta.events || []).filter((e) => e.average != null);
  if (events.length) {
    Charts.lines(document.getElementById("league-chart"), {
      labels: events.map((e) => e.gw), fromZero: true,
      series: [{ name: "Highest", values: events.map((e) => e.highest), color: SERIES[1] }, { name: "Average", values: events.map((e) => e.average), color: SERIES[0] }],
      tooltip: (i) => `<b>GW${events[i].gw}</b><br>Average ${events[i].average} · highest ${events[i].highest}`,
    });
    const name = (id) => (playerById.get(id) ? `<span class="who">${photo(playerById.get(id), "sm")}${esc(playerById.get(id).name)}</span>` : "–");
    document.getElementById("stars").innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>GW</th><th class="left">Top scorer</th><th>Pts</th><th class="left">Most captained</th></tr></thead>
      <tbody>${[...events].reverse().slice(0, 10).map((e) => `<tr class="clickable" data-id="${e.topPlayer ?? ""}">
        <td>${e.gw}</td><td class="left name">${name(e.topPlayer)}</td><td class="hot">${e.topPoints ?? "–"}</td><td class="left">${name(e.mostCaptained)}</td></tr>`).join("")}
      </tbody></table></div>`;
    onRowClick(document.getElementById("stars"));
  } else {
    document.getElementById("league-chart").innerHTML = '<p class="muted">Available after the next data update.</p>';
    document.getElementById("stars").innerHTML = '<div class="empty">Available after the next data update.</div>';
  }

  const bindSeg = (id, key) => document.getElementById(id).addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    statsView[key] = b.dataset.k;
    const y = scrollY; renderStats(); scrollTo(0, y);
  });
  bindSeg("scatter-y", "y"); bindSeg("board", "board"); bindSeg("board-pos", "boardPos");
}

// ---------- moneyball ----------

const HORIZON = 5;
const BUDGET_CUTOFF = { 1: 5.0, 2: 5.0, 3: 6.5, 4: 7.0 };
const moneyballView = { pos: "", maxPrice: "", sort: "surplus", asc: false };

// Least-squares line y = a + b·x.
function fitLine(pts) {
  const n = pts.length;
  if (n < 3) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (!sxx) return null;
  const b = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx;
  return { a: my - b * mx, b };
}

// Every regular's projected points over the next HORIZON gameweeks, and how far above
// their position's price line they sit (the "surplus" a Moneyball manager is buying).
function valueTable() {
  const from = firstUpcomingGw();
  const rows = D.players.map((p) => {
    const proj = Model.project(p, from, HORIZON);
    return { p, xpts: proj.total, nextGw: proj.byGw[0]?.pts ?? 0, av: proj.av, due: p.xgi - (p.goals + p.assists) };
  }).filter((r) => r.p.mins >= 270 && r.av.mins >= 45);
  const lines = {};
  for (const pos of [1, 2, 3, 4]) {
    lines[pos] = fitLine(rows.filter((r) => r.p.pos === pos).map((r) => ({ x: r.p.price, y: r.xpts })));
  }
  for (const r of rows) {
    const line = lines[r.p.pos];
    r.expected = line ? line.a + line.b * r.p.price : r.xpts;
    r.surplus = r.xpts - r.expected;
    r.perM = r.xpts / r.p.price;
  }
  return { rows, lines, from };
}

const MB_COLS = {
  price: { label: "Price", get: (r) => r.p.price, fmt: money },
  ovr: { label: "Rating", get: (r) => Ratings.get(r.p.id)?.ovr ?? 0, fmt: (v, r) => ratingBadge(r.p) },
  xpts: { label: `xPts next ${HORIZON}`, get: (r) => r.xpts, fmt: (v) => dec(v, 1) },
  surplus: { label: "Value over price", get: (r) => r.surplus, fmt: (v) => `<span class="${v >= 0 ? "up" : "down"}">${signed(v)}</span>` },
  perM: { label: "xPts per £m", get: (r) => r.perM, fmt: (v) => dec(v, 2) },
  ptsPerM: { label: "Season pts/£m", get: (r) => r.p.points / r.p.price, fmt: (v) => dec(v, 1) },
  mins: { label: "Exp. mins", get: (r) => r.av.mins, fmt: (v) => Math.round(v) },
  due: { label: "xGI − G+A", get: (r) => r.due, fmt: (v) => `<span class="${v > 0.5 ? "up" : v < -0.5 ? "down" : ""}">${signed(v)}</span>` },
  own: { label: "Own %", get: (r) => r.p.own, fmt: (v) => dec(v) },
};

// A best-value XI from budget players: best of every legal formation, max three per club.
function moneyballXI(beasts) {
  const pool = [...beasts].sort((a, b) => b.xpts - a.xpts);
  let best = null;
  for (let nd = 3; nd <= 5; nd++) for (let nm = 2; nm <= 5; nm++) {
    const nf = 10 - nd - nm;
    if (nf < 1 || nf > 3) continue;
    const need = { 1: 1, 2: nd, 3: nm, 4: nf }, club = new Map(), xi = [];
    for (const r of pool) {
      if (!need[r.p.pos] || (club.get(r.p.team) || 0) >= 3) continue;
      need[r.p.pos]--; club.set(r.p.team, (club.get(r.p.team) || 0) + 1); xi.push(r);
    }
    if (xi.length < 11) continue;
    const total = xi.reduce((a, r) => a + r.xpts, 0);
    if (!best || total > best.total) best = { xi, total, formation: `${nd}-${nm}-${nf}`, cost: xi.reduce((a, r) => a + r.p.price, 0) };
  }
  return best;
}

function mbCard(r) {
  const next = (upcomingByTeam.get(r.p.team) || [])[0];
  return `<div class="card" data-id="${r.p.id}" title="${esc(r.p.full)}">
    ${statusFlag(r.p)}${photo(r.p, "card-photo")}
    <div class="nm">${esc(r.p.name)}</div>
    <div class="sub">${ratingBadge(r.p, "xs")} ${money(r.p.price)} ${next ? fdrChip(next, true) : ""}</div>
    <div class="pts">${dec(r.xpts, 1)} xPts</div>
  </div>`;
}

function renderMoneyball() {
  const { rows, lines, from } = valueTable();
  const beasts = rows.filter((r) => r.p.price <= BUDGET_CUTOFF[r.p.pos]);
  const xi = moneyballXI(beasts);
  const overpriced = rows.filter((r) => r.p.own >= 5 && r.p.price > BUDGET_CUTOFF[r.p.pos]).sort((a, b) => a.surplus - b.surplus).slice(0, 8);

  app.innerHTML = `
    <section class="hero">
      <div class="eyebrow">Moneyball · gameweeks ${from}–${from + HORIZON - 1}</div>
      <h1>Budget beasts</h1>
      <p class="lede">Prices follow reputation; points follow minutes, chances and fixtures. This page projects every regular's points for the next ${HORIZON} gameweeks
        from their underlying numbers (expected minutes, xG and xA per 90, clean-sheet odds from both teams' xG, defensive contributions, saves, bonus)
        adjusted for each opponent, then finds the players producing far more than their price says they should.</p>
      ${xi ? `<div class="tiles">
        ${tile("Moneyball XI cost", money(xi.cost), `${xi.formation}, all budget players`, true)}
        ${tile(`Projected, next ${HORIZON} GWs`, dec(xi.total, 0), `${dec(xi.total / HORIZON, 1)} per gameweek`)}
        ${tile("Budget beasts", beasts.filter((r) => r.surplus > 0).length, "beat their price line")}
      </div>` : ""}
    </section>

    ${xi ? `<h2>Moneyball XI</h2>
    <div class="squad-pitch mb-pitch">${[1, 2, 3, 4].map((pos) =>
      `<div class="squad-row">${xi.xi.filter((r) => r.p.pos === pos).map(mbCard).join("")}</div>`).join("")}</div>
    <p class="note">The highest-projected starting XI you can build only from players at or under ${Object.entries(BUDGET_CUTOFF).map(([pos, c]) => `${money(c)} (${POSITIONS[pos]})`).join(", ")}.</p>` : ""}

    <h2>The price line</h2>
    <p class="lede" style="margin-bottom:12px">Each dot is a player; the line is what a player of that price usually returns. Dots above the line are underpriced. Labelled: the biggest budget bargains.</p>
    <div class="multiples wide">${[1, 2, 3, 4].map((pos) =>
      `<div class="panel pad chart"><h3>${POSITION_NAMES[pos]}s</h3><div id="line-${pos}"></div></div>`).join("")}</div>

    <h2>Budget beasts</h2>
    <div class="filters">
      ${segmented("mb-pos", { "": "All", 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" }, moneyballView.pos)}
      <label>Max price (£m)<input type="number" id="mb-price" min="3.5" max="15" step="0.5" placeholder="budget only"></label>
      <span class="count" id="mb-count"></span>
    </div>
    <div class="table-wrap"><table><thead id="mb-head"></thead><tbody id="mb-rows"></tbody></table></div>
    <p class="note">Value over price = projected points minus what the price line expects at that price. xGI − G+A above zero means they've been unlucky: the chances are there and returns tend to follow.
      Without a max price, the table shows players at or under the budget cut-offs.</p>

    <h2>Overpriced: the other side of the trade</h2>
    <p class="lede" style="margin-bottom:12px">Popular players whose projection sits furthest below their price line: the money tied up here could buy more points elsewhere.</p>
    <div class="panel pad"><div id="overpriced"></div></div>`;

  for (const pos of [1, 2, 3, 4]) {
    const posRows = rows.filter((r) => r.p.pos === pos);
    if (!posRows.length) continue;
    const pts = posRows.map((r) => ({ x: r.p.price, y: r.xpts, label: esc(r.p.name), data: r }));
    const labelled = new Set(pts.filter((d) => d.data.p.price <= BUDGET_CUTOFF[pos]).sort((a, b) => b.data.surplus - a.data.surplus).slice(0, 4));
    Charts.scatter(document.getElementById(`line-${pos}`), pts, {
      h: 280, w: 420, trend: lines[pos], highlight: labelled, yMin: 0, xFmt: (v) => `£${v}`, yFmt: (v) => v,
      xTitle: "Price (£m)", yTitle: `xPts next ${HORIZON}`,
      onClick: (d) => { location.hash = `#/player/${d.data.p.id}`; },
      tooltip: (d) => `<b>${esc(d.data.p.name)}</b> · ${esc(teamShort(d.data.p.team))} · ${money(d.x)}<br>${dec(d.y, 1)} xPts · ${signed(d.data.surplus)} vs the line`,
    });
  }

  Charts.hbars(document.getElementById("overpriced"), overpriced.map((r) => ({
    label: `<span class="who">${photo(r.p, "sm")}${esc(r.p.name)}</span>`,
    sub: `${teamShort(r.p.team)} · ${POSITIONS[r.p.pos]} · ${money(r.p.price)} · ${dec(r.p.own)}% owned`,
    value: -r.surplus, id: r.p.id })), {
    fmt: (v) => `−${dec(v, 1)}`, color: "linear-gradient(90deg, rgba(233,0,82,0.4), var(--pink))",
    onClick: (r) => { location.hash = `#/player/${r.id}`; },
  });

  const fill = () => {
    const v = moneyballView;
    const col = MB_COLS[v.sort];
    const list = rows.filter((r) => (!v.pos || r.p.pos === +v.pos) && (v.maxPrice ? r.p.price <= +v.maxPrice : r.p.price <= BUDGET_CUTOFF[r.p.pos]))
      .sort((a, b) => (v.asc ? 1 : -1) * (col.get(a) - col.get(b)));
    const th = (k, c) => `<th class="sortable ${v.sort === k ? `sorted ${v.asc ? "asc" : ""}` : ""}" data-key="${k}">${c.label}</th>`;
    document.getElementById("mb-head").innerHTML = `<tr><th class="rank">#</th><th class="left">Player</th><th class="left">Team</th><th class="left">Pos</th>${
      Object.entries(MB_COLS).map(([k, c]) => th(k, c)).join("")}<th class="left">Next 3</th></tr>`;
    document.getElementById("mb-count").textContent = `${list.length} players`;
    document.getElementById("mb-rows").innerHTML = list.slice(0, 60).map((r, i) => `
      <tr class="clickable" data-id="${r.p.id}"><td class="rank">${i + 1}</td>
        <td class="name left"><span class="who">${photo(r.p, "sm")}${esc(r.p.name)}${statusFlag(r.p)}${roleTags(r.p)}</span></td>
        <td class="left">${teamPill(r.p.team)}</td><td class="left">${posTag(r.p.pos)}</td>
        ${Object.entries(MB_COLS).map(([k, c]) => `<td class="${k === v.sort ? "hot" : ""}">${c.fmt(c.get(r), r)}</td>`).join("")}
        <td class="left">${(upcomingByTeam.get(r.p.team) || []).slice(0, 3).map((fx) => fdrChip(fx, true)).join("")}</td></tr>`).join("");
  };
  fill();
  document.getElementById("mb-head").addEventListener("click", (e) => {
    const th = e.target.closest("th.sortable"); if (!th) return;
    if (moneyballView.sort === th.dataset.key) moneyballView.asc = !moneyballView.asc;
    else { moneyballView.sort = th.dataset.key; moneyballView.asc = false; }
    fill();
  });
  document.getElementById("mb-pos").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    moneyballView.pos = b.dataset.k;
    document.querySelectorAll("#mb-pos button").forEach((x) => x.classList.toggle("on", x === b));
    fill();
  });
  const price = document.getElementById("mb-price");
  price.value = moneyballView.maxPrice;
  price.addEventListener("input", () => { moneyballView.maxPrice = price.value; fill(); });
  onRowClick(document.getElementById("mb-rows"));
  app.querySelector(".mb-pitch")?.addEventListener("click", (e) => {
    const c = e.target.closest(".card"); if (c) location.hash = `#/player/${c.dataset.id}`;
  });
}

// ---------- assistant ----------

const CHIP_HORIZON = 8;

// From 2025/26 each chip can be played once in each half of the season (GW1–19, GW20–38).
function chipStatus(t, gw) {
  const firstHalf = gw <= 19;
  const inHalf = (g) => (firstHalf ? g <= 19 : g >= 20);
  return Object.fromEntries(["wildcard", "freehit", "bboost", "3xc"].map((name) =>
    [name, !t.chips.some((c) => c.name === name && inHalf(c.gw))]));
}

function assistantAdvice(t, squad, bank, captainId) {
  const from = firstUpcomingGw();
  const n = Math.max(1, Math.min(CHIP_HORIZON, 39 - from));
  const players = squad.map((s) => s.p);
  const proj = new Map(players.map((p) => [p.id, Model.project(p, from, n)]));
  const ptsIn = (i) => (p) => proj.get(p.id).byGw[i]?.pts ?? 0;
  const next = ptsIn(0);

  // This gameweek: best XI and captain vs the current picks.
  const best = Model.bestXI(players, next);
  const currentXI = squad.filter((s) => s.slot <= 11).map((s) => s.p);
  const [cap, vice] = [...best.xi].sort((a, b) => next(b) - next(a));
  const currentCap = playerById.get(captainId);
  const xiTotal = (xi, c) => xi.reduce((a, p) => a + next(p), 0) + (c ? next(c) : 0);
  const currentPts = xiTotal(currentXI, currentXI.includes(currentCap) ? currentCap : null);
  const bestPts = xiTotal(best.xi, cap);
  const inBest = new Set(best.xi);
  const toStart = best.xi.filter((p) => !currentXI.includes(p));
  const toBench = currentXI.filter((p) => !inBest.has(p));
  const keeperSwap = toStart.find((p) => p.pos === 1) && { in: toStart.find((p) => p.pos === 1), out: toBench.find((p) => p.pos === 1) };
  const outfield = { start: toStart.filter((p) => p.pos !== 1), bench: toBench.filter((p) => p.pos !== 1) };

  // Transfers over the next 5 gameweeks: best single replacement for each squad player.
  const H = Math.min(5, n);
  const total5 = (p) => Model.project(p, from, H).total;
  const inSquad = new Set(players.map((p) => p.id));
  const perTeam = new Map();
  players.forEach((p) => perTeam.set(p.team, (perTeam.get(p.team) || 0) + 1));
  const ideas = [];
  for (const s of squad) {
    const out = s.p, budget = bank + out.price, outPts = total5(out);
    let bestIn = null, bestPts = outPts;
    for (const c of D.players) {
      if (c.pos !== out.pos || inSquad.has(c.id) || c.price > budget + 1e-9) continue;
      if (c.team !== out.team && (perTeam.get(c.team) || 0) >= 3) continue;
      const pts = total5(c);
      if (pts > bestPts) { bestPts = pts; bestIn = c; }
    }
    if (bestIn) ideas.push({ slot: s.slot, out, in: bestIn, gain: bestPts - outPts, outPts, inPts: bestPts });
  }
  const usedIns = new Set();
  const transfers = ideas.sort((a, b) => b.gain - a.gain).filter((t2) => !usedIns.has(t2.in.id) && usedIns.add(t2.in.id)).slice(0, 4);

  // Chips: score every gameweek in the horizon.
  const weeks = Array.from({ length: n }, (_, i) => {
    const pts = ptsIn(i);
    const xi = Model.bestXI(players, pts);
    const top = [...players].sort((a, b) => pts(b) - pts(a))[0];
    return {
      gw: from + i,
      bench: xi ? xi.bench.reduce((a, p) => a + pts(p), 0) : 0,
      captain: top, captainPts: pts(top),
      playing: players.filter((p) => (proj.get(p.id).byGw[i]?.fixtures ?? 0) > 0).length,
      doubles: players.filter((p) => (proj.get(p.id).byGw[i]?.fixtures ?? 0) > 1).length,
      total: xi ? xi.total : 0,
    };
  });
  const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
  const avail = chipStatus(t, from);
  const doubleOf = (w, p) => (proj.get(p.id).byGw[w.gw - from]?.fixtures ?? 0) > 1;
  const chips = [];
  const tc = [...weeks].sort((a, b) => b.captainPts - a.captainPts)[0];
  const bb = [...weeks].sort((a, b) => b.bench - a.bench)[0];
  const fh = [...weeks].sort((a, b) => a.playing - b.playing || a.total - b.total)[0];
  const flagged = players.filter((p) => proj.get(p.id).av.fit < 0.75);
  const bigGains = transfers.filter((x) => x.gain >= 3).length;
  const halfEnds = from <= 19 ? 19 : 38;
  const urgent = halfEnds - from <= 3;

  if (avail["3xc"]) {
    const go = tc.captainPts >= 1.25 * median(weeks.map((w) => w.captainPts)) || doubleOf(tc, tc.captain);
    chips.push({ name: "Triple Captain", verdict: go ? `GW${tc.gw}` : urgent ? `GW${tc.gw} (use it or lose it)` : "Hold",
      reason: `Best week: GW${tc.gw}, ${esc(tc.captain.name)} projected ${dec(tc.captainPts, 1)}${doubleOf(tc, tc.captain) ? " across a double gameweek" : ""}.${go ? "" : " No week stands out yet."}` });
  }
  if (avail.bboost) {
    const go = bb.bench >= 12 || weeks.find((w) => w.gw === bb.gw).doubles >= 3;
    chips.push({ name: "Bench Boost", verdict: go ? `GW${bb.gw}` : urgent ? `GW${bb.gw} (use it or lose it)` : "Hold",
      reason: `Your bench projects ${dec(bb.bench, 1)} points in GW${bb.gw}, its best week.${go ? "" : " Worth more once your bench has doubles or easier fixtures."}` });
  }
  if (avail.freehit) {
    const go = fh.playing <= 8;
    chips.push({ name: "Free Hit", verdict: go ? `GW${fh.gw}` : "Hold",
      reason: go ? `Only ${fh.playing} of your 15 have a fixture in GW${fh.gw}.` : `Every week in the next ${n} has at least ${fh.playing} of your players with a fixture; save it for a blank gameweek.` });
  }
  if (avail.wildcard) {
    const go = flagged.length >= 3 || bigGains >= 4;
    chips.push({ name: "Wildcard", verdict: go ? "Consider now" : "Hold",
      reason: go ? `${flagged.length} ${flagged.length === 1 ? "player is" : "players are"} injured or doubtful and ${bigGains} transfers each gain 3+ points over 5 gameweeks.`
        : "Your squad only needs a transfer or two; keep the Wildcard for a bigger rebuild." });
  }
  return { from, best, cap, vice, currentCap, currentPts, bestPts, keeperSwap, outfield, transfers, chips, weeks, avail, halfEnds, H };
}

function assistantHtml(a) {
  const nm = (p) => `<a href="#/player/${p.id}">${esc(p.name)}</a>`;
  const xp = (p) => dec(Model.project(p, a.from, 1).total, 1);
  const capLine = a.currentCap && a.currentCap.id === a.cap.id
    ? `Keep ${nm(a.cap)} as captain (${dec(Model.project(a.cap, a.from, 1).total, 1)} xPts). Vice: ${nm(a.vice)}.`
    : `Captain ${nm(a.cap)} (${dec(Model.project(a.cap, a.from, 1).total, 1)} xPts)${a.currentCap ? ` instead of ${nm(a.currentCap)}` : ""}. Vice: ${nm(a.vice)}.`;
  return `
    <div class="assist-grid">
      <div class="assist-card">
        <h3>Gameweek ${a.from} lineup</h3>
        <div class="kv"><div><span>Your XI, projected</span><b>${dec(a.currentPts, 1)}</b></div>
          <div><span>Best XI (${a.best.formation})</span><b class="${a.bestPts - a.currentPts > 0.5 ? "up" : ""}">${dec(a.bestPts, 1)}</b></div></div>
        <ul class="advice">
          <li>${capLine}</li>
          ${a.keeperSwap ? `<li>Start ${nm(a.keeperSwap.in)} in goal (${xp(a.keeperSwap.in)}) instead of ${nm(a.keeperSwap.out)} (${xp(a.keeperSwap.out)}).</li>` : ""}
          ${a.outfield.start.length ? `<li>Start ${a.outfield.start.map((p) => `${nm(p)} (${xp(p)})`).join(", ")}; bench ${a.outfield.bench.map((p) => `${nm(p)} (${xp(p)})`).join(", ")}. Formation ${a.best.formation}.</li>` : ""}
          ${!a.keeperSwap && !a.outfield.start.length ? "<li>Your starting XI is already the best the model can pick.</li>" : ""}
          <li>Bench order: ${a.best.bench.map(nm).join(", ")}.</li>
        </ul>
      </div>
      <div class="assist-card">
        <h3>Transfer ideas · next ${a.H} gameweeks</h3>
        ${a.transfers.length ? `<div class="plan-list">${a.transfers.map((x) => `
          <div class="plan-item suggestion"><span class="out">− ${nm(x.out)}</span>
            <button data-suggest="${x.slot}:${x.in.id}" title="Add to planner">+ plan</button>
            <span class="in">+ ${nm(x.in)} <small>${money(x.in.price)}</small></span>
            <span class="gain">${signed(x.gain)} xPts</span></div>`).join("")}</div>
          <p class="note">A transfer that costs a −4 hit needs to gain more than 4.</p>`
          : '<p class="muted">No affordable upgrade beats your current players over the next few gameweeks.</p>'}
      </div>
      <div class="assist-card">
        <h3>Chips</h3>
        ${a.chips.length ? `<ul class="advice chips">${a.chips.map((c) => `<li><b>${c.name}</b><span class="verdict ${c.verdict === "Hold" ? "" : "go"}">${c.verdict}</span><br><span class="secondary">${c.reason}</span></li>`).join("")}</ul>`
          : '<p class="muted">You have no chips left for this half of the season.</p>'}
        <p class="note">Each chip can be used once per half of the season; this half's chips expire after GW${a.halfEnds}.</p>
      </div>
    </div>`;
}

function claudeHtml() {
  const a = D.advice;
  if (!a || D.myteam && a.teamId !== D.myteam.id) {
    return `<div class="empty">Claude-written advice is off. To turn it on, add an Anthropic API key as a repository secret named <code>ANTHROPIC_API_KEY</code>
      (repo Settings → Secrets and variables → Actions). Each update then asks Claude to review your squad, which uses a small amount of API credit.</div>`;
  }
  const when = new Date(a.generated).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return `<div class="panel pad claude">
    <p class="claude-summary">${esc(a.summary)}</p>
    <div class="assist-grid">
      <div class="assist-card"><h3>Captain</h3><p><b>${esc(a.captain.player)}</b> · ${esc(a.captain.reason)}</p></div>
      <div class="assist-card"><h3>Transfers</h3><ul class="advice">${a.transfers.map((x) => `<li><b>${esc(x.out)} → ${esc(x.in)}</b>: ${esc(x.reason)}</li>`).join("") || "<li>Hold this week.</li>"}</ul></div>
      <div class="assist-card"><h3>Chips</h3><p><b>${esc(a.chip.recommendation)}</b> · ${esc(a.chip.reason)}</p></div>
      ${a.watchlist?.length ? `<div class="assist-card"><h3>Watchlist</h3><ul class="advice">${a.watchlist.map((w) => `<li><b>${esc(w.player)}</b>: ${esc(w.reason)}</li>`).join("")}</ul></div>` : ""}
    </div>
    <p class="note">Written by Claude (${esc(a.model)}) from this site's data, ${when}. It's a second opinion: it may disagree with the model above, and it can be wrong.</p>
  </div>`;
}

// ---------- ratings ----------

const RATING_LABELS = { fut: "FUT", und: "UND", per: "PER", frm: "FRM", min: "MIN", val: "VAL" };
const ratingsView = { pos: 3 };

function ratingCard(p, compact = false) {
  const r = Ratings.get(p.id);
  if (!r) return "";
  return `<div class="rcard rcard-${Ratings.tier(r.ovr)} ${compact ? "compact" : ""}">
    <div class="rc-top"><span class="rc-ovr">${r.ovr}</span><span class="rc-pos">${POSITIONS[p.pos]}</span></div>
    <div class="rc-stats">${Object.entries(RATING_LABELS).map(([k, l]) =>
      `<span title="${Ratings.PARTS[k]}"><b>${r[k]}</b>${l}</span>`).join("")}</div>
  </div>`;
}

function renderRatings() {
  const pos = ratingsView.pos;
  const ranked = D.players.filter((p) => p.pos === pos && Ratings.get(p.id))
    .sort((a, b) => Ratings.get(b.id).ovr - Ratings.get(a.id).ovr || Ratings.get(b.id).fut - Ratings.get(a.id).fut);
  const weights = Object.entries(Ratings.WEIGHTS).map(([k, w]) => `${RATING_LABELS[k]} ${Math.round(w * 100)}%`).join(" · ");

  app.innerHTML = `
    <section class="hero">
      <div class="eyebrow">Player ratings · from gameweek ${firstUpcomingGw()}</div>
      <h1>Ratings</h1>
      <p class="lede">Every player rated 45–99 against others in the same position, blending what's coming with what they've done.
        Each part is a percentile among regulars (270+ minutes): ${weights}. Value is shown but kept out of the overall.</p>
      <div class="legend" style="margin-top:14px">${Object.entries(Ratings.PARTS).map(([k, t]) => `<span class="chip"><b>${RATING_LABELS[k]}</b>&nbsp;${t.split(": ")[1]}</span>`).join("")}</div>
    </section>
    <div class="filters">${segmented("r-pos", { 1: "Goalkeepers", 2: "Defenders", 3: "Midfielders", 4: "Forwards" }, String(pos))}</div>
    <div class="fut-grid">${ranked.slice(0, 12).map((p) => `
      <a class="fut-card fut-${Ratings.tier(Ratings.get(p.id).ovr)}" href="#/player/${p.id}">
        <div class="fc-head"><span class="fc-ovr">${Ratings.get(p.id).ovr}</span><span class="fc-meta">${POSITIONS[p.pos]}<br>${esc(teamShort(p.team))}</span></div>
        ${photo(p, "fc-photo")}
        <div class="fc-name">${esc(p.name)}${roleTags(p)}</div>
        <div class="fc-price">${money(p.price)} · ${dec(Ratings.get(p.id).xpts, 1)} xPts</div>
        <div class="fc-stats">${Object.entries(RATING_LABELS).map(([k, l]) => `<span><b>${Ratings.get(p.id)[k]}</b>${l}</span>`).join("")}</div>
      </a>`).join("")}</div>
    <h2>All ${POSITION_NAMES[pos].toLowerCase()}s</h2>
    <div class="table-wrap"><table>
      <thead><tr><th class="rank">#</th><th class="left">Player</th><th class="left">Team</th><th>Price</th><th>Rating</th>${
        Object.values(RATING_LABELS).map((l) => `<th>${l}</th>`).join("")}<th>xPts next 5</th><th>Pts</th><th class="left">Next 3</th></tr></thead>
      <tbody id="r-rows">${ranked.map((p, i) => { const r = Ratings.get(p.id); return `
        <tr class="clickable" data-id="${p.id}"><td class="rank">${i + 1}</td>
          <td class="name left"><span class="who">${photo(p, "sm")}${esc(p.name)}${statusFlag(p)}${roleTags(p)}</span></td>
          <td class="left">${teamPill(p.team)}</td><td>${money(p.price)}</td><td>${ratingBadge(p)}</td>
          ${Object.keys(RATING_LABELS).map((k) => `<td class="${k === "val" ? "muted" : ""}">${r[k]}</td>`).join("")}
          <td class="hot">${dec(r.xpts, 1)}</td><td>${p.points}</td>
          <td class="left">${(upcomingByTeam.get(p.team) || []).slice(0, 3).map((fx) => fdrChip(fx, true)).join("")}</td></tr>`; }).join("")}
      </tbody></table></div>`;
  onRowClick(document.getElementById("r-rows"));
  document.getElementById("r-pos").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    ratingsView.pos = +b.dataset.k; renderRatings();
  });
}

// ---------- routing ----------

function route() {
  const [page, arg] = location.hash.replace(/^#\/?/, "").split("/");
  document.querySelectorAll("[data-nav]").forEach((a) =>
    a.classList.toggle("active", a.dataset.nav === (page === "player" ? "players" : page || "players")));
  window.scrollTo(0, 0);
  if (page === "fixtures") renderFixtures();
  else if (page === "prices") renderPrices();
  else if (page === "myteam") renderMyTeam();
  else if (page === "stats") renderStats();
  else if (page === "moneyball") renderMoneyball();
  else if (page === "ratings") renderRatings();
  else if (page === "player") renderPlayer(+arg);
  else renderPlayers();
}

(async function start() {
  try {
    await loadData();
  } catch (err) {
    console.error(err);
    return emptyState("No data yet. In the GitHub repo, open <b>Actions → Update data and deploy → Run workflow</b> to fetch it.");
  }
  const updated = new Date(D.meta.updated);
  document.getElementById("updated").textContent =
    `Live data · ${updated.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
  window.addEventListener("hashchange", route);
  route();
})();
