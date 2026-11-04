"use strict";

// ---------- data ----------

const POSITIONS = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
const D = { meta: null, teams: [], players: [], fixtures: [], prices: { dates: [], prices: {} } };
const teamById = new Map();
const playerById = new Map();
const historyCache = new Map();
let upcomingByTeam = new Map(); // team id -> [{gw, opp, home, fdr}] in gameweek order

async function getJson(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function loadData() {
  const [meta, teams, players, fixtures] = await Promise.all(
    ["meta", "teams", "players", "fixtures"].map((n) => getJson(`data/${n}.json`))
  );
  Object.assign(D, { meta, teams, players, fixtures });
  try { D.prices = await getJson("data/prices.json"); } catch { /* first run may not have it */ }
  teams.forEach((t) => teamById.set(t.id, t));
  players.forEach((p) => playerById.set(p.id, p));
  upcomingByTeam = buildUpcoming();
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

async function playerHistory(id) {
  if (!historyCache.has(id)) historyCache.set(id, getJson(`data/players/${id}.json`));
  return historyCache.get(id);
}

// ---------- helpers ----------

const app = document.getElementById("app");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const money = (v) => (v == null ? "–" : `£${v.toFixed(1)}m`);
const dec = (v, n = 1) => (v == null ? "–" : Number(v).toFixed(n));
const teamShort = (id) => teamById.get(id)?.short ?? "?";
const teamName = (id) => teamById.get(id)?.name ?? "?";
const signed = (v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));

function fdrChip(fx) {
  const label = `${teamShort(fx.opp)} (${fx.home ? "H" : "A"})`;
  return `<span class="fdr fdr-${fx.fdr}" title="GW${fx.gw}: ${esc(teamName(fx.opp))} ${fx.home ? "home" : "away"}, difficulty ${fx.fdr}">${esc(label)}</span>`;
}

function statusFlag(p) {
  if (p.status === "a") return "";
  const out = p.status === "i" || p.status === "s" || p.status === "u" || p.chance === 0;
  const text = p.chance != null ? `${p.chance}%` : "!";
  return `<span class="flag ${out ? "out" : ""}" title="${esc(p.news || "Availability doubt")}">${esc(text)}</span>`;
}

function emptyState(html) {
  app.innerHTML = `<div class="empty">${html}</div>`;
}

// ---------- players ----------

const playerColumns = [
  { key: "name", label: "Player", left: true, get: (p) => p.name },
  { key: "team", label: "Team", left: true, get: (p) => teamShort(p.team) },
  { key: "pos", label: "Pos", left: true, get: (p) => p.pos },
  { key: "price", label: "Price", get: (p) => p.price, fmt: money },
  { key: "points", label: "Pts", get: (p) => p.points },
  { key: "form", label: "Form", get: (p) => p.form, fmt: (v) => dec(v) },
  { key: "ppg", label: "PPG", get: (p) => p.ppg, fmt: (v) => dec(v) },
  { key: "own", label: "Own %", get: (p) => p.own, fmt: (v) => dec(v) },
  { key: "mins", label: "Mins", get: (p) => p.mins },
  { key: "goals", label: "G", get: (p) => p.goals },
  { key: "assists", label: "A", get: (p) => p.assists },
  { key: "xg", label: "xG", get: (p) => p.xg, fmt: (v) => dec(v, 2) },
  { key: "xa", label: "xA", get: (p) => p.xa, fmt: (v) => dec(v, 2) },
  { key: "xgi", label: "xGI", get: (p) => p.xgi, fmt: (v) => dec(v, 2) },
  { key: "cs", label: "CS", get: (p) => p.cs },
  { key: "bonus", label: "Bonus", get: (p) => p.bonus },
];

const playerView = { q: "", pos: "", team: "", maxPrice: "", minMins: "", sort: "points", asc: false };

function renderPlayers() {
  const teamOptions = [...D.teams].sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("");
  app.innerHTML = `
    <h1>Players</h1>
    <p class="secondary">Every Premier League player in FPL. Click a column to sort, or a player for their gameweek history.</p>
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
      <thead><tr>${playerColumns.map((c) =>
        `<th class="sortable ${c.left ? "left" : ""}" data-key="${c.key}">${c.label}</th>`).join("")}<th class="left">Next 3</th></tr></thead>
      <tbody id="rows"></tbody>
    </table></div>`;

  const bind = (id, key) => {
    const el = document.getElementById(id);
    el.value = playerView[key];
    el.addEventListener("input", () => { playerView[key] = el.value; fillPlayerRows(); });
  };
  bind("f-q", "q"); bind("f-pos", "pos"); bind("f-team", "team"); bind("f-price", "maxPrice"); bind("f-mins", "minMins");

  app.querySelectorAll("th.sortable").forEach((th) => th.addEventListener("click", () => {
    const key = th.dataset.key;
    if (playerView.sort === key) playerView.asc = !playerView.asc;
    else { playerView.sort = key; playerView.asc = ["name", "team", "pos"].includes(key); }
    fillPlayerRows();
  }));
  document.getElementById("rows").addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-id]");
    if (row) location.hash = `#/player/${row.dataset.id}`;
  });
  fillPlayerRows();
}

