// Yahoo league scraper — runs INSIDE a logged-in Yahoo tab (football.fantasysports.yahoo.com)
// via the Claude in Chrome javascript tool. Yahoo's public API is closed, so pages are fetched
// in-page with the session cookies and parsed with DOMParser. Nothing leaves the browser except
// the JSON you read back.
//
// Usage (paste this whole file as one javascript_exec, then):
//   await window.__egl.scrape(2026, '/f1/8499')                       // current season: base = league path
//   await window.__egl.scrape(2019, '/league/bennettisthebest/2019')  // archived season via slug URL
//   window.__egl.render(2026)   // replaces the page with <pre>JSON</pre>; read it with get_page_text,
//                               // then save as data/raw/scraped/egl_<year>.json and run ingest_season.py
//
// Privacy: the teams page has an Email column in the commissioner view — only the first two
// columns (team, manager) are ever read.

window.__egl = window.__egl || {data: {}};
(() => {
  const sleep = ms => new Promise(z => setTimeout(z, ms));
  const fdoc = async (url) => {
    const r = await fetch(url, {credentials: "same-origin"});
    const d = new DOMParser().parseFromString(await r.text(), "text/html");
    const b = d.createElement("base"); b.href = r.url; d.head.prepend(b);
    d.querySelectorAll("style,script,noscript").forEach(e => e.remove());
    await sleep(350);
    return {d, path: new URL(r.url).pathname};
  };
  const cellsOf = tr => Array.from(tr.querySelectorAll("th,td")).map(c => c.textContent.trim().replace(/\s+/g, " "));
  const tablesOf = doc => Array.from(doc.querySelectorAll("table")).map(t => ({
    h: Array.from(t.querySelectorAll("th")).map(x => x.textContent.trim().replace(/\s+/g, " ")).slice(0, 12),
    r: Array.from(t.querySelectorAll("tbody tr")).map(tr => cellsOf(tr).slice(0, 12)),
  }));
  const samePath = (a, b) => a.replace(/\/$/, "") === b.replace(/\/$/, "");
  const tabAnchor = (doc, label, paths) => Array.from(doc.querySelectorAll("a"))
    .find(a => a.textContent.trim() === label && a.search && paths.some(p => samePath(a.pathname, p)));
  const bracketText = doc => {
    for (const e of doc.querySelectorAll("div,section")) {
      const tx = e.innerText || "";
      if (/(Quarterfinal|Semifinal|Final)/.test(tx) && /\d{2,3}\.\d{2}/.test(tx) && tx.length < 7000) return tx.replace(/\n{2,}/g, "\n");
    }
    return null;
  };

  window.__egl.scrape = async (year, overviewPath) => {
    const {d: d0, path: p0} = await fdoc(overviewPath);
    let base;
    const idm = Array.from(d0.querySelectorAll("a")).map(a => a.pathname.match(new RegExp("^/" + year + "/f1/(\\d+)"))).find(Boolean);
    if (idm) base = "/" + year + "/f1/" + idm[1];
    else if (/^\/f1\/\d+/.test(overviewPath)) base = overviewPath.match(/^\/f1\/\d+/)[0];
    else return "FAIL: could not determine league base path for " + year;
    const paths = [overviewPath, p0, base];
    const S = {year, league_id: base.split("/").pop(), base};

    const pod = d0.querySelector("table");
    S.podium = pod ? Array.from(pod.querySelectorAll("tbody tr")).map(cellsOf) : null;
    S.bracket_text = bracketText(d0);

    const stA = tabAnchor(d0, "Standings", paths);
    if (stA) {
      const {d: dS} = await fdoc(stA.href);
      for (const t of dS.querySelectorAll("table")) {
        const h = Array.from(t.querySelectorAll("th")).map(x => x.textContent.trim());
        if (h.some(x => /W-L-T|Pct/.test(x))) {
          S.standings = {h: h.slice(0, 12), r: Array.from(t.querySelectorAll("tbody tr")).map(tr => {
            const a = tr.querySelector('a[href*="/f1/"]');
            const m = a ? a.pathname.match(/\/f1\/\d+\/(\d+)/) : null;
            return [m ? m[1] : ""].concat(cellsOf(tr).slice(0, 10));
          })};
          break;
        }
      }
    }
    const pA = tabAnchor(d0, "Playoffs", paths);
    if (pA) S.playoffs_text = bracketText((await fdoc(pA.href)).d);

    const {d: dD} = await fdoc(base + "/draftresults");
    S.draft = Array.from(dD.querySelectorAll("table")).map(t => ({
      round: (Array.from(t.querySelectorAll("th")).map(x => x.textContent.trim()).find(Boolean) || ""),
      picks: Array.from(t.querySelectorAll("tbody tr")).map(tr => {
        const c = cellsOf(tr);
        const pa = tr.querySelector('a[href*="/nfl/players/"]');
        const pm = pa ? pa.pathname.match(/players\/(\d+)/) : null;
        const ta = tr.querySelector('a[href*="/f1/"]');
        const tm = ta ? ta.pathname.match(/\/f1\/\d+\/(\d+)/) : null;
        return {n: c[0] || "", player: pa ? pa.textContent.trim() : (c[1] || ""), pid: pm ? pm[1] : "", tid: tm ? tm[1] : "", team_txt: c[2] || ""};
      }),
    }));

    const {d: dT} = await fdoc(base + "/teams");
    const tTab = Array.from(dT.querySelectorAll("table")).find(t => Array.from(t.querySelectorAll("th")).some(h => /Manager/.test(h.textContent)));
    S.teams = tTab ? Array.from(tTab.querySelectorAll("tbody tr")).map(tr => {
      const a = tr.querySelector('a[href*="/f1/"]');
      const m = a ? a.pathname.match(/\/f1\/\d+\/(\d+)/) : null;
      const c = cellsOf(tr);
      return [m ? m[1] : "", c[0] || "", c[1] || ""];   // team, manager only — never the email column
    }) : null;

    S.recordbook = tablesOf((await fdoc(base + "/recordbook")).d);
    S.settings = tablesOf((await fdoc(base + "/settings")).d).slice(0, 6);

    const schA = tabAnchor(d0, "Schedule", paths);
    S.schedules = {};
    if (schA) {
      const {d: dSch} = await fdoc(schA.href);
      const schedTable = doc => {
        for (const t of doc.querySelectorAll("table")) {
          const heads = Array.from(t.querySelectorAll("th")).map(h => h.textContent.trim());
          if (heads.includes("Wk") && heads.includes("Opponent")) {
            return Array.from(t.querySelectorAll("tbody tr")).map(tr => Array.from(tr.querySelectorAll("td")).map(td => td.textContent.trim().replace(/\s+/g, " ")).slice(0, 4));
          }
        }
        return null;
      };
      const anchors = [], seen = new Set();
      for (const a of dSch.querySelectorAll("a")) {
        const nm = a.textContent.trim().replace(/\s+/g, " ");
        if (!nm || seen.has(nm)) continue;
        if (samePath(a.pathname, base) && a.search && a.closest("ul")) { seen.add(nm); anchors.push([nm, a.href]); }
      }
      for (const [nm, href] of anchors) {
        const rows = schedTable((await fdoc(href)).d);
        if (rows) S.schedules[nm] = rows;
      }
    }
    // Yahoo's roster-based weekly projections, read from the LIVE league page's matchup
    // module (document.body.innerText has real line breaks; fetched docs don't).
    try { S.projections = window.__egl.projections(); } catch (e) { S.projections = null; }
    try {
      const all = await window.__egl.playerStats(base, year);
      // keep only drafted players — that is all the draft report card needs, and it
      // keeps the payload that has to travel out through the page text channel small
      const want = new Set();
      for (const rd of S.draft) for (const pk of rd.picks) {
        want.add(pk.pid ? pk.pid : "DEF:" + pk.player.split(" (")[0].trim());
      }
      S.player_stats = {};
      for (const k of want) if (all[k]) S.player_stats[k] = {pts: all[k].pts};
    } catch (e) { S.player_stats = null; }
    window.__egl.data[year] = S;
    try { sessionStorage.setItem("EGL_" + year, JSON.stringify(S)); } catch (e) {}
    return "OK " + year + " base=" + base + " standings=" + (S.standings ? S.standings.r.length : 0) +
      " draft=" + S.draft.length + " teams=" + (S.teams ? S.teams.length : 0) + " sched=" + Object.keys(S.schedules).length +
      " bracket=" + (S.bracket_text ? 1 : 0) + " players=" + (S.player_stats ? Object.keys(S.player_stats).length : 0);
  };

  // Parse "Team / record / live / projected vs live / projected / Team / record" blocks from the
  // league overview's matchup module. Returns {week, teams: [{team, live, proj}]}.
  window.__egl.projections = () => {
    const txt = document.body.innerText || "";
    const weekM = txt.match(/Matchups[^\n]*\n\s*Week (\d+)/);
    // blocks look like: Team\n0-0-0\n \n \n40.12\n105.53\n\tvs\t\n6.30\n102.80\n \n \nTeam\n0-0-0
    // once the season starts each record line gains a standing suffix: "0-1-0 | 11th"
    const re = /\n([^\n]+)\n(\d+-\d+-\d+)(?: \| \d+\w*)?\s+([\d.]+)\s+([\d.]+)\s+vs\s+([\d.]+)\s+([\d.]+)\s+([^\n]+)\n(\d+-\d+-\d+)/g;
    const teams = [];
    let m;
    while ((m = re.exec(txt))) {
      teams.push({team: m[1].trim(), live: +m[3], proj: +m[4]});
      teams.push({team: m[7].trim(), live: +m[5], proj: +m[6]});
    }
    return {week: weekM ? +weekM[1] : null, teams};
  };


  // Season fantasy points for every player, from the league Player List (paged).
  // Used for draft best/worst-pick value. Offense + kickers key by Yahoo player id;
  // team defenses have no player id, so they key as "DEF:<Name>".
  window.__egl.playerStats = async (base, year, maxOff) => {
    const sleep = ms => new Promise(z => setTimeout(z, ms));
    const out = {};
    const grab = async (pos, last) => {
      for (let c = 0; c <= last; c += 25) {
        const url = `${base}/players?status=ALL&pos=${pos}&stat1=S_S_${year}&sort=PR&sdir=1&count=${c}`;
        let d;
        try {
          const r = await fetch(url, {credentials: "same-origin"});
          d = new DOMParser().parseFromString(await r.text(), "text/html");
        } catch (e) { break; }
        const trs = d.querySelectorAll("table tbody tr");
        if (!trs.length) break;
        for (const tr of trs) {
          const td = Array.from(tr.querySelectorAll("td")).map(x => x.textContent.trim().replace(/\s+/g, " "));
          if (td.length < 9) continue;
          const a = tr.querySelector('a[href*="/nfl/players/"]');
          let key = null, nm = null;
          if (a) {
            const m = a.getAttribute("href").match(/players\/(\d+)/);
            if (m) { key = m[1]; nm = a.textContent.trim(); }
          } else if (pos === "DEF") {
            nm = (td[2] || "").replace(/No new player.*$/, "").trim();
            // skip the position-legend rows Yahoo renders in the same table
            if (nm && !/^(Who is|Only |Any )/.test(nm)) key = "DEF:" + nm;
          }
          if (!key) continue;
          out[key] = {n: nm, pts: parseFloat(td[6]) || 0, pr: parseInt(td[7]) || null};
        }
        await sleep(250);
      }
    };
    await grab("O", maxOff || 400);
    await grab("K", 75);
    await grab("DEF", 75);
    return out;
  };

  window.__egl.render = (year) => {
    const json = JSON.stringify(window.__egl.data[year]);
    const pre = document.createElement("pre");
    pre.id = "egl-data";
    pre.textContent = json;
    document.body.replaceChildren(pre);
    document.title = "egl_" + year;
    return "rendered " + json.length + " chars";
  };
})();
"scraper ready"
