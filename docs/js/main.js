/* The Excellent Gentlemen — league history SPA */

let L = null; // league.json payload

// ── tiny utils ─────────────────────────────────────────────────────────────
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const num = (v, d = 2) => v == null ? "—" : Number(v).toFixed(d);
const int = v => v == null ? "—" : String(v);
const rec = (w, l, t) => `${w}-${l}${t ? "-" + t : "-0"}`;
const pctf = p => p == null ? "—" : ("." + String(Math.round(p * 1000)).padStart(3, "0"));
const plus = v => v == null ? "—" : (v > 0 ? "+" + v : String(v));
const mname = mk => L.managers[mk] ? L.managers[mk].name : mk;
const isHidden = mk => /^mystery|hidden/.test(mk);
const mdisp = mk => esc(mname(mk));
const isCurrent = mk => !!L.managers[mk]?.seasons?.[String(Math.max(...L.league.years))];
const mlink = mk => `<a class="mgr-link" href="#/manager/${encodeURIComponent(mk)}">${mdisp(mk)}</a>`;
const mkeyOf = name => String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
const years = () => L.league.years.map(String);
const lastSeason = () => String(Math.max(...L.league.years));

function teamOf(y, tid) {
  const t = L.seasons[y]?.teams?.[tid];
  return t ? t.name : "?";
}
function mgrOfTeam(y, tid) {
  const t = L.seasons[y]?.teams?.[tid];
  return t ? mkeyOf(t.manager) : null;
}

// ── sparkline ──────────────────────────────────────────────────────────────
function spark(points, {w = 260, h = 68, min = null, max = null, invert = false, baseline = null, fmt = v => String(v)} = {}) {
  const vals = points.filter(p => p.v != null);
  if (!vals.length) return "";
  let lo = min ?? Math.min(...vals.map(p => p.v));
  let hi = max ?? Math.max(...vals.map(p => p.v));
  if (lo === hi) { lo -= 1; hi += 1; }
  const padL = 8, padR = 44, padT = 14, padB = 9;
  const X = i => padL + i * (w - padL - padR) / Math.max(points.length - 1, 1);
  const Y = v => {
    let f = (v - lo) / (hi - lo);
    if (invert) f = 1 - f;
    return padT + (1 - f) * (h - padT - padB);
  };
  const segs = [];
  let path = "";
  let lastIdx = -1;
  points.forEach((p, i) => {
    if (p.v == null) { path = ""; return; }
    lastIdx = i;
    path += (path ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.v).toFixed(1);
    segs.push(`<circle class="dot" cx="${X(i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="2.6"><title>${esc(p.t)}</title></circle>`);
    if (path && (i === points.length - 1 || points[i + 1].v == null)) {
      segs.unshift(`<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2"/>`);
      path = "";
    }
  });
  let base = "";
  if (baseline != null && baseline >= lo && baseline <= hi) {
    base = `<line x1="${padL}" x2="${w - padR + 26}" y1="${Y(baseline).toFixed(1)}" y2="${Y(baseline).toFixed(1)}" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="4 4" opacity=".55"/>`;
  }
  const topVal = invert ? lo : hi, botVal = invert ? hi : lo;
  const txt = `font-family:var(--font);fill:var(--ink-3);font-size:9px`;
  const labels = `
    <text x="${padL}" y="9" style="${txt}">${esc(fmt(topVal))}</text>
    <text x="${padL}" y="${h - 1}" style="${txt}">${esc(fmt(botVal))}</text>`;
  let endLabel = "";
  if (lastIdx >= 0) {
    const lv = points[lastIdx].v;
    const yE = Math.min(Math.max(Y(lv) + 3, 12), h - 4);
    endLabel = `<text x="${(X(lastIdx) + 6).toFixed(1)}" y="${yE.toFixed(1)}" style="font-family:var(--font);fill:var(--accent);font-size:10.5px;font-weight:650">${esc(fmt(lv))}</text>`;
  }
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px">${base}${segs.join("")}${labels}${endLabel}</svg>`;
}

// ── sortable table ─────────────────────────────────────────────────────────
// One delegated listener on #app handles every table, so sorting keeps
// working after re-renders (each sort replaces the table's DOM).
let uid = 0;
const tableRegistry = new Map();