function fillPlayerRows() {
  const v = playerView;
  const q = v.q.trim().toLowerCase();
  const col = playerColumns.find((c) => c.key === v.sort);
  const rows = D.players.filter((p) =>
    (!q || p.name.toLowerCase().includes(q) || p.full.toLowerCase().includes(q)) &&
    (!v.pos || p.pos === +v.pos) &&
    (!v.team || p.team === +v.team) &&
    (!v.maxPrice || p.price <= +v.maxPrice) &&
    (!v.minMins || p.mins >= +v.minMins)
  ).sort((a, b) => {
    const x = col.get(a), y = col.get(b);
    const cmp = typeof x === "string" ? x.localeCompare(y) : x - y;
    return (v.asc ? cmp : -cmp) || b.points - a.points;
  });

  app.querySelectorAll("th.sortable").forEach((th) => {
    th.classList.toggle("sorted", th.dataset.key === v.sort);
    th.classList.toggle("asc", th.dataset.key === v.sort && v.asc);
  });
  document.getElementById("count").textContent = `${rows.length} of ${D.players.length} players`;
  document.getElementById("rows").innerHTML = rows.map((p) => `
    <tr class="clickable" data-id="${p.id}">
      <td class="name">${esc(p.name)}${statusFlag(p)}</td>
      <td class="left">${esc(teamShort(p.team))}</td>
      <td class="left">${POSITIONS[p.pos]}</td>
      ${playerColumns.slice(3).map((c) => `<td>${c.fmt ? c.fmt(c.get(p)) : c.get(p)}</td>`).join("")}
      <td class="left">${(upcomingByTeam.get(p.team) || []).slice(0, 3).map(fdrChip).join("")}</td>
    </tr>`).join("");
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
    <h1>Fixture difficulty</h1>
    <p class="secondary">The next gameweeks for every team, using FPL's own difficulty ratings. Two fixtures in a cell is a double gameweek; a dash is a blank.</p>
    <div class="filters">
      <label>Gameweeks<select id="f-horizon">${[3, 5, 6, 8].map((n) =>
        `<option value="${n}" ${n === fixtureView.horizon ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <label>Sort<select id="f-sort">
        <option value="easiest" ${fixtureView.sort === "easiest" ? "selected" : ""}>Easiest run first</option>
        <option value="name" ${fixtureView.sort === "name" ? "selected" : ""}>Team name</option>
      </select></label>
      <div class="legend">Difficulty:
        ${[1, 2, 3, 4, 5].map((n) => `<span class="fdr fdr-${n}">${n}${n === 1 ? " easiest" : n === 5 ? " hardest" : ""}</span>`).join("")}
      </div>
    </div>
    <div class="table-wrap"><table class="fixture-grid">
      <thead><tr><th class="left">Team</th>${gws.map((g) => `<th style="text-align:center">GW${g}</th>`).join("")}<th>Avg</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr><td>${esc(r.team.name)}</td>
          ${gws.map((g) => {
            const list = r.byGw.get(g);
            return `<td>${list.length ? list.map(fdrChip).join("") : '<span class="fdr-blank">–</span>'}</td>`;
          }).join("")}
          <td class="avg">${dec(r.avg, 2)}</td></tr>`).join("")}
      </tbody>
    </table></div>`;

  document.getElementById("f-horizon").addEventListener("change", (e) => { fixtureView.horizon = +e.target.value; renderFixtures(); });
  document.getElementById("f-sort").addEventListener("change", (e) => { fixtureView.sort = e.target.value; renderFixtures(); });
}

// ---------- prices ----------

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
        <td class="name">${esc(r.p.name)}${statusFlag(r.p)}</td>
        <td class="left">${esc(teamShort(r.p.team))}</td>
        <td class="left">${POSITIONS[r.p.pos]}</td>
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
    heading = `This gameweek (daily tracking starts after the second update)`;
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
    <h1>Price changes</h1>
    <p class="secondary">${esc(heading)}. Net transfers this gameweek are the best guide to the next moves.</p>
    <div class="columns">
      ${changeSection("Risers", risers, "risers")}
      ${changeSection("Fallers", fallers, "fallers")}
      <section><h2>Most transferred in</h2>${priceTable([...net].sort((a, b) => b.net - a.net).slice(0, 15), "Net transfers", fmtNet)}</section>
      <section><h2>Most transferred out</h2>${priceTable([...net].sort((a, b) => a.net - b.net).slice(0, 15), "Net transfers", fmtNet)}</section>
    </div>`;
  app.querySelectorAll("tbody").forEach((tb) => tb.addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-id]");
    if (row) location.hash = `#/player/${row.dataset.id}`;
  }));
  app.querySelectorAll("[data-show]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    priceView.showAll[a.dataset.show] = true;
    renderPrices();
  }));
}

