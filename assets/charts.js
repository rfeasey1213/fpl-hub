"use strict";
// Small SVG/HTML chart kit. Every chart is single-axis; colours come from CSS tokens.

// Categorical slots, validated for the dark surface (adjacent pairs).
const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9"];

const Charts = (() => {

  function niceTicks(min, max, count = 4, minStep = 0) {
    const span = max - min || 1;
    const step0 = span / count;
    const mag = 10 ** Math.floor(Math.log10(step0));
    const step = Math.max(minStep, [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0));
    const ticks = [];
    const top = Math.ceil(max / step - 1e-9) * step;
    for (let v = Math.floor(min / step) * step; v <= top + step * 1e-9; v += step) ticks.push(+v.toFixed(6));
    return ticks;
  }

  function showTip(container, tooltip, html, evt) {
    const box = container.getBoundingClientRect();
    tooltip.innerHTML = html;
    tooltip.style.display = "block";
    const x = evt.clientX - box.left, y = evt.clientY - box.top;
    const w = tooltip.offsetWidth;
    tooltip.style.left = `${Math.min(Math.max(0, x - w / 2), box.width - w)}px`;
    tooltip.style.top = `${Math.max(-10, y - tooltip.offsetHeight - 14)}px`;
  }

  // Draws gridlines, y labels and x labels; returns the marks group and tooltip.
  function frame(container, { W, h, l = 44, r = 10, t = 12, b = 24, ticks, y, xLabels, tickFmt, xTitle, yTitle }) {
    const grid = ticks.map((v) => `<line x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}"></line>`).join("");
    const labels = ticks.map((v) => `<text x="${l - 8}" y="${y(v) + 4}" text-anchor="end">${tickFmt(v)}</text>`).join("");
    const every = Math.ceil(xLabels.length / 12) || 1;
    const xl = xLabels.map((lab, i) => (i % every ? "" : `<text x="${lab.x}" y="${h - b + 16}" text-anchor="middle">${lab.text}</text>`)).join("");
    container.innerHTML = `<svg viewBox="0 0 ${W} ${h}" role="img">
      <defs><linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(4,245,255,0.26)"/><stop offset="1" stop-color="rgba(4,245,255,0)"/></linearGradient></defs>
      <g class="grid">${grid}</g>${labels}${xl}
      ${xTitle ? `<text class="axis-title" x="${W - r}" y="${h - 2}" text-anchor="end">${xTitle}</text>` : ""}
      ${yTitle ? `<text class="axis-title" x="${l}" y="${t - 2}" text-anchor="start">${yTitle}</text>` : ""}
      <g class="marks"></g></svg><div class="tooltip"></div>`;
    return { svg: container.querySelector("svg"), marks: container.querySelector(".marks"), tooltip: container.querySelector(".tooltip") };
  }

  function legend(series) {
    return `<div class="chart-legend">${series.map((s) =>
      `<span><i style="background:${s.color}"></i>${s.name}</span>`).join("")}</div>`;
  }

  // Vertical bars, one series. Bars are rounded at the data end and square on the baseline.
  function bars(container, rows, { label, value, tooltip, dim = () => false, h = 210, w: W = 560, tickFmt = (v) => v, color }) {
    const l = 44, r = 10, t = 12, b = 24;
    const vals = rows.map(value);
    const ticks = niceTicks(Math.min(0, ...vals), Math.max(h < 180 ? 0.1 : 1, ...vals), h < 180 ? 3 : 4);
    const lo = ticks[0], hi = ticks[ticks.length - 1];
    const y = (v) => t + ((hi - v) / (hi - lo)) * (h - t - b);
    const slot = (W - l - r) / rows.length;
    const barW = Math.max(3, Math.min(22, slot - 2));
    const cx = (i) => l + slot * i + slot / 2;
    const { marks, tooltip: tt } = frame(container, { W, h, l, r, t, b, ticks, y, tickFmt, xLabels: rows.map((d, i) => ({ x: cx(i), text: label(d) })) });
    const rad = Math.min(4, barW / 2);
    marks.innerHTML = rows.map((d, i) => {
      const v = vals[i], x0 = cx(i) - barW / 2, base = y(0), top = y(v);
      const rr = Math.min(rad, Math.abs(base - top));
      const path = v >= 0
        ? `M${x0},${base}V${top + rr}Q${x0},${top} ${x0 + rr},${top}H${x0 + barW - rr}Q${x0 + barW},${top} ${x0 + barW},${top + rr}V${base}Z`
        : `M${x0},${base}V${top - rr}Q${x0},${top} ${x0 + rr},${top}H${x0 + barW - rr}Q${x0 + barW},${top} ${x0 + barW},${top - rr}V${base}Z`;
      return `<path class="bar ${dim(d) ? "dim" : ""}" d="${path}" ${color ? `style="fill:${color}"` : ""}></path>
        <rect class="hit" data-i="${i}" x="${l + slot * i}" y="${t}" width="${slot}" height="${h - t - b}"></rect>`;
    }).join("") + `<line class="axis-line" x1="${l}" x2="${W - r}" y1="${y(0)}" y2="${y(0)}"></line>`;
    marks.addEventListener("mousemove", (e) => {
      const i = e.target.dataset?.i;
      if (i != null) showTip(container, tt, tooltip(rows[i]), e);
    });
    marks.addEventListener("mouseleave", () => { tt.style.display = "none"; });
  }

  // One or more lines over shared x labels. series: [{name, values, color}]
  function lines(container, { labels, series, tooltip, tickFmt = (v) => v, pad = 0, minStep = 0, invert = false, area = series.length === 1, h = 210, w: W = 560, fromZero = false }) {
    const l = 44, r = series.length > 1 ? 54 : 10, t = 12, b = 24;
    const all = series.flatMap((s) => s.values).filter((v) => v != null);
    const ticks = niceTicks((fromZero ? Math.min(0, ...all) : Math.min(...all)) - pad, Math.max(...all) + pad, 4, minStep);
    const lo = ticks[0], hi = ticks[ticks.length - 1];
    const plotH = h - t - b, plotW = W - l - r;
    const y = (v) => t + (invert ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo)) * plotH;
    const x = (i) => l + (labels.length === 1 ? plotW / 2 : (plotW * i) / (labels.length - 1));
    const target = series.length > 1 ? document.createElement("div") : container;
    if (series.length > 1) { container.innerHTML = ""; container.append(target); }
    const { svg, marks, tooltip: tt } = frame(target, { W, h, l, r, t, b, ticks, y, tickFmt, xLabels: labels.map((text, i) => ({ x: x(i), text })) });
    const pathOf = (vals) => vals.map((v, i) => (v == null ? "" : `${i && vals[i - 1] != null ? "L" : "M"}${x(i)},${y(v)}`)).join("");
    const floor = t + plotH;
    marks.innerHTML = `
      ${area ? `<path class="area" d="${pathOf(series[0].values)}L${x(series[0].values.length - 1)},${floor}L${x(0)},${floor}Z"></path>` : ""}
      <line class="cross" x1="0" x2="0" y1="${t}" y2="${floor}" style="display:none"></line>
      ${series.map((s) => `<path class="line" d="${pathOf(s.values)}" style="stroke:${s.color || "var(--cyan)"}${s.dashed ? ";stroke-dasharray:4 4" : ""}"></path>`).join("")}
      ${series.map((s) => labels.length <= 40 ? s.values.map((v, i) => v == null ? "" :
        `<circle class="dot" cx="${x(i)}" cy="${y(v)}" r="4" style="fill:${s.color || "var(--cyan)"}"></circle>`).join("") : "").join("")}
      ${series.length > 1 ? series.map((s) => {
        const last = s.values.length - 1;
        return s.values[last] == null ? "" : `<text class="end-label" x="${x(last) + 8}" y="${y(s.values[last]) + 4}">${tickFmt(s.values[last])}</text>`;
      }).join("") : ""}
      <rect class="hit" x="${l}" y="${t}" width="${plotW}" height="${plotH}"></rect>`;
    if (series.length > 1) target.insertAdjacentHTML("beforebegin", legend(series));
    const cross = marks.querySelector(".cross");
    const hit = marks.querySelector(".hit");
    hit.addEventListener("mousemove", (e) => {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const local = pt.matrixTransform(svg.getScreenCTM().inverse());
      const i = labels.length === 1 ? 0 : Math.round(((local.x - l) / plotW) * (labels.length - 1));
      const idx = Math.max(0, Math.min(labels.length - 1, i));
      cross.setAttribute("x1", x(idx)); cross.setAttribute("x2", x(idx));
      cross.style.display = "";
      showTip(target, tt, tooltip(idx), e);
    });
    hit.addEventListener("mouseleave", () => { cross.style.display = "none"; tt.style.display = "none"; });
  }

  // Scatter of points [{x, y, label, data}]; `highlight` points get a direct label.
  function scatter(container, points, { xFmt = (v) => v, yFmt = (v) => v, xTitle, yTitle, tooltip, onClick, highlight = new Set(), color = "var(--cyan)", h = 300, w: W = 560, xMin, yMin, trend }) {
    const l = 44, r = 14, t = 18, b = 34;
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const yt = niceTicks(yMin ?? Math.min(...ys), Math.max(...ys), 4);
    const xt = niceTicks(xMin ?? Math.min(...xs), Math.max(...xs), 5);
    const ylo = yt[0], yhi = yt[yt.length - 1], xlo = xt[0], xhi = xt[xt.length - 1];
    const y = (v) => t + ((yhi - v) / (yhi - ylo)) * (h - t - b);
    const x = (v) => l + ((v - xlo) / (xhi - xlo)) * (W - l - r);
    const { marks, tooltip: tt } = frame(container, { W, h, l, r, t, b, ticks: yt, y, tickFmt: yFmt, xTitle, yTitle,
      xLabels: xt.map((v) => ({ x: x(v), text: xFmt(v) })) });
    const order = points.map((p, i) => i).sort((a, b) => highlight.has(points[a]) - highlight.has(points[b]));
    // Optional trend line y = a + b·x, clipped to the plot.
    const clipY = (v) => Math.max(ylo, Math.min(yhi, v));
    const trendLine = trend ? `<line class="trend" x1="${x(xlo)}" y1="${y(clipY(trend.a + trend.b * xlo))}" x2="${x(xhi)}" y2="${y(clipY(trend.a + trend.b * xhi))}"></line>` : "";
    marks.innerHTML = trendLine + order.map((i) => {
      const p = points[i], hl = highlight.has(p);
      return `<circle class="pt ${hl ? "hl" : ""}" data-i="${i}" cx="${x(p.x)}" cy="${y(p.y)}" r="${hl ? 5.5 : 4}" style="fill:${color}"></circle>`;
    }).join("") + placeLabels([...highlight].map((p) => ({ p, px: x(p.x), py: y(p.y) })), W - r).join("");
    marks.addEventListener("mousemove", (e) => {
      const i = e.target.dataset?.i;
      if (i == null) { tt.style.display = "none"; return; }
      showTip(container, tt, tooltip(points[i]), e);
    });
    marks.addEventListener("mouseleave", () => { tt.style.display = "none"; });
    if (onClick) marks.addEventListener("click", (e) => { const i = e.target.dataset?.i; if (i != null) onClick(points[i]); });
  }

  // Direct labels for highlighted points, skipping any that would overlap one already placed.
  function placeLabels(items, right) {
    const placed = [];
    const out = [];
    for (const { p, px, py } of items.sort((a, b) => a.py - b.py)) {
      const text = String(p.label).replace(/<[^>]+>/g, "");
      const width = text.length * 6.4 + 4;
      const flip = px + 8 + width > right;
      for (const dy of [-8, 14, -20, 26]) {
        const x0 = flip ? px - 8 - width : px + 8, y0 = py + dy - 10;
        const box = { x0, x1: x0 + width, y0, y1: y0 + 12 };
        if (placed.some((q) => box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0)) continue;
        placed.push(box);
        out.push(`<text class="pt-label" x="${flip ? px - 8 : px + 8}" y="${py + dy}" text-anchor="${flip ? "end" : "start"}">${p.label}</text>`);
        break;
      }
    }
    return out;
  }

  // Horizontal leaderboard bars in HTML: rows [{label, sub, value, id}]
  function hbars(container, rows, { fmt = (v) => v, onClick, color }) {
    const max = Math.max(...rows.map((r) => r.value), 0) || 1;
    container.innerHTML = `<div class="hbars">${rows.map((r, i) => `
      <div class="hbar ${onClick ? "clickable" : ""}" data-i="${i}">
        <span class="hb-rank">${i + 1}</span>
        <span class="hb-label">${r.label}${r.sub ? `<small>${r.sub}</small>` : ""}</span>
        <span class="hb-track"><span class="hb-fill" style="width:${Math.max(1.5, (r.value / max) * 100)}%${color ? `;background:${color}` : ""}"></span></span>
        <span class="hb-val">${fmt(r.value)}</span>
      </div>`).join("")}</div>`;
    if (onClick) container.querySelector(".hbars").addEventListener("click", (e) => {
      const row = e.target.closest(".hbar");
      if (row) onClick(rows[row.dataset.i]);
    });
  }

  // One horizontal stacked bar of positive parts: [{label, value, color}]
  function stacked(container, parts, { fmt = (v) => v, total }) {
    const pos = parts.filter((p) => p.value > 0);
    const sum = total ?? pos.reduce((a, p) => a + p.value, 0);
    container.innerHTML = `
      <div class="stack">${pos.map((p) => `<span class="seg" style="flex:${p.value};background:${p.color}" title="${p.label}: ${fmt(p.value)}">${p.value / sum > 0.07 ? fmt(p.value) : ""}</span>`).join("")}</div>
      <div class="chart-legend">${pos.map((p) => `<span><i style="background:${p.color}"></i>${p.label} <b>${fmt(p.value)}</b></span>`).join("")}</div>`;
  }

  return { bars, lines, scatter, hbars, stacked, niceTicks };
})();