function table(cols, rows, {sortCol = null, sortDir = -1, rowHref = null} = {}) {
  const id = "t" + (++uid);
  const render = (sc, sd) => {
    const sorted = [...rows];
    if (sc != null) {
      const col = cols[sc];
      sorted.sort((a, b) => {
        const va = col.val(a), vb = col.val(b);
        if (va == null) return 1;
        if (vb == null) return -1;
        return (va < vb ? -1 : va > vb ? 1 : 0) * sd;
      });
    }
    return `<div class="tablewrap"><table id="${id}" data-sc="${sc ?? ""}" data-sd="${sd}">
      <thead><tr>${cols.map((c, i) =>
        `<th class="${c.num ? "num" : ""} ${i === sc ? "sorted" : ""}" data-i="${i}">${esc(c.h)}${i === sc ? (sd < 0 ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead>
      <tbody>${sorted.map(r =>
        `<tr ${rowHref ? `class="rowlink" data-href="${rowHref(r)}"` : ""}>${cols.map(c =>
          `<td class="${c.num ? "num" : ""}">${c.fmt ? c.fmt(r) : esc(c.val(r))}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
  };
  tableRegistry.set(id, render);
  return render(sortCol, sortDir);
}

function initTableDelegation(app) {
  app.addEventListener("click", e => {
    const th = e.target.closest("th[data-i]");
    const tr = e.target.closest("tr.rowlink");
    if (th) {
      const el = th.closest("table[id]");
      const render = el && tableRegistry.get(el.id);
      if (!render) return;
      const i = +th.dataset.i;
      const cur = el.dataset.sc === "" ? null : +el.dataset.sc;
      const dir = (cur === i && +el.dataset.sd === -1) ? 1 : -1;
      el.closest(".tablewrap").outerHTML = render(i, dir);
    } else if (tr && !e.target.closest("a")) {
      location.hash = tr.dataset.href;
    }
  });
}

// ── views ──────────────────────────────────────────────────────────────────
const views = {};

views.home = () => {
  const ys = years();
  const games = ys.reduce((n, y) => n + L.seasons[y].matchups.length + L.seasons[y].playoffs.games.filter(g => g.b).length, 0);
  const mgrs = Object.keys(L.managers);
  const high = L.records.high_score[0];
  const close = L.records.closest_game[0];
  const blow = L.records.biggest_blowout[0];

  const careers = mgrs.map(mk => ({mk, ...L.managers[mk].career}))
    .filter(c => c.seasons >= 3);
  const bestPct = [...careers].sort((a, b) => b.pct - a.pct)[0];
  const bridesmaid = [...careers].filter(c => !c.titles && c.seasons >= 5 && c.mk !== bestPct.mk)
    .sort((a, b) => b.w - a.w)[0];
  const throne = Object.keys(L.managers)
    .map(mk => ({mk, titles: L.managers[mk].career.titles}))
    .filter(x => x.titles > 0).sort((a, b) => b.titles - a.titles);
  const allStreaks = Object.keys(L.managers).map(mk => ({mk, ...L.managers[mk].streaks}));
  const streakBest = [...allStreaks].sort((a, b) => b.longest_win - a.longest_win)[0];
  const streakWorst = [...allStreaks].sort((a, b) => b.longest_loss - a.longest_loss)[0];
  const lucky = [...careers].sort((a, b) => b.luck - a.luck)[0];
  const unlucky = [...careers].sort((a, b) => a.luck - b.luck)[0];

  return `
  <p class="kicker">Est. 2015 · ${ys.length} seasons</p>
  <h1>The Excellent Gentlemen</h1>
  <p class="sub">Born <em>League of Extraordinary Men</em>, briefly <em>Bad Boyz</em>, now permanently distinguished.
  Eleven years of glory, heartbreak, and drafting kickers too early — all of it on the record.</p>

  <div class="statrow">
    <div class="stat"><div class="v num">${ys.length}</div><div class="l">Seasons</div></div>
    <div class="stat"><div class="v num">${games}</div><div class="l">Games played</div></div>
    <div class="stat"><div class="v num">${mgrs.length}</div><div class="l">Managers all-time</div></div>
    <div class="stat gold"><div class="v num">${num(high.score)}</div><div class="l">Highest score ever — ${esc(high.team)}, ${high.year} wk ${high.week}</div></div>
  </div>

  <h2>🏆 Champions</h2>
  <div class="champs">${[...L.league.champions].reverse().map(c => `
    <a class="champ-card" href="#/season/${c.year}">
      <div class="year">${c.year}</div>
      <div class="team">${esc(c.team)}</div>
      <div class="mgr">${isHidden(mkeyOf(c.manager)) ? "Mystery manager" : esc(c.manager)}</div>
    </a>`).join("")}
  </div>

  <h2>League lore</h2>
  <div class="grid cols-3">
    <a class="card" href="#/honors"><div class="kicker">The throne</div>
      <h3>${throne.slice(0, 2).map(x => `${mdisp(x.mk)} ${x.titles}`).join(" — ")}</h3>
      <p class="dim small">${throne.length > 2 ? "Then " + throne.slice(2).map(x => `${mdisp(x.mk)} (${x.titles})`).join(", ") + "." : ""} Full trophy room in Honors.</p></a>
    <a class="card" href="#/managers"><div class="kicker">Best career record · 3+ seasons</div>
      <h3>${mdisp(bestPct.mk)} — ${pctf(bestPct.pct)}</h3>
      <p class="dim small">${rec(bestPct.w, bestPct.l, bestPct.t)} over ${bestPct.seasons} seasons, ${bestPct.titles} title${bestPct.titles === 1 ? "" : "s"}. One-year wonders (looking at you, Kadin) need a longer résumé.</p></a>
    ${bridesmaid ? `<a class="card" href="#/manager/${encodeURIComponent(bridesmaid.mk)}"><div class="kicker">The bridesmaid award</div>
      <h3>${mdisp(bridesmaid.mk)}</h3>
      <p class="dim small">${bridesmaid.w} career wins across ${bridesmaid.seasons} seasons. Titles: zero. Somebody hug this man.</p></a>` : ""}
    <a class="card" href="#/managers"><div class="kicker">Luck, quantified</div>
      <h3>${mdisp(lucky.mk)} ${plus(lucky.luck)} · ${mdisp(unlucky.mk)} ${plus(unlucky.luck)}</h3>
      <p class="dim small">Career wins above/below what the scores deserved (all-play). The schedule fairy plays favorites.</p></a>
    <a class="card" href="#/manager/${encodeURIComponent(streakBest.mk)}"><div class="kicker">Streaks</div>
      <h3>${mdisp(streakBest.mk)} ${streakBest.longest_win}W · ${mdisp(streakWorst.mk)} ${streakWorst.longest_loss}L</h3>
      <p class="dim small">Longest win streak and longest skid in league history — seasons roll over, streaks don't care. Playoffs included.</p></a>
    <a class="card" href="#/records"><div class="kicker">Closest game ever</div>
      <h3>${num(Math.abs(close.margin))} points</h3>
      <p class="dim small">${esc(close.team)} ${num(close.score)} — ${num(close.opp_score)} ${esc(close.opp)}, ${close.year} week ${close.week}.</p></a>
    <a class="card" href="#/records"><div class="kicker">Biggest beatdown</div>
      <h3>by ${num(blow.margin)}</h3>
      <p class="dim small">${esc(blow.team)} ${num(blow.score)} — ${num(blow.opp_score)} ${esc(blow.opp)}, ${blow.year} week ${blow.week}.</p></a>
    <a class="card" href="#/rivalries"><div class="kicker">Rivalries</div>
      <h3>Head-to-head, all eleven years</h3>
      <p class="dim small">Every matchup ever played, tallied. Find out who actually owns whom.</p></a>
  </div>`;
};

views.seasons = () => `
  <p class="kicker">Archive</p>
  <h1>Seasons</h1>
  <div class="grid cols-3" style="margin-top:18px">
  ${[...years()].reverse().map(y => {
    const s = L.seasons[y];
    const pod = s.playoffs.podium;
    const name = s.settings.league_name || L.league.name;
    return `<a class="card" href="#/season/${y}">
      <div class="kicker">${y}${name !== "The Excellent Gentlemen" ? " · " + esc(name) : ""}</div>
      <h3 style="margin:6px 0 2px">🏆 ${esc(pod[0] ? teamOf(y, pod[0]) : "?")}</h3>
      <p class="dim small" style="margin:2px 0 8px">${pod[0] ? mdisp(mgrOfTeam(y, pod[0])) : ""}</p>
      <span class="chip plain">${Object.keys(s.teams).length} teams</span>
      <span class="chip plain">${esc(s.settings.ppr ?? "?")} PPR</span>
    </a>`;
  }).join("")}
  </div>`;

function bracketHTML(y) {
  const s = L.seasons[y];
  const games = s.playoffs.games;
  if (!games.length) return `<p class="dim">No bracket data.</p>`;
  const main = ["Quarterfinal", "Semifinal", "Final"];
  const side = g => {
    const win = g.sA != null && g.sB != null ? (g.sA > g.sB ? "a" : "b") : null;
    const row = (seed, tid, sc, w) => `<div class="side ${w ? "win" : ""}">
      <span class="seed num">${seed ?? ""}</span><span class="t">${esc(teamOf(y, tid))}</span>
      <span class="s">${sc != null ? num(sc) : "Bye"}</span></div>`;
    let h = row(g.seedA, g.a, g.sA, win === "a");
    if (g.b) h += row(g.seedB, g.b, g.sB, win === "b");
    return `<div class="game">${h}</div>`;
  };
  const cols = main.filter(r => games.some(g => g.round === r)).map(r => `
    <div class="round"><div class="round-title">${r}${(() => {const wk = games.find(g => g.round === r)?.week; return wk ? " · wk " + wk : "";})()}</div>
    ${games.filter(g => g.round === r).map(side).join("")}</div>`);
  const cons = games.filter(g => /Place Game/.test(g.round));
  if (cons.length) {
    cols.push(`<div class="round"><div class="round-title">Consolations</div>${cons.map(g =>
      `<div><div class="round-title" style="font-size:10.5px;margin-bottom:3px">${esc(g.round)}</div>${side(g)}</div>`).join("")}</div>`);
  }
  return `<div class="bracket">${cols.join("")}</div>`;
}

views.season = (y) => {
  const s = L.seasons[y];
  if (!s) return `<p>Unknown season.</p>`;
  const st = s.settings;
  const pod = s.playoffs.podium;
  const rows = Object.keys(s.teams).map(tid => ({tid, ...s.reg[tid], fin: s.standings[tid]?.final_rank, div: s.standings[tid]?.division}));
  const weekOpts = s.weeks.map(w => `<option value="${w}">Week ${w}</option>`).join("");

  const cols = [
    {h: "Fin", num: 1, val: r => r.fin},
    {h: "Team", val: r => teamOf(y, r.tid), fmt: r => `${esc(teamOf(y, r.tid))}${pod[0] === r.tid ? " 🏆" : pod[1] === r.tid ? " 🥈" : pod[2] === r.tid ? " 🥉" : ""}`},
    {h: "Manager", val: r => mname(mgrOfTeam(y, r.tid)), fmt: r => mlink(mgrOfTeam(y, r.tid))},
    {h: "W-L", num: 1, val: r => r.w + 0.5 * r.t, fmt: r => `<span class="num">${rec(r.w, r.l, r.t)}</span>`},
    {h: "PF", num: 1, val: r => r.pf, fmt: r => num(r.pf)},
    {h: "PA", num: 1, val: r => r.pa, fmt: r => num(r.pa)},
    {h: "PPG", num: 1, val: r => r.ppg, fmt: r => num(r.ppg)},
    {h: "vs mean", num: 1, val: r => r.ppg_norm, fmt: r => r.ppg_norm == null ? "—" : `<span class="${r.ppg_norm >= 100 ? "pos" : "neg"}">${num(r.ppg_norm, 1)}%</span>`},
    {h: "All-play", num: 1, val: r => r.ap_w / Math.max(r.ap_w + r.ap_l, 1), fmt: r => `<span class="num">${r.ap_w}-${r.ap_l}</span>`},
    {h: "Luck", num: 1, val: r => r.luck, fmt: r => `<span class="${r.luck >= 0 ? "pos" : "neg"}">${plus(r.luck)}</span>`},
    {h: "Weekly highs", num: 1, val: r => r.crowns},
  ];
  if (rows.some(r => r.div)) cols.splice(3, 0, {h: "Div", val: r => r.div || ""});

  return `
  <a class="backlink" href="#/seasons">← All seasons</a>
  <p class="kicker">${y} · ${esc(st.league_name || "")}</p>
  <h1>${y} Season</h1>
  <p class="sub">${esc(st.scoring_type || "")} · ${esc(st.ppr ?? "?")} pt receptions · ${Object.keys(s.teams).length} teams ·
    ${st.playoff_teams ?? "?"}-team playoffs from week ${st.playoff_start ?? "?"} · league weekly average ${num(s.season_mean_score)}</p>

  <div class="statrow">
    ${pod.map((tid, i) => tid ? `<div class="stat ${i === 0 ? "gold" : ""}">
      <div class="v">${["🏆", "🥈", "🥉"][i]} ${esc(teamOf(y, tid))}</div>
      <div class="l">${["Champion", "Runner-up", "Third place"][i]} — ${mdisp(mgrOfTeam(y, tid))}</div></div>` : "").join("")}
  </div>

  <h2>Playoffs</h2>
  ${bracketHTML(y)}

  <h2>Standings</h2>
  ${table(cols, rows, {sortCol: 0, sortDir: 1})}
  <p class="legend"><span>“vs mean” = points per game relative to the league average that season (100% = average).</span>
  <span>“Luck” = wins minus deserved wins from the all-play record.</span></p>

  <h2 class="section-head">Weekly scores <span class="spacer"></span>
    <select id="wkSel" class="ctl">${weekOpts}</select></h2>
  <div id="wkBox"></div>

  <h2>Draft — round 1</h2>
  ${(() => {
    const r1 = s.draft.picks.filter(p => p[1] === 1);
    if (!r1.length) return `<p class="dim">No draft data.</p>`;
    return `<div class="tablewrap"><table><thead><tr><th class="num">Pick</th><th>Player</th><th>Team</th><th>Manager</th></tr></thead>
      <tbody>${r1.map(p => `<tr><td class="num">${p[2]}</td><td>${esc(p[4])}</td><td>${esc(teamOf(y, p[3]))}</td><td>${mlink(mgrOfTeam(y, p[3]))}</td></tr>`).join("")}</tbody></table></div>
      <p class="small" style="margin-top:8px"><a href="#/draft?y=${y}" class="chip plain">Full ${s.draft.rounds}-round board →</a></p>`;
  })()}`;
};

function weekBox(y, w) {
  const s = L.seasons[y];
  const ms = s.matchups.filter(m => m.w === +w);
  const hi = Math.max(...ms.flatMap(m => [m.as, m.bs]));
  return `<div class="grid cols-3">${ms.map(m => {
    const aw = m.as > m.bs;
    return `<div class="game">
      <div class="side ${aw ? "win" : ""}"><span class="t">${esc(teamOf(y, m.a))}${m.as === hi ? " ✦" : ""}</span><span class="s">${num(m.as)}</span></div>
      <div class="side ${!aw && m.bs !== m.as ? "win" : ""}"><span class="t">${esc(teamOf(y, m.b))}${m.bs === hi ? " ✦" : ""}</span><span class="s">${num(m.bs)}</span></div>
    </div>`;
  }).join("")}</div><p class="legend"><span>✦ weekly high score</span></p>`;
}

let _lows = null;
const weeklyLows = () => {
  if (_lows) return _lows;
  _lows = {};
  for (const y of years()) {
    const byW = {};
    for (const m of L.seasons[y].matchups) {
      (byW[m.w] = byW[m.w] || []).push([m.a, m.as], [m.b, m.bs]);
    }
    for (const arr of Object.values(byW)) {
      const mn = Math.min(...arr.map(x => x[1]));
      for (const [tid, sc] of arr) {
        if (sc === mn) {
          const lk = mgrOfTeam(y, tid);
          if (lk) _lows[lk] = (_lows[lk] || 0) + 1;
        }
      }
    }
  }
  return _lows;
};

const finishQuality = mk => {
  const qs = Object.entries(L.managers[mk].seasons)
    .map(([y, s]) => {
      if (!s.final_rank) return null;
      const n = Object.keys(L.seasons[y].teams).length;
      return (n - s.final_rank) / (n - 1);
    }).filter(v => v != null);
  return qs.length ? 100 * qs.reduce((a, b) => a + b, 0) / qs.length : null;
};

views.managers = (q) => {
  const cur = new URLSearchParams(q || "").get("f") === "cur";
  const rows = Object.keys(L.managers)
    .filter(mk => !cur || isCurrent(mk))
    .map(mk => ({mk, name: mname(mk), ...L.managers[mk].career, st: L.managers[mk].streaks, finq: finishQuality(mk), lows: weeklyLows()[mk] || 0}));
  const cols = [
    {h: "Manager", val: r => r.name, fmt: r => mlink(r.mk)},
    {h: "Szns", num: 1, val: r => r.seasons},
    {h: "Record", num: 1, val: r => r.pct, fmt: r => `<span class="num">${rec(r.w, r.l, r.t)}</span>`},
    {h: "Pct", num: 1, val: r => r.pct, fmt: r => pctf(r.pct)},
    {h: "Titles", num: 1, val: r => r.titles, fmt: r => r.titles ? "🏆".repeat(r.titles) : "—"},
    {h: "Podiums", num: 1, val: r => r.podiums},
    {h: "Playoffs", num: 1, val: r => r.playoff_apps},
    {h: "Avg finish", num: 1, val: r => r.avg_finish, fmt: r => num(r.avg_finish, 1)},
    {h: "Finish quality", num: 1, val: r => r.finq, fmt: r => r.finq == null ? "—" : `<b class="num">${num(r.finq, 0)}%</b>`},
    {h: "PPG vs mean", num: 1, val: r => r.avg_ppg_norm, fmt: r => r.avg_ppg_norm == null ? "—" : `<span class="${r.avg_ppg_norm >= 100 ? "pos" : "neg"}">${num(r.avg_ppg_norm, 1)}%</span>`},
    {h: "Luck", num: 1, val: r => r.luck, fmt: r => `<span class="${r.luck >= 0 ? "pos" : "neg"}">${plus(r.luck)}</span>`},
    {h: "Weekly highs", num: 1, val: r => r.crowns},
    {h: "Weekly lows", num: 1, val: r => r.lows},
    {h: "Avg draft slot", num: 1, val: r => r.avg_draft_slot, fmt: r => num(r.avg_draft_slot, 1)},
    {h: "Sackos", num: 1, val: r => r.last_places, fmt: r => r.last_places ? "💀".repeat(r.last_places) : "—"},
  ];
  return `
  <p class="kicker">All-time</p>
  <h1>Managers</h1>
  <p class="sub">Career numbers across every season and league name. Click any column to re-sort; click a manager for the full story.</p>
  <div class="pill-tabs">
    <button class="${cur ? "" : "on"}" onclick="location.hash='#/managers'">All-time</button>
    <button class="${cur ? "on" : ""}" onclick="location.hash='#/managers?f=cur'">Current members</button>
  </div>
  <div>${table(cols, rows, {sortCol: 3, sortDir: -1, rowHref: r => `#/manager/${encodeURIComponent(r.mk)}`})}</div>
  <p class="legend"><span>“Finish quality” = average standing normalized for league size (100% = champion, 0% = last) — comparable across the 8/10/12/14-team eras, unlike raw average finish.</span>
  <span>“PPG vs mean” = career scoring relative to each season's league average — comparable across rule eras.</span>
  <span>“Luck” = career wins above/below the all-play deserved record.</span><span>💀 = last-place finish.</span></p>`;
};

views.manager = (mk) => {
  mk = decodeURIComponent(mk);
  const M = L.managers[mk];
  if (!M) return `<p>Unknown manager.</p>`;
  const c = M.career;
  const ys = Object.keys(M.seasons).sort();
  const sparkNorm = spark(years().map(y => ({t: `${y}: ${M.seasons[y] ? M.seasons[y].ppg_norm + "%" : "—"}`, v: M.seasons[y]?.ppg_norm ?? null})), {baseline: 100, fmt: v => Math.round(v) + "%"});
  const maxTeams = Math.max(...years().map(y => Object.keys(L.seasons[y].teams).length));
  const sparkFin = spark(years().map(y => ({t: `${y}: finished ${M.seasons[y]?.final_rank ?? "—"}`, v: M.seasons[y]?.final_rank ?? null})), {invert: true, min: 1, max: maxTeams, fmt: v => "#" + Math.round(v)});
  const h2hRows = Object.entries(L.h2h[mk] || {}).map(([ok, v]) => ({ok, ...v}))
    .filter(r => r.games >= 1).sort((a, b) => b.games - a.games);

  const seasonCols = [
    {h: "Year", num: 1, val: r => r.y, fmt: r => `<a href="#/season/${r.y}">${r.y}</a>`},
    {h: "Team", val: r => r.team, fmt: r => esc(r.team)},
    {h: "Record", num: 1, val: r => r.w + 0.5 * r.t, fmt: r => `<span class="num">${rec(r.w, r.l, r.t)}</span>`},
    {h: "PPG", num: 1, val: r => r.ppg, fmt: r => num(r.ppg)},
    {h: "vs mean", num: 1, val: r => r.ppg_norm, fmt: r => r.ppg_norm == null ? "—" : `<span class="${r.ppg_norm >= 100 ? "pos" : "neg"}">${num(r.ppg_norm, 1)}%</span>`},
    {h: "Luck", num: 1, val: r => r.luck, fmt: r => `<span class="${r.luck >= 0 ? "pos" : "neg"}">${plus(r.luck)}</span>`},
    {h: "Draft slot", num: 1, val: r => r.draft_slot, fmt: r => int(r.draft_slot)},
    {h: "Finish", num: 1, val: r => r.final_rank, fmt: r => `${int(r.final_rank)}${r.result === "champion" ? " 🏆" : r.result === "runner-up" ? " 🥈" : r.result === "third" ? " 🥉" : r.last_place ? " 💀" : ""}`},
    {h: "Result", val: r => r.result, fmt: r => ({champion: `<span class="chip gold">Champion</span>`, "runner-up": `<span class="chip">Runner-up</span>`, third: `<span class="chip">Third</span>`, "made-playoffs": `<span class="chip plain">Playoffs</span>`, missed: `<span class="chip plain">Missed</span>`}[r.result] || "—")},
  ];
  const sRows = ys.map(y => ({y, ...M.seasons[y]}));

  const h2hCols = [
    {h: "Opponent", val: r => mname(r.ok), fmt: r => mlink(r.ok)},
    {h: "Record", num: 1, val: r => (r.w + 0.5 * r.t) / Math.max(r.games, 1), fmt: r => `<a class="num" href="#/rivalry/${encodeURIComponent(mk)}/${encodeURIComponent(r.ok)}">${rec(r.w, r.l, r.t)} →</a>`},
    {h: "Games", num: 1, val: r => r.games},
    {h: "Avg PF", num: 1, val: r => r.pf / Math.max(r.games, 1), fmt: r => num(r.pf / Math.max(r.games, 1), 1)},
    {h: "Avg PA", num: 1, val: r => r.pa / Math.max(r.games, 1), fmt: r => num(r.pa / Math.max(r.games, 1), 1)},
    {h: "Pt diff", num: 1, val: r => r.pf - r.pa, fmt: r => `<span class="${r.pf - r.pa >= 0 ? "pos" : "neg"}">${plus(Number((r.pf - r.pa).toFixed(1)))}</span>`},
    {h: "Playoff W-L", num: 1, val: r => r.po_w - r.po_l, fmt: r => (r.po_w || r.po_l) ? `<span class="num">${r.po_w}-${r.po_l}</span>` : "—"},
  ];

  return `
  <a class="backlink" href="#/managers">← All managers</a>
  <p class="kicker">Manager</p>
  <h1>${mdisp(mk)} ${"🏆".repeat(c.titles)}</h1>
  <p class="sub">${c.seasons} season${c.seasons === 1 ? "" : "s"} (${ys[0]}–${ys[ys.length - 1]})
    ${isHidden(mk) ? " · this account is hidden on Yahoo — Bennett, tell Claude who this is" : ""}</p>

  <div class="statrow">
    <div class="stat"><div class="v num">${rec(c.w, c.l, c.t)}</div><div class="l">Career record (${pctf(c.pct)})</div></div>
    <div class="stat ${c.titles ? "gold" : ""}"><div class="v num">${c.titles}</div><div class="l">Championships</div></div>
    <div class="stat"><div class="v num">${num(c.avg_finish, 1)}</div><div class="l">Average finish</div></div>
    <div class="stat"><div class="v num">${(() => { const fq = finishQuality(mk); return fq == null ? "—" : num(fq, 0) + "%"; })()}</div><div class="l">Finish quality (size-adjusted)</div></div>
    <div class="stat"><div class="v num ${c.avg_ppg_norm >= 100 ? "pos" : "neg"}">${num(c.avg_ppg_norm, 1)}%</div><div class="l">Career PPG vs league mean</div></div>
    <div class="stat"><div class="v num ${c.luck >= 0 ? "pos" : "neg"}">${plus(c.luck)}</div><div class="l">Career luck (wins vs deserved)</div></div>
    <div class="stat"><div class="v num">W${M.streaks.longest_win} / L${M.streaks.longest_loss}</div><div class="l">Longest streaks</div></div>
    <div class="stat"><div class="v num ${M.streaks.current > 0 ? "pos" : M.streaks.current < 0 ? "neg" : ""}">${M.streaks.current > 0 ? "W" + M.streaks.current : M.streaks.current < 0 ? "L" + (-M.streaks.current) : "—"}</div><div class="l">Current streak${isCurrent(mk) ? "" : " (when last seen)"}</div></div>
  </div>
  <p class="legend"><span>Finish quality = final standing rescaled for league size (100% = champion, 0% = last), so results from the 8-, 10-, 12-, and 14-team eras compare fairly — finishing 3rd of 12 counts for more than 3rd of 8.</span></p>

  <div class="grid cols-3">
    <div class="card"><div class="kicker">Scoring vs league mean</div>${sparkNorm}<p class="legend"><span>${ys[0]}–${ys[ys.length - 1]} · dashed = league average (100%)</span></p></div>
    <div class="card"><div class="kicker">Finishes over the years</div>${sparkFin}<p class="legend"><span>${ys[0]}–${ys[ys.length - 1]} · higher = better finish (#1 = champion)</span></p></div>
    <div class="card"><div class="kicker">Hardware</div>
      <p style="font-size:15px;margin:8px 0 0">${c.titles ? "🏆 ".repeat(c.titles) : ""}${c.podiums > c.titles ? "🥈 ".repeat(c.podiums - c.titles) : ""}${c.last_places ? "💀 ".repeat(c.last_places) : ""}${!c.podiums && !c.last_places ? "<span class='dim'>A clean, trophy-less record.</span>" : ""}</p>
      <p class="dim small" style="margin-top:10px">${c.playoff_apps} playoff trips · ${c.crowns} weekly high scores · avg draft slot ${num(c.avg_draft_slot, 1)}</p></div>
  </div>

  <h2>Season by season</h2>
  ${table(seasonCols, sRows, {sortCol: 0, sortDir: 1})}

  <h2>Head-to-head</h2>
  ${table(h2hCols, h2hRows, {sortCol: 2, sortDir: -1})}`;
};

views.honors = () => {
  const ys = years();
  const add = (map, mk, y) => { if (mk) (map[mk] = map[mk] || []).push(+y); };
  const titles = {}, regs = {}, pts = {}, paT = {};
  const sackos = [];
  for (const c of L.league.champions) add(titles, mkeyOf(c.manager), c.year);
  for (const y of ys) {
    const s = L.seasons[y];
    const tids = Object.keys(s.teams);
    const regChamp = tids.find(t => s.reg[t].reg_rank === 1);
    add(regs, mgrOfTeam(y, regChamp), y);
    const ptsT = tids.reduce((m, t) => s.reg[t].pf > s.reg[m].pf ? t : m, tids[0]);
    add(pts, mgrOfTeam(y, ptsT), y);
    const paTid = tids.reduce((m, t) => s.reg[t].pa > s.reg[m].pa ? t : m, tids[0]);
    add(paT, mgrOfTeam(y, paTid), y);
    const last = tids.find(t => s.standings[t]?.final_rank === tids.length);
    if (last) sackos.push({y: +y, team: teamOf(y, last), mk: mgrOfTeam(y, last)});
  }
  const lowRows = Object.entries(weeklyLows())
    .map(([lk, n]) => ({mk: lk, lows: n, seasons: L.managers[lk].career.seasons}))
    .sort((a, b) => b.lows - a.lows).slice(0, 10);
  let lucky = null, unlucky = null;
  for (const mk of Object.keys(L.managers)) {
    for (const [y, s] of Object.entries(L.managers[mk].seasons)) {
      if (!lucky || s.luck > lucky.luck) lucky = {mk, y, luck: s.luck, team: s.team};
      if (!unlucky || s.luck < unlucky.luck) unlucky = {mk, y, luck: s.luck, team: s.team};
    }
  }
  const crownRows = Object.keys(L.managers)
    .map(mk => ({mk, crowns: L.managers[mk].career.crowns, seasons: L.managers[mk].career.seasons}))
    .filter(r => r.crowns > 0).sort((a, b) => b.crowns - a.crowns).slice(0, 10);
  const honorList = (map, label) => {
    const rows = Object.entries(map).map(([mk, yrs]) => ({mk, yrs: yrs.sort()}))
      .sort((a, b) => b.yrs.length - a.yrs.length);
    return `<div class="card"><div class="kicker">${label}</div>
      ${rows.map(r => `<p style="margin:8px 0 0"><b>${mlink(r.mk)}</b> — ${r.yrs.length}
      <span class="dim small">(${r.yrs.map(y => `<a href="#/season/${y}">${y}</a>`).join(", ")})</span></p>`).join("")}</div>`;
  };
  const sackoCounts = {};
  sackos.forEach(s => sackoCounts[s.mk] = (sackoCounts[s.mk] || 0) + 1);
  const sackoKing = Object.entries(sackoCounts).sort((a, b) => b[1] - a[1])[0];
  return `
  <p class="kicker">Trophy room</p>
  <h1>Honors</h1>
  <p class="sub">Everything worth bragging about — and one section nobody brags about.</p>

  <h2>🏆 The throne</h2>
  <div class="grid cols-3">${honorList(titles, "Championships")}
    ${honorList(regs, "Regular-season titles (best record)")}
    ${honorList(pts, "Points titles (most PF)")}
    ${honorList(paT, "Most points against (human shield award)")}</div>

  <h2>✦ Weekly high scores, career</h2>
  ${table([
    {h: "Manager", val: r => mname(r.mk), fmt: r => mlink(r.mk)},
    {h: "Weekly highs", num: 1, val: r => r.crowns},
    {h: "Seasons", num: 1, val: r => r.seasons},
    {h: "Per season", num: 1, val: r => r.crowns / r.seasons, fmt: r => num(r.crowns / r.seasons, 2)},
  ], crownRows, {sortCol: 1, sortDir: -1})}

  <h2>🧊 Weekly low scores, career <span class="dim small">stinker of the week counts</span></h2>
  ${table([
    {h: "Manager", val: r => mname(r.mk), fmt: r => mlink(r.mk)},
    {h: "Weekly lows", num: 1, val: r => r.lows},
    {h: "Seasons", num: 1, val: r => r.seasons},
    {h: "Per season", num: 1, val: r => r.lows / r.seasons, fmt: r => num(r.lows / r.seasons, 2)},
  ], lowRows, {sortCol: 1, sortDir: -1})}

  <h2>🎲 Fortune's extremes</h2>
  <div class="grid cols-3">
    <div class="card"><div class="kicker">Luckiest season ever</div>
      <h3>${mdisp(lucky.mk)} ${plus(lucky.luck)}</h3>
      <p class="dim small">${esc(lucky.team)}, <a href="#/season/${lucky.y}">${lucky.y}</a> — won ${lucky.luck} more than the scores deserved.</p></div>
    <div class="card"><div class="kicker">Most robbed season ever</div>
      <h3>${mdisp(unlucky.mk)} ${plus(unlucky.luck)}</h3>
      <p class="dim small">${esc(unlucky.team)}, <a href="#/season/${unlucky.y}">${unlucky.y}</a> — the schedule owes this team an apology.</p></div>
  </div>

  <h2>💀 The Sacko Shrine <span class="dim small">last place, immortalized</span></h2>
  ${sackoKing && sackoKing[1] > 1 ? `<p class="note">Reigning shrine benefactor: <b>${mdisp(sackoKing[0])}</b> with ${sackoKing[1]} last-place finishes.</p>` : ""}
  ${table([
    {h: "Year", num: 1, val: r => r.y, fmt: r => `<a href="#/season/${r.y}">${r.y}</a>`},
    {h: "Team", val: r => r.team, fmt: r => esc(r.team)},
    {h: "Manager", val: r => mname(r.mk), fmt: r => mlink(r.mk)},
  ], sackos, {sortCol: 0, sortDir: -1})}`;
};

views.rivalry = (aRaw, bRaw) => {
  const A = decodeURIComponent(aRaw || ""), B = decodeURIComponent(bRaw || "");
  if (!L.managers[A] || !L.managers[B]) return `<p>Unknown rivalry.</p>`;
  const games = [];
  for (const y of years()) {
    const s = L.seasons[y];
    const orient = (a, b, as, bs) => {
      const ma = mgrOfTeam(y, a), mb = mgrOfTeam(y, b);
      if (ma === A && mb === B) return {as, bs, at: a, bt: b};
      if (ma === B && mb === A) return {as: bs, bs: as, at: b, bt: a};
      return null;
    };
    for (const m of s.matchups) {
      const p = orient(m.a, m.b, m.as, m.bs);
      if (p) games.push({y: +y, wk: m.w, label: "Week " + m.w, po: false, ...p});
    }
    for (const g of s.playoffs.games) {
      if (!g.b || g.sA == null || g.sB == null) continue;
      const p = orient(g.a, g.b, g.sA, g.sB);
      if (p) games.push({y: +y, wk: g.week || 99, label: g.round, po: true, ...p});
    }
  }
  games.sort((x, z) => x.y - z.y || x.wk - z.wk);
  if (!games.length) return `<p>These two have never met. Suspicious.</p>`;
  const w = games.filter(g => g.as > g.bs).length;
  const l = games.filter(g => g.as < g.bs).length;
  const t = games.length - w - l;
  const pow = games.filter(g => g.po && g.as > g.bs).length;
  const pol = games.filter(g => g.po && g.as < g.bs).length;
  let streakN = 0, streakWho = null;
  for (let i = games.length - 1; i >= 0; i--) {
    const g = games[i];
    const winner = g.as > g.bs ? A : g.as < g.bs ? B : null;
    if (!winner) break;
    if (!streakWho) { streakWho = winner; streakN = 1; }
    else if (winner === streakWho) streakN++;
    else break;
  }
  const bigA = [...games].sort((x, z) => (z.as - z.bs) - (x.as - x.bs))[0];
  const bigB = [...games].sort((x, z) => (z.bs - z.as) - (x.bs - x.as))[0];
  const totA = games.reduce((s2, g) => s2 + g.as, 0);
  const totB = games.reduce((s2, g) => s2 + g.bs, 0);
  const diff = totA - totB;
  const avg = k => num((k === "as" ? totA : totB) / games.length, 1);
  return `
  <a class="backlink" href="#/rivalries">← All rivalries</a>
  <p class="kicker">Rivalry</p>
  <h1>${mdisp(A)} <span class="dim">vs</span> ${mdisp(B)}</h1>
  <p class="sub">${games.length} meetings since ${games[0].y}${(pow + pol) ? ` — including ${pow + pol} in the playoffs` : ""}.</p>
  <div class="statrow">
    <div class="stat ${w > l ? "green" : ""}"><div class="v num">${w}-${l}${t ? "-" + t : ""}</div><div class="l">All-time series (${mdisp(A)} first)</div></div>
    <div class="stat"><div class="v num">${num(totA)} — ${num(totB)}</div><div class="l">Total points, all meetings</div></div>
    <div class="stat"><div class="v num ${diff >= 0 ? "pos" : "neg"}">${Math.abs(diff) < 0.005 ? "Even" : `${mdisp(diff > 0 ? A : B)} +${num(Math.abs(diff))}`}</div><div class="l">Point differential</div></div>
    <div class="stat"><div class="v num">${avg("as")} — ${avg("bs")}</div><div class="l">Average score</div></div>
    ${(pow + pol) ? `<div class="stat"><div class="v num">${pow}-${pol}</div><div class="l">Playoff meetings</div></div>` : ""}
    ${streakWho ? `<div class="stat"><div class="v num">${streakN}</div><div class="l">Win streak — ${mdisp(streakWho)}</div></div>` : ""}
  </div>
  <div class="grid cols-3">
    <div class="card"><div class="kicker">${mdisp(A)}'s biggest win</div>
      <h3 class="num">${num(bigA.as)} — ${num(bigA.bs)}</h3>
      <p class="dim small"><a href="#/season/${bigA.y}">${bigA.y}</a> ${esc(bigA.label)}</p></div>
    <div class="card"><div class="kicker">${mdisp(B)}'s biggest win</div>
      <h3 class="num">${num(bigB.bs)} — ${num(bigB.as)}</h3>
      <p class="dim small"><a href="#/season/${bigB.y}">${bigB.y}</a> ${esc(bigB.label)}</p></div>
  </div>
  <h2>Every meeting</h2>
  ${table([
    {h: "Year", num: 1, val: r => r.y, fmt: r => `<a href="#/season/${r.y}">${r.y}</a>`},
    {h: "Game", val: r => r.label, fmt: r => `${esc(r.label)}${r.po ? ` <span class="chip gold">playoffs</span>` : ""}`},
    {h: mname(A), val: r => r.as, num: 1, fmt: r => r.as > r.bs ? `<b class="pos num">${num(r.as)}</b>` : num(r.as)},
    {h: mname(B), val: r => r.bs, num: 1, fmt: r => r.bs > r.as ? `<b class="pos num">${num(r.bs)}</b>` : num(r.bs)},
    {h: "Margin", num: 1, val: r => Math.abs(r.as - r.bs), fmt: r => num(Math.abs(r.as - r.bs))},
    {h: "Teams", val: r => "", fmt: r => `<span class="dim small">${esc(teamOf(r.y, r.at))} · ${esc(teamOf(r.y, r.bt))}</span>`},
  ], games, {sortCol: 0, sortDir: 1})}`;
};

views.rivalries = (q) => {
  const cur = new URLSearchParams(q || "").get("f") === "cur";
  const mks = Object.keys(L.managers)
    .filter(mk => !cur || isCurrent(mk))
    .sort((a, b) => L.managers[b].career.seasons - L.managers[a].career.seasons);
  const cell = (a, b) => {
    if (a === b) return `<td class="cell me"></td>`;
    const v = L.h2h[a]?.[b];
    if (!v || !v.games) return `<td class="cell dim">·</td>`;
    const lead = v.w > v.l ? "pos" : v.w < v.l ? "neg" : "";
    return `<td class="cell"><a href="#/rivalry/${encodeURIComponent(a)}/${encodeURIComponent(b)}" class="${lead} num">${v.w}-${v.l}${v.t ? "-" + v.t : ""}</a></td>`;
  };
  const pairs = [];
  mks.forEach((a, i) => mks.slice(i + 1).forEach(b => {
    const v = L.h2h[a]?.[b];
    if (v && v.games >= 8) {
      pairs.push({a, b, games: v.games, w: v.w, l: v.l, t: v.t,
        edge: Math.abs(v.w - v.l), pd: Math.abs(v.pf - v.pa)});
    }
  }));
  const most = [...pairs].sort((x, y) => y.games - x.games).slice(0, 6);
  const lopsided = [...pairs].sort((x, y) => (y.edge / y.games) - (x.edge / x.games)).slice(0, 6);

  return `
  <p class="kicker">Head-to-head</p>
  <h1>Rivalries</h1>
  <p class="sub">Row vs column, all-time (playoffs included). Green means the row manager owns the matchup.</p>
  <div class="pill-tabs">
    <button class="${cur ? "" : "on"}" onclick="location.hash='#/rivalries'">All-time</button>
    <button class="${cur ? "on" : ""}" onclick="location.hash='#/rivalries?f=cur'">Current members</button>
  </div>
  <div class="tablewrap"><table class="matrix">
    <thead><tr><th></th>${mks.map(m => `<th title="${esc(mname(m))}">${esc(mdisp(m).slice(0, 7))}</th>`).join("")}</tr></thead>
    <tbody>${mks.map(a => `<tr><td>${mlink(a)}</td>${mks.map(b => cell(a, b)).join("")}</tr>`).join("")}</tbody>
  </table></div>

  <h2>Most played</h2>
  <div class="grid cols-3">${most.map(p => `<div class="card">
    <div class="kicker">${p.games} games</div>
    <h3>${mdisp(p.a)} ${p.w}–${p.l}${p.t ? "–" + p.t : ""} ${mdisp(p.b)}</h3></div>`).join("")}</div>

  <h2>Most lopsided <span class="dim small">(min 8 games)</span></h2>
  <div class="grid cols-3">${lopsided.map(p => {
    const [win, lose, w, l] = p.w >= p.l ? [p.a, p.b, p.w, p.l] : [p.b, p.a, p.l, p.w];
    return `<div class="card"><div class="kicker">${w}–${l}</div>
    <h3>${mdisp(win)} owns ${mdisp(lose)}</h3></div>`;
  }).join("")}</div>`;
};

views.records = () => {
  const R = L.records;
  const gameCols = extra => [
    {h: "#", num: 1, val: (r, i) => 0, fmt: (r) => ""},
    {h: "Year", num: 1, val: r => r.year, fmt: r => `<a href="#/season/${r.year}">${r.year}</a>`},
    {h: "Wk", num: 1, val: r => r.week},
    {h: "Team", val: r => r.team, fmt: r => `${esc(r.team)} <span class="dim small">(${isHidden(mkeyOf(r.manager)) ? "?" : esc(r.manager)})</span>`},
    ...extra,
    {h: "Opponent", val: r => r.opp, fmt: r => `${esc(r.opp)} <span class="dim small num">${num(r.opp_score)}</span>`},
  ];
  const sec = (title, sub, rows, extra) => {
    const cols = gameCols(extra).slice(1);
    return `<h2>${title} <span class="dim small">${sub}</span></h2>${table(cols, rows.slice(0, 10))}`;
  };
  return `
  <p class="kicker">Record book</p>
  <h1>Records</h1>
  <p class="sub">Computed from every game ever played. “Era-adjusted” expresses a score relative to that season's league average, so 2015 numbers can argue fairly with 2025 numbers.</p>

  ${sec("Highest single-week scores", "raw points", R.high_score, [
    {h: "Score", num: 1, val: r => r.score, fmt: r => `<b class="num">${num(r.score)}</b>`}])}
  ${sec("Highest single-week score, era-adjusted", "one week's score as % of that season's average", R.high_score_norm, [
    {h: "vs mean", num: 1, val: r => r.norm, fmt: r => `<b class="num pos">${num(r.norm, 1)}%</b>`},
    {h: "Score", num: 1, val: r => r.score, fmt: r => num(r.score)}])}
  ${sec("Lowest single-week scores", "hall of shame", R.low_score, [
    {h: "Score", num: 1, val: r => r.score, fmt: r => `<b class="num neg">${num(r.score)}</b>`}])}
  ${sec("Biggest blowouts", "margin of victory", R.biggest_blowout, [
    {h: "Margin", num: 1, val: r => r.margin, fmt: r => `<b class="num">+${num(r.margin)}</b>`},
    {h: "Score", num: 1, val: r => r.score, fmt: r => num(r.score)}])}
  ${sec("Closest games", "sweaty palms division", R.closest_game, [
    {h: "Margin", num: 1, val: r => Math.abs(r.margin), fmt: r => `<b class="num">${num(Math.abs(r.margin))}</b>`},
    {h: "Score", num: 1, val: r => r.score, fmt: r => num(r.score)}])}
  ${sec("Most points in a loss", "robbed at gunpoint", R.best_loss, [
    {h: "Score", num: 1, val: r => r.score, fmt: r => `<b class="num">${num(r.score)}</b>`}])}
  ${sec("Fewest points in a win", "winning ugly", R.worst_win, [
    {h: "Score", num: 1, val: r => r.score, fmt: r => `<b class="num">${num(r.score)}</b>`}])}

  <h2>Highest-scoring games <span class="dim small">combined</span></h2>
  <div class="tablewrap"><table><thead><tr><th class="num">Year</th><th class="num">Wk</th><th>Matchup</th><th class="num">Total</th></tr></thead><tbody>
  ${R.combined_high.map(c => `<tr><td class="num"><a href="#/season/${c.year}">${c.year}</a></td><td class="num">${c.week}</td>
    <td>${esc(c.a)} ${num(c.as)} — ${num(c.bs)} ${esc(c.b)}</td><td class="num"><b>${num(c.total)}</b></td></tr>`).join("")}
  </tbody></table></div>`;
};

views.draft = (q) => {
  const params = new URLSearchParams(q || "");
  const y = params.get("y") || lastSeason();
  const s = L.seasons[y];
  const opts = [...years()].reverse().map(v => `<option value="${v}" ${v === y ? "selected" : ""}>${v}</option>`).join("");
  const slotRows = Object.keys(L.managers)
    .map(mk => ({mk, slots: years().map(yy => L.managers[mk].seasons[yy]?.draft_slot ?? null), avg: L.managers[mk].career.avg_draft_slot}))
    .filter(r => r.avg != null);

  // ── does draft order matter? ──
  const slotStats = {};
  const xs = [], ys = [];
  for (const mk of Object.keys(L.managers)) {
    for (const [yy, ms] of Object.entries(L.managers[mk].seasons)) {
      if (!ms.draft_slot || !ms.final_rank) continue;
      const n = Object.keys(L.seasons[yy].teams).length;
      const pct = (n - ms.final_rank) / (n - 1); // 1 = champion, 0 = last
      const st = slotStats[ms.draft_slot] = slotStats[ms.draft_slot] ||
        {slot: ms.draft_slot, n: 0, fin: 0, pct: 0, po: 0, titles: 0, sackos: 0};
      st.n++; st.fin += ms.final_rank; st.pct += pct;
      if (["champion", "runner-up", "third", "made-playoffs"].includes(ms.result)) st.po++;
      if (ms.result === "champion") st.titles++;
      if (ms.last_place) st.sackos++;
      xs.push(ms.draft_slot); ys.push(pct);
    }
  }
  const mean = a => a.reduce((x, z) => x + z, 0) / a.length;
  const mx = mean(xs), my = mean(ys);
  let cov = 0, vx = 0, vy = 0;
  xs.forEach((x, i) => { cov += (x - mx) * (ys[i] - my); vx += (x - mx) ** 2; vy += (ys[i] - my) ** 2; });
  const r = cov / Math.sqrt(vx * vy || 1);
  const verdict = Math.abs(r) < 0.1 ? "Draft order is basically astrology here."
    : Math.abs(r) < 0.25 ? "A faint pulse — but skill (and luck) swamp it."
    : r < 0 ? "Earlier picks really have finished better." : "Astonishingly, later picks have done better.";
  const slotList = Object.values(slotStats).sort((a, b) => a.slot - b.slot);
  const maxPct = Math.max(...slotList.map(t => t.pct / t.n));
  const bar = v => `<svg width="90" height="12" viewBox="0 0 90 12" style="vertical-align:middle"><rect x="0" y="1" width="${(90 * v / maxPct).toFixed(1)}" height="10" rx="3" fill="var(--accent)" opacity=".75"/></svg>`;

  const champSlots = L.league.champions
    .map(c => ({...c, slot: L.seasons[String(c.year)].draft.slots[c.tid] ?? null}))
    .filter(c => c.slot != null);
  const onePicks = years().map(yy => {
    const p = L.seasons[yy].draft.picks.find(pk => pk[1] === 1 && pk[2] === 1);
    if (!p) return null;
    const tid = p[3];
    const fin = L.seasons[yy].standings[tid]?.final_rank;
    return {y: yy, player: p[4], team: teamOf(yy, tid), mk: mgrOfTeam(yy, tid), fin};
  }).filter(Boolean);

  const orderSection = `
  <h2>Does draft order matter?</h2>
  <p class="sub">Finish quality is normalized for league size (100% = champion, 0% = last), so 8-team and 12-team eras compare fairly. ${xs.length} drafted seasons measured.</p>
  <div class="statrow">
    <div class="stat"><div class="v num">${r.toFixed(2)}</div><div class="l">Correlation, slot → finish</div></div>
    <div class="stat green"><div class="v" style="font-size:17px">${verdict}</div><div class="l">The verdict</div></div>
    ${champSlots.length ? `<div class="stat gold"><div class="v num">${num(mean(champSlots.map(c => c.slot)), 1)}</div><div class="l">Average champion's draft slot (${champSlots.map(c => c.slot).join(", ")})</div></div>` : ""}
  </div>
  ${table([
    {h: "Slot", num: 1, val: t => t.slot},
    {h: "Seasons", num: 1, val: t => t.n},
    {h: "Avg finish", num: 1, val: t => t.fin / t.n, fmt: t => num(t.fin / t.n, 1)},
    {h: "Finish quality", num: 1, val: t => t.pct / t.n, fmt: t => `${bar(t.pct / t.n)} <span class="num">${num(100 * t.pct / t.n, 0)}%</span>`},
    {h: "Playoff rate", num: 1, val: t => t.po / t.n, fmt: t => num(100 * t.po / t.n, 0) + "%"},
    {h: "Titles", num: 1, val: t => t.titles, fmt: t => t.titles ? "🏆".repeat(t.titles) : "—"},
    {h: "Sackos", num: 1, val: t => t.sackos, fmt: t => t.sackos ? "💀".repeat(t.sackos) : "—"},
  ], slotList, {sortCol: 0, sortDir: 1})}
  <p class="legend"><span>Slots with missing data (hidden accounts in 2015–17) are counted only where known.</span></p>

  <h2>The 1.01 club <span class="dim small">first pick of each draft</span></h2>
  ${table([
    {h: "Year", num: 1, val: o => o.y, fmt: o => `<a href="#/season/${o.y}">${o.y}</a>`},
    {h: "Player taken 1.01", val: o => o.player, fmt: o => `<b>${esc(o.player)}</b>`},
    {h: "Team", val: o => o.team, fmt: o => esc(o.team)},
    {h: "Manager", val: o => mname(o.mk), fmt: o => mlink(o.mk)},
    {h: "Finished", num: 1, val: o => o.fin, fmt: o => o.fin === 1 ? "1 🏆" : int(o.fin)},
  ], onePicks, {sortCol: 0, sortDir: -1})}`;

  return `
  <p class="kicker">Draft history</p>
  <h1>Drafts</h1>
  ${orderSection}

  <h2>Round-1 slot by year</h2>
  <div class="tablewrap"><table>
    <thead><tr><th>Manager</th>${years().map(yy => `<th class="num">${String(yy).slice(2)}</th>`).join("")}<th class="num">Avg</th></tr></thead>
    <tbody>${slotRows.map(r => `<tr><td>${mlink(r.mk)}</td>${r.slots.map(v => `<td class="num">${v ?? "·"}</td>`).join("")}<td class="num"><b>${num(r.avg, 1)}</b></td></tr>`).join("")}</tbody>
  </table></div>

  <h2 class="section-head">Draft board <span class="spacer"></span><select id="draftYear" class="ctl">${opts}</select></h2>
  <p class="sub">${y}: ${s.draft.rounds} rounds, ${s.draft.per_round} picks per round.</p>
  <div class="tablewrap" style="max-height:520px;overflow:auto;margin-top:12px"><table>
    <thead><tr><th class="num">Pick</th><th class="num">Rd</th><th>Player</th><th>Team</th><th>Manager</th></tr></thead>
    <tbody>${s.draft.picks.map(p => `<tr>
      <td class="num">${p[1]}.${String(p[2]).padStart(2, "0")}</td><td class="num">${p[1]}</td>
      <td>${esc(p[4])}</td><td>${esc(teamOf(y, p[3]))}</td><td>${mlink(mgrOfTeam(y, p[3]))}</td></tr>`).join("")}</tbody>
  </table></div>`;
};

// ── router ─────────────────────────────────────────────────────────────────
function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [pathPart, query] = hash.split("?");
  const seg = pathPart.split("/").filter(Boolean);
  const app = $("#app");
  tableRegistry.clear();
  let name = seg[0] || "home", html;
  try {
    if (name === "season" && seg[1]) html = views.season(seg[1]);
    else if (name === "manager" && seg[1]) html = views.manager(seg[1]);
    else if (name === "rivalry" && seg[2]) html = views.rivalry(seg[1], seg[2]);
    else if (views[name]) html = views[name](query);
    else { name = "home"; html = views.home(); }
  } catch (e) {
    html = `<p>Something broke rendering this page: ${esc(e.message)}</p>`;
    console.error(e);
  }
  app.innerHTML = html;
  const navName = {season: "seasons", manager: "managers", rivalry: "rivalries"}[name] || name;
  document.querySelectorAll(".nav a").forEach(a =>
    a.classList.toggle("active", a.dataset.route === navName));
  window.scrollTo({top: 0});

  if (name === "season" && seg[1]) {
    const sel = $("#wkSel"), box = $("#wkBox");
    if (sel && box) {
      const draw = () => box.innerHTML = weekBox(seg[1], sel.value);
      sel.value = String(Math.max(...L.seasons[seg[1]].weeks));
      sel.addEventListener("change", draw);
      draw();
    }
  }
  if (name === "draft") {
    $("#draftYear")?.addEventListener("change", e => location.hash = `#/draft?y=${e.target.value}`);
  }
}

// ── theme ──────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem("egl-theme");
  const dark = saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const btn = $("#themeToggle");
  const apply = mode => {
    document.documentElement.dataset.theme = mode;
    btn.textContent = mode === "dark" ? "☀️" : "🌙";
    btn.title = mode === "dark" ? "Switch to light mode" : "Switch to dark mode";
  };
  apply(dark ? "dark" : "light");
  btn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    apply(next);
    localStorage.setItem("egl-theme", next);
  });
}

// ── boot ───────────────────────────────────────────────────────────────────
(async function boot() {
  initTheme();
  try {
    const res = await fetch("data/league.json", {cache: "no-store"});
    L = await res.json();
  } catch (e) {
    $("#app").innerHTML = `<p>Could not load league data (${esc(e.message)}).</p>`;
    return;
  }
  $("#updated").textContent = new Date(document.lastModified).toLocaleDateString();
  initTableDelegation($("#app"));
  addEventListener("hashchange", route);
  route();
})();