const priceView = { showAll: {} };

// ---------- player page ----------

async function renderPlayer(id) {
  const p = playerById.get(id);
  if (!p) return emptyState(`No player with id ${esc(id)}. <a href="#/players">Back to players</a>`);
  const tile = (label, value) => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div></div>`;
  const upcoming = (upcomingByTeam.get(p.team) || []).slice(0, 6);

  app.innerHTML = `
    <p><a href="#/players">← Players</a></p>
    <h1>${esc(p.full)}${statusFlag(p)}</h1>
    <div class="secondary">${esc(teamName(p.team))} · ${POSITIONS[p.pos]} · ${money(p.price)}
      <span class="${p.changeStart > 0 ? "up" : p.changeStart < 0 ? "down" : ""}">(${signed(p.changeStart)} this season)</span></div>
    ${p.news ? `<div class="news">${esc(p.news)}</div>` : ""}
    <div class="tiles">
      ${tile("Total points", p.points)}${tile("Form", dec(p.form))}${tile("Points per game", dec(p.ppg))}
      ${tile("Selected by", `${dec(p.own)}%`)}${tile("Minutes", p.mins.toLocaleString())}
      ${tile("Goals / assists", `${p.goals} / ${p.assists}`)}${tile("xG / xA", `${dec(p.xg, 1)} / ${dec(p.xa, 1)}`)}
      ${tile("Bonus", p.bonus)}
    </div>
    <h2>Next fixtures</h2>
    <div>${upcoming.length ? upcoming.map((fx) => `GW${fx.gw} ${fdrChip(fx)}`).join(" &nbsp; ") : '<span class="muted">None scheduled</span>'}</div>
    <div id="history"><p class="muted">Loading gameweek history…</p></div>`;

  let history;
  try { history = await playerHistory(id); } catch {
    document.getElementById("history").innerHTML = '<div class="empty">No gameweek history saved for this player yet.</div>';
    return;
  }
  if (location.hash !== `#/player/${id}`) return; // navigated away while loading
  const el = document.getElementById("history");
  if (!history.length) { el.innerHTML = '<h2>Gameweek history</h2><div class="empty">No games played yet this season.</div>'; return; }

  el.innerHTML = `
    <h2>Gameweek history</h2>
    <div class="charts">
      <div class="chart"><h3>Points per gameweek</h3><div id="points-chart"></div></div>
      <div class="chart"><h3>Price (£m)</h3><div id="price-chart"></div></div>
    </div>
    <h2>Every game</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>GW</th><th class="left">Opponent</th><th>Result</th><th>Pts</th><th>Mins</th><th>G</th><th>A</th><th>xG</th><th>xA</th><th>CS</th><th>Bonus</th><th>Price</th></tr></thead>
      <tbody>${[...history].reverse().map((h) => `
        <tr><td>${h.gw}</td><td class="left">${esc(teamShort(h.opp))} (${h.home ? "H" : "A"})</td>
          <td>${esc(h.score ?? "–")}</td><td><b>${h.points}</b></td><td>${h.mins}</td><td>${h.goals}</td><td>${h.assists}</td>
          <td>${dec(h.xg, 2)}</td><td>${dec(h.xa, 2)}</td><td>${h.cs}</td><td>${h.bonus}</td><td>${money(h.price)}</td></tr>`).join("")}
      </tbody></table></div>`;

  const tip = (h) => `<b>GW${h.gw}</b> vs ${esc(teamShort(h.opp))} (${h.home ? "H" : "A"})<br>`;
  barChart(document.getElementById("points-chart"), history, {
    value: (h) => h.points,
    dim: (h) => h.mins === 0,
    tooltip: (h) => `${tip(h)}${h.points} pts · ${h.mins} mins`,
  });
  lineChart(document.getElementById("price-chart"), history, {
    value: (h) => h.price,
    tooltip: (h) => `${tip(h)}${money(h.price)}`,
  });
}

// ---------- charts (inline SVG, one series each) ----------

const CH = { w: 560, h: 200, l: 34, r: 8, t: 10, b: 24 };

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const ticks = [];
  const top = Math.ceil(max / step - 1e-9) * step;
  for (let v = Math.floor(min / step) * step; v <= top + step * 1e-9; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

function chartFrame(container, ticks, y, xLabels, fmtTick) {
  const plotW = CH.w - CH.l - CH.r;
  const grid = ticks.map((t) =>
    `<line x1="${CH.l}" x2="${CH.w - CH.r}" y1="${y(t)}" y2="${y(t)}"></line>`).join("");
  const labels = ticks.map((t) =>
    `<text x="${CH.l - 6}" y="${y(t) + 4}" text-anchor="end">${fmtTick(t)}</text>`).join("");
  const every = Math.ceil(xLabels.length / 12);
  const xl = xLabels.map((lab, i) => i % every ? "" :
    `<text x="${lab.x}" y="${CH.h - 6}" text-anchor="middle">${lab.text}</text>`).join("");
  container.innerHTML = `<svg viewBox="0 0 ${CH.w} ${CH.h}" role="img"><g class="grid">${grid}</g>${labels}${xl}<g class="marks"></g></svg>
    <div class="tooltip"></div>`;
  return { svg: container.querySelector("svg"), marks: container.querySelector(".marks"), tooltip: container.querySelector(".tooltip"), plotW };
}

function showTip(container, tooltip, html, evt) {
  const box = container.getBoundingClientRect();
  tooltip.innerHTML = html;
  tooltip.style.display = "block";
  const x = evt.clientX - box.left, yPos = evt.clientY - box.top;
  const w = tooltip.offsetWidth;
  tooltip.style.left = `${Math.min(Math.max(0, x - w / 2), box.width - w)}px`;
  tooltip.style.top = `${Math.max(0, yPos - tooltip.offsetHeight - 12)}px`;
}

function barChart(container, rows, { value, dim, tooltip }) {
  const vals = rows.map(value);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(1, ...vals));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const y = (v) => CH.t + (hi - v) / (hi - lo) * (CH.h - CH.t - CH.b);
  const slot = (CH.w - CH.l - CH.r) / rows.length;
  const barW = Math.max(3, Math.min(22, slot - 2));
  const cx = (i) => CH.l + slot * i + slot / 2;
  const { marks, tooltip: tt } = chartFrame(container, ticks, y,
    rows.map((h, i) => ({ x: cx(i), text: h.gw })), (t) => t);

  const r = Math.min(4, barW / 2);
  marks.innerHTML = rows.map((h, i) => {
    const v = vals[i], x0 = cx(i) - barW / 2, base = y(0), top = y(v);
    const hgt = Math.abs(base - top);
    const rr = Math.min(r, hgt);
    // Rounded at the data end, square on the baseline.
    const d = v >= 0
      ? `M${x0},${base}V${top + rr}Q${x0},${top} ${x0 + rr},${top}H${x0 + barW - rr}Q${x0 + barW},${top} ${x0 + barW},${top + rr}V${base}Z`
      : `M${x0},${base}V${top - rr}Q${x0},${top} ${x0 + rr},${top}H${x0 + barW - rr}Q${x0 + barW},${top} ${x0 + barW},${top - rr}V${base}Z`;
    return `<path class="bar ${dim(h) ? "dim" : ""}" d="${d}"></path>
      <rect class="hit" data-i="${i}" x="${CH.l + slot * i}" y="${CH.t}" width="${slot}" height="${CH.h - CH.t - CH.b}"></rect>`;
  }).join("") + `<line class="axis-line" x1="${CH.l}" x2="${CH.w - CH.r}" y1="${y(0)}" y2="${y(0)}"></line>`;

  marks.addEventListener("mousemove", (e) => {
    const i = e.target.dataset?.i;
    if (i == null) return;
    showTip(container, tt, tooltip(rows[i]), e);
  });
  marks.addEventListener("mouseleave", () => { tt.style.display = "none"; });
}

function lineChart(container, rows, { value, tooltip }) {
  const vals = rows.map(value);
  const ticks = niceTicks(Math.min(...vals) - 0.1, Math.max(...vals) + 0.1);
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const y = (v) => CH.t + (hi - v) / (hi - lo) * (CH.h - CH.t - CH.b);
  const plotW = CH.w - CH.l - CH.r;
  const x = (i) => CH.l + (rows.length === 1 ? plotW / 2 : (plotW * i) / (rows.length - 1));
  const { svg, marks, tooltip: tt } = chartFrame(container, ticks, y,
    rows.map((h, i) => ({ x: x(i), text: h.gw })), (t) => t.toFixed(1));

  const path = vals.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join("");
  marks.innerHTML = `
    <line class="cross" x1="0" x2="0" y1="${CH.t}" y2="${CH.h - CH.b}" style="display:none"></line>
    <path class="line" d="${path}"></path>
    ${vals.length <= 40 ? vals.map((v, i) => `<circle class="dot" cx="${x(i)}" cy="${y(v)}" r="4"></circle>`).join("") : ""}
    <rect class="hit" x="${CH.l}" y="${CH.t}" width="${plotW}" height="${CH.h - CH.t - CH.b}"></rect>`;

  const cross = marks.querySelector(".cross");
  const hit = marks.querySelector(".hit");
  hit.addEventListener("mousemove", (e) => {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const local = pt.matrixTransform(svg.getScreenCTM().inverse());
    const i = rows.length === 1 ? 0 : Math.round(((local.x - CH.l) / plotW) * (rows.length - 1));
    const idx = Math.max(0, Math.min(rows.length - 1, i));
    cross.setAttribute("x1", x(idx)); cross.setAttribute("x2", x(idx));
    cross.style.display = "";
    showTip(container, tt, tooltip(rows[idx]), e);
  });
  hit.addEventListener("mouseleave", () => { cross.style.display = "none"; tt.style.display = "none"; });
}

// ---------- routing ----------

function route() {
  const [page, arg] = location.hash.replace(/^#\/?/, "").split("/");
  document.querySelectorAll("[data-nav]").forEach((a) =>
    a.classList.toggle("active", a.dataset.nav === (page === "player" ? "players" : page || "players")));
  window.scrollTo(0, 0);
  if (page === "fixtures") renderFixtures();
  else if (page === "prices") renderPrices();
  else if (page === "player") renderPlayer(+arg);
  else renderPlayers();
}

(async function start() {
  try {
    await loadData();
  } catch (err) {
    console.error(err);
    return emptyState(`No data yet. In the GitHub repo, open <b>Actions → Update data and deploy → Run workflow</b> to fetch it.`);
  }
  const updated = new Date(D.meta.updated);
  document.getElementById("updated").textContent =
    `Updated ${updated.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` +
    (D.meta.currentGw ? ` · GW${D.meta.currentGw}` : "");
  window.addEventListener("hashchange", route);
  route();
})();
