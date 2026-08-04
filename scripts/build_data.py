"""Normalize raw scraped season JSON into docs/data/league.json for the site.

Reads  data/raw/scraped/egl_all.json  (browser scrape of all seasons)
Writes docs/data/league.json          (everything the static site renders)

Also prints a validation report: matchup mirror checks, bracket/podium
agreement, and manager-identity suspects that need a human eye.
"""

import json
import re
import statistics
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "scraped" / "egl_all.json"
OUT = ROOT / "docs" / "data"
OUT.mkdir(parents=True, exist_ok=True)

WARN = []


def warn(msg):
    WARN.append(msg)


def norm(s: str) -> str:
    """Normalize a team name for identity matching across pages."""
    s = (s or "").replace("’", "'").replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip().casefold()


def clean_manager(s: str) -> str:
    s = (s or "").strip()
    s = re.sub(r"(Co-)?Commissioner$", "", s).strip()
    return s or "?"


# Hidden Yahoo accounts identified by Bennett; key = (year, normalized team name).
MANAGER_OVERRIDES = {
    ("2015", "rip my entire team"): "Kelly",
    ("2016", "green team"): "Kelly",
    ("2016", "jordan's choice team"): "Jordan Sirek",
    ("2017", "jordan's choice team"): "Jordan Sirek",
    ("2017", "juju headhunters inc"): "Bryan",
}


def fnum(s):
    try:
        return float(str(s).replace(",", ""))
    except ValueError:
        return None


# --------------------------------------------------------------------------
# per-season parsing
# --------------------------------------------------------------------------

def parse_teams(S):
    """tid -> {name, manager}; also norm-name -> tid index."""
    teams, byname = {}, {}
    for tid, name, mgr in S.get("teams") or []:
        if not tid:
            warn(f"{S['year']}: team row missing tid: {name}")
            continue
        manager = clean_manager(mgr)
        if "hidden" in manager.lower():
            override = MANAGER_OVERRIDES.get((str(S["year"]), norm(name)))
            if override:
                manager = override
            else:
                # keep unknown hidden accounts distinct; same team name across
                # years is assumed to be the same person
                manager = f"Mystery ({name.strip()})"
                warn(f"{S['year']}: unidentified hidden account: {name}")
        teams[tid] = {"name": name.strip(), "manager": manager}
        byname[norm(name)] = tid
    return teams, byname


def parse_standings(S, byname):
    """Yahoo standings rows -> final placements (+ divisions when present)."""
    st = S.get("standings")
    if not st:
        return {}
    heads = st["h"]

    def col(label):
        for i, h in enumerate(heads):
            if h.startswith(label):
                return i + 1  # +1 for prepended tid
        return None

    c_rank, c_wlt, c_div = col("Rank"), col("W-L-T"), col("Div")
    c_pf, c_pa = col("PF"), col("PA")
    out, division = {}, None
    for row in st["r"]:
        tid = row[0]
        if not tid:
            if len(row) >= 2 and row[1] and len(row[1]) < 20:
                division = row[1]
            continue
        rank_cell = row[c_rank] if c_rank and c_rank < len(row) else ""
        m = re.search(r"(\d+)", rank_cell or "")
        wlt = row[c_wlt] if c_wlt and c_wlt < len(row) else ""
        wm = re.match(r"(\d+)-(\d+)-(\d+)", wlt or "")
        out[tid] = {
            "final_rank": int(m.group(1)) if m else None,
            "flags": re.sub(r"[\d\s]", "", rank_cell or ""),
            "wlt": [int(wm.group(i)) for i in (1, 2, 3)] if wm else None,
            "pf": fnum(row[c_pf]) if c_pf and c_pf < len(row) else None,
            "pa": fnum(row[c_pa]) if c_pa and c_pa < len(row) else None,
            "division": division,
        }
    return out


def parse_matchups(S, byname):
    """Dedupe the per-team schedules into one matchup list; verify mirrors."""
    seen = {}
    for tname, rows in (S.get("schedules") or {}).items():
        t = byname.get(norm(tname))
        if not t:
            warn(f"{S['year']}: schedule team not in teams: {tname}")
            continue
        for r in rows:
            if len(r) < 4:
                continue
            wk, opp, res, score = r[0], r[1], r[2], r[3]
            sm = re.match(r"([\d.]+)\s*-\s*([\d.]+)", score or "")
            wm = re.match(r"(\d+)", str(wk).strip())
            if not sm or not wm:
                if opp and sm:
                    warn(f"{S['year']}: dropped schedule row for {tname}: wk cell '{wk}'")
                continue
            wk = wm.group(1)
            o = byname.get(norm(opp))
            if not o:
                warn(f"{S['year']}: opponent not found: {opp}")
                continue
            a, b = sorted([t, o], key=int)
            mine, theirs = float(sm.group(1)), float(sm.group(2))
            sa, sb = (mine, theirs) if a == t else (theirs, mine)
            key = (int(wk), a, b)
            if key in seen:
                pa, pb = seen[key]
                if abs(pa - sa) > 0.01 or abs(pb - sb) > 0.01:
                    warn(f"{S['year']} wk{wk}: mirror mismatch {a}v{b}: {pa}/{pb} vs {sa}/{sb}")
            else:
                seen[key] = (sa, sb)
    return [{"w": w, "a": a, "b": b, "as": s[0], "bs": s[1]}
            for (w, a, b), s in sorted(seen.items())]


ROUND_RE = re.compile(
    r"(Quarterfinal|Semifinal|Final|\d(?:st|nd|rd|th) Place Game)"
    r"\s*(\d{1,2})\s+(.*?)(?:\s*(\d{1,4}\.\d{2})|\s*Bye)"
    r"(?:\s*(\d{1,2})\s+(.*?)\s+(\d{1,4}\.\d{2}))?",
)
WEEK_RE = re.compile(r"Week (\d+):")


def parse_playoffs(S, byname):
    text = S.get("playoffs_text") or S.get("bracket_text") or ""
    text = text.replace(" ", " ")
    weeks = [(m.start(), int(m.group(1))) for m in WEEK_RE.finditer(text)]

    def week_at(pos):
        wk = None
        for p, w in weeks:
            if p <= pos:
                wk = w
        return wk

    games = []
    for m in ROUND_RE.finditer(text):
        rnd, seed1, name1, score1, seed2, name2, score2 = m.groups()
        g = {"round": rnd, "week": week_at(m.start())}
        t1 = byname.get(norm(name1))
        if not t1:
            warn(f"{S['year']} playoffs: unknown team '{name1}'")
            continue
        g["seedA"], g["a"] = int(seed1), t1
        if score1 is None:
            g["bye"] = True
        else:
            g["sA"] = float(score1)
        if name2:
            t2 = byname.get(norm(name2))
            if not t2:
                warn(f"{S['year']} playoffs: unknown team '{name2}'")
            else:
                g["seedB"], g["b"], g["sB"] = int(seed2), t2, float(score2)
        games.append(g)

    podium_tids = []
    pod = S.get("podium") or []
    if pod and pod[0]:
        for cell in pod[0][:3]:
            tid = byname.get(norm(cell))
            podium_tids.append(tid)
            if not tid and cell:
                warn(f"{S['year']}: podium name unmapped: {cell}")
    finals = [g for g in games if g["round"] == "Final" and "b" in g]
    if finals and podium_tids and podium_tids[0]:
        f = finals[-1]
        winner = f["a"] if f.get("sA", 0) > f.get("sB", 0) else f["b"]
        if winner != podium_tids[0]:
            warn(f"{S['year']}: bracket final winner != podium champion")
    return {"games": games, "podium": podium_tids}


def parse_draft(S, byname, teams):
    picks, slots = [], {}
    rounds = S.get("draft") or []
    per_round = max((len(r.get("picks", [])) for r in rounds), default=0)
    for r in rounds:
        rm = re.search(r"(\d+)", r.get("round") or "")
        if not rm:
            continue
        rd = int(rm.group(1))
        for p in r.get("picks", []):
            nm = re.search(r"(\d+)", p.get("n") or "")
            if not nm:
                continue
            pk = int(nm.group(1))
            tid = p.get("tid") or ""
            if tid not in teams:
                txt = (p.get("team_txt") or "").replace("...", "").strip()
                cand = [t for t, v in teams.items() if norm(v["name"]).startswith(norm(txt)[:12])]
                tid = cand[0] if len(cand) == 1 else None
                if not tid:
                    warn(f"{S['year']} draft {rd}.{pk}: team unmapped '{p.get('team_txt')}'")
                    continue
            if rd == 1:
                slots[tid] = pk
            picks.append([(rd - 1) * per_round + pk, rd, pk, tid, p.get("player") or "", p.get("pid") or ""])
    return {"rounds": len(rounds), "per_round": per_round, "slots": slots, "picks": picks}


def parse_settings(S):
    tables = S.get("settings") or []
    kv = {}
    if tables:
        for row in tables[0].get("r", []):
            if len(row) >= 2:
                kv[row[0].rstrip(":")] = row[1]
    scoring = {}
    if len(tables) > 1:
        for row in tables[1].get("r", []):
            if len(row) >= 2 and row[0]:
                key = re.sub(r"Yahoo Default$", "", row[0]).strip()
                scoring[key] = row[1]
    playoff = kv.get("Playoffs", "")
    pm = re.search(r"(\d+) teams? - Week (\d+)", playoff)
    return {
        "league_name": kv.get("League Name"),
        "scoring_type": kv.get("Scoring Type"),
        "max_teams": kv.get("Max Teams"),
        "playoff_teams": int(pm.group(1)) if pm else None,
        "playoff_start": int(pm.group(2)) if pm else None,
        "divisions": kv.get("Divisions", "No"),
        "roster": kv.get("Roster Positions"),
        "ppr": scoring.get("Receptions"),
        "pass_td": scoring.get("Passing Touchdowns"),
        "trade_end": kv.get("Trade End Date"),
    }


# --------------------------------------------------------------------------
# aggregation
# --------------------------------------------------------------------------

def mgr_key(name):
    return norm(name)


def build():
    raw = json.loads(RAW.read_text(encoding="utf-8"))
    years = sorted(k for k in raw if k.isdigit())

    seasons = {}
    name_history = []
    champions = []

    for y in years:
        S = raw[y]
        teams, byname = parse_teams(S)
        standings = parse_standings(S, byname)
        matchups = parse_matchups(S, byname)
        playoffs = parse_playoffs(S, byname)
        draft = parse_draft(S, byname, teams)
        settings = parse_settings(S)
        # older archives omit the Playoffs setting — infer from the bracket
        if not settings.get("playoff_teams"):
            seeds = [g.get(k) for g in playoffs["games"] for k in ("seedA", "seedB") if g.get(k)]
            settings["playoff_teams"] = max(seeds) if seeds else None
        if not settings.get("playoff_start"):
            wks = [g["week"] for g in playoffs["games"] if g.get("week")]
            settings["playoff_start"] = min(wks) if wks else None

        n_teams = len(teams)
        weeks = sorted({m["w"] for m in matchups})
        for w in weeks:
            n = sum(1 for m in matchups if m["w"] == w)
            if n != n_teams // 2:
                warn(f"{y} wk{w}: {n} matchups for {n_teams} teams")

        # regular-season table + weekly stats
        reg = {t: {"w": 0, "l": 0, "t": 0, "pf": 0.0, "pa": 0.0, "crowns": 0,
                   "ap_w": 0, "ap_l": 0, "scores": []} for t in teams}
        by_week = defaultdict(list)
        for m in matchups:
            by_week[m["w"]].append(m)
        for w, ms in by_week.items():
            scores = []
            for m in ms:
                scores += [(m["a"], m["as"]), (m["b"], m["bs"])]
                a, b = reg[m["a"]], reg[m["b"]]
                a["pf"] += m["as"]; a["pa"] += m["bs"]
                b["pf"] += m["bs"]; b["pa"] += m["as"]
                a["scores"].append((w, m["as"])); b["scores"].append((w, m["bs"]))
                if abs(m["as"] - m["bs"]) < 1e-9:
                    a["t"] += 1; b["t"] += 1
                elif m["as"] > m["bs"]:
                    a["w"] += 1; b["l"] += 1
                else:
                    b["w"] += 1; a["l"] += 1
            top = max(s for _, s in scores)
            for t, s in scores:
                below = sum(1 for _, s2 in scores if s2 < s)
                above = sum(1 for _, s2 in scores if s2 > s)
                reg[t]["ap_w"] += below
                reg[t]["ap_l"] += above
                if abs(s - top) < 1e-9:
                    reg[t]["crowns"] += 1

        all_scores = [s for t in reg.values() for _, s in t["scores"]]
        season_mean = statistics.mean(all_scores) if all_scores else 0.0

        for t, r in reg.items():
            games = r["w"] + r["l"] + r["t"]
            r["ppg"] = round(r["pf"] / games, 2) if games else 0
            r["papg"] = round(r["pa"] / games, 2) if games else 0
            r["ppg_norm"] = round(100 * r["ppg"] / season_mean, 1) if season_mean else None
            r["papg_norm"] = round(100 * r["papg"] / season_mean, 1) if season_mean else None
            ap_games = r["ap_w"] + r["ap_l"]
            exp_wins = games * r["ap_w"] / ap_games if ap_games else 0
            r["luck"] = round(r["w"] + 0.5 * r["t"] - exp_wins, 2)
            r["pf"] = round(r["pf"], 2); r["pa"] = round(r["pa"], 2)
            del r["scores"]

        reg_rank = sorted(reg, key=lambda t: (-(reg[t]["w"] + 0.5 * reg[t]["t"]), -reg[t]["pf"]))
        for i, t in enumerate(reg_rank, 1):
            reg[t]["reg_rank"] = i

        if settings.get("league_name"):
            name_history.append({"year": int(y), "name": settings["league_name"]})
        champ_tid = (playoffs.get("podium") or [None])[0]
        if champ_tid:
            champions.append({"year": int(y), "tid": champ_tid,
                              "team": teams[champ_tid]["name"],
                              "manager": teams[champ_tid]["manager"]})

        seasons[y] = {
            "league_id": S.get("league_id"),
            "teams": teams,
            "standings": standings,
            "reg": reg,
            "matchups": matchups,
            "playoffs": playoffs,
            "draft": draft,
            "settings": settings,
            "season_mean_score": round(season_mean, 2),
            "weeks": weeks,
        }

    # ---- manager registry ------------------------------------------------
    managers = {}
    for y in years:
        sn = seasons[y]
        for tid, tv in sn["teams"].items():
            mk = mgr_key(tv["manager"])
            m = managers.setdefault(mk, {"name": tv["manager"], "seasons": {}})
            st = sn["standings"].get(tid, {})
            r = sn["reg"][tid]
            pod = sn["playoffs"]["podium"]
            n_teams = len(sn["teams"])
            playoff_teams = sn["settings"].get("playoff_teams")
            made = None
            if pod and tid == pod[0]:
                result = "champion"
            elif pod and len(pod) > 1 and tid == pod[1]:
                result = "runner-up"
            elif pod and len(pod) > 2 and tid == pod[2]:
                result = "third"
            else:
                fr = st.get("final_rank")
                if playoff_teams and fr:
                    made = fr <= playoff_teams
                result = "made-playoffs" if made else ("missed" if made is not None else "?")
            m["seasons"][y] = {
                "tid": tid, "team": tv["name"],
                "w": r["w"], "l": r["l"], "t": r["t"],
                "pf": r["pf"], "pa": r["pa"],
                "ppg": r["ppg"], "papg": r["papg"],
                "ppg_norm": r["ppg_norm"], "papg_norm": r["papg_norm"],
                "luck": r["luck"], "crowns": r["crowns"],
                "ap_w": r["ap_w"], "ap_l": r["ap_l"],
                "reg_rank": r["reg_rank"],
                "final_rank": st.get("final_rank"),
                "division": st.get("division"),
                "result": result,
                "last_place": st.get("final_rank") == n_teams,
                "draft_slot": sn["draft"]["slots"].get(tid),
            }

    # career aggregates + cross-season streaks
    for mk, m in managers.items():
        ss = m["seasons"]
        games = [(int(y), s) for y, s in ss.items()]
        w = sum(s["w"] for _, s in games); l = sum(s["l"] for _, s in games)
        t = sum(s["t"] for _, s in games)
        norm_vals = [s["ppg_norm"] for _, s in games if s["ppg_norm"]]
        finishes = [s["final_rank"] for _, s in games if s["final_rank"]]
        slots = [s["draft_slot"] for _, s in games if s["draft_slot"]]
        m["career"] = {
            "seasons": len(ss),
            "w": w, "l": l, "t": t,
            "pct": round((w + 0.5 * t) / max(w + l + t, 1), 3),
            "pf": round(sum(s["pf"] for _, s in games), 2),
            "pa": round(sum(s["pa"] for _, s in games), 2),
            "avg_ppg_norm": round(statistics.mean(norm_vals), 1) if norm_vals else None,
            "avg_finish": round(statistics.mean(finishes), 2) if finishes else None,
            "best_finish": min(finishes) if finishes else None,
            "worst_finish": max(finishes) if finishes else None,
            "titles": sum(1 for _, s in games if s["result"] == "champion"),
            "podiums": sum(1 for _, s in games if s["result"] in ("champion", "runner-up", "third")),
            "last_places": sum(1 for _, s in games if s["last_place"]),
            "playoff_apps": sum(1 for _, s in games if s["result"] in ("champion", "runner-up", "third", "made-playoffs")),
            "crowns": sum(s["crowns"] for _, s in games),
            "luck": round(sum(s["luck"] for _, s in games), 1),
            "avg_draft_slot": round(statistics.mean(slots), 1) if slots else None,
        }

    # ---- chronological per-manager game log (for streaks + H2H) ----------
    def tid_mgr(y, tid):
        tv = seasons[y]["teams"].get(tid)
        return mgr_key(tv["manager"]) if tv else None

    game_log = []  # (year, week, mgrA, mgrB, sA, sB, playoff?)
    for y in years:
        sn = seasons[y]
        for m in sn["matchups"]:
            game_log.append((int(y), m["w"], tid_mgr(y, m["a"]), tid_mgr(y, m["b"]),
                             m["as"], m["bs"], False))
        for g in sn["playoffs"]["games"]:
            if "b" in g and "sA" in g and "sB" in g:
                game_log.append((int(y), g.get("week") or 99, tid_mgr(y, g["a"]),
                                 tid_mgr(y, g["b"]), g["sA"], g["sB"], True))
    game_log.sort(key=lambda g: (g[0], g[1]))

    streaks = defaultdict(lambda: {"cur": 0, "best_w": 0, "best_l": 0})
    for y, w, a, b, sa, sb, po in game_log:
        if sa == sb or not a or not b:
            continue
        winner, loser = (a, b) if sa > sb else (b, a)
        sw = streaks[winner]
        sw["cur"] = sw["cur"] + 1 if sw["cur"] >= 0 else 1
        sw["best_w"] = max(sw["best_w"], sw["cur"])
        sl = streaks[loser]
        sl["cur"] = sl["cur"] - 1 if sl["cur"] <= 0 else -1
        sl["best_l"] = max(sl["best_l"], -sl["cur"])
    for mk in managers:
        s = streaks.get(mk, {"cur": 0, "best_w": 0, "best_l": 0})
        managers[mk]["streaks"] = {"longest_win": s["best_w"], "longest_loss": s["best_l"],
                                   "current": s["cur"]}

    # ---- head-to-head matrix ---------------------------------------------
    h2h = defaultdict(lambda: defaultdict(lambda: {"w": 0, "l": 0, "t": 0,
                                                   "pf": 0.0, "pa": 0.0, "games": 0,
                                                   "po_w": 0, "po_l": 0}))
    for y, w, a, b, sa, sb, po in game_log:
        if not a or not b:
            continue
        for me, opp, sm, so in ((a, b, sa, sb), (b, a, sb, sa)):
            cell = h2h[me][opp]
            cell["games"] += 1
            cell["pf"] = round(cell["pf"] + sm, 2)
            cell["pa"] = round(cell["pa"] + so, 2)
            if sm > so:
                cell["w"] += 1
                if po:
                    cell["po_w"] += 1
            elif sm < so:
                cell["l"] += 1
                if po:
                    cell["po_l"] += 1
            else:
                cell["t"] += 1

    # ---- record book ------------------------------------------------------
    def game_records():
        rows = []
        for y in years:
            sn = seasons[y]
            mean = sn["season_mean_score"]
            for m in sn["matchups"]:
                for tid, s, opp, so in ((m["a"], m["as"], m["b"], m["bs"]),
                                        (m["b"], m["bs"], m["a"], m["as"])):
                    rows.append({
                        "year": int(y), "week": m["w"], "tid": tid,
                        "team": sn["teams"][tid]["name"],
                        "manager": sn["teams"][tid]["manager"],
                        "score": s, "opp_score": so,
                        "opp": sn["teams"][opp]["name"],
                        "norm": round(100 * s / mean, 1) if mean else None,
                        "won": s > so, "margin": round(s - so, 2),
                    })
        return rows

    rows = game_records()
    def top(key, n=10, rev=True, flt=None):
        pool = [r for r in rows if (flt(r) if flt else True)]
        return sorted(pool, key=key, reverse=rev)[:n]

    records = {
        "high_score": top(lambda r: r["score"]),
        "high_score_norm": top(lambda r: r["norm"] or 0),
        "low_score": top(lambda r: r["score"], rev=False),
        "biggest_blowout": top(lambda r: r["margin"], flt=lambda r: r["won"]),
        "closest_game": top(lambda r: abs(r["margin"]), rev=False, flt=lambda r: r["margin"] != 0),
        "best_loss": top(lambda r: r["score"], flt=lambda r: not r["won"]),
        "worst_win": top(lambda r: r["score"], rev=False, flt=lambda r: r["won"]),
        "combined_high": [],
        "combined_low": [],
    }
    combos = []
    for y in years:
        sn = seasons[y]
        for m in sn["matchups"]:
            combos.append({"year": int(y), "week": m["w"],
                           "a": sn["teams"][m["a"]]["name"], "b": sn["teams"][m["b"]]["name"],
                           "as": m["as"], "bs": m["bs"],
                           "total": round(m["as"] + m["bs"], 2)})
    records["combined_high"] = sorted(combos, key=lambda c: c["total"], reverse=True)[:10]
    records["combined_low"] = sorted(combos, key=lambda c: c["total"])[:10]

    # ---- manager identity report -----------------------------------------
    keys = sorted(managers)
    suspects = []
    for i, k1 in enumerate(keys):
        for k2 in keys[i + 1:]:
            f1, f2 = k1.split()[0], k2.split()[0]
            if f1 == f2:
                suspects.append((managers[k1]["name"], managers[k2]["name"]))

    out = {
        "league": {
            "name": "The Excellent Gentlemen",
            "slug": "bennettisthebest",
            "name_history": name_history,
            "years": [int(y) for y in years],
            "champions": champions,
        },
        "seasons": seasons,
        "managers": managers,
        "h2h": {a: dict(b) for a, b in h2h.items()},
        "records": records,
    }
    (OUT / "league.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")

    # ---- report ----------------------------------------------------------
    print(f"Wrote {OUT / 'league.json'} ({(OUT / 'league.json').stat().st_size // 1024} KB)")
    print(f"Seasons: {len(seasons)}  Managers: {len(managers)}  Games: {len(game_log)}")
    print("\nName history:", [f"{h['year']}: {h['name']}" for h in name_history])
    print("\nChampions:")
    for c in champions:
        print(f"  {c['year']}  {c['team']}  ({c['manager']})")
    print("\nManager career table:")
    for mk in sorted(managers, key=lambda k: -managers[k]["career"]["seasons"]):
        c = managers[mk]["career"]
        print(f"  {managers[mk]['name']:<14} {c['seasons']:>2} szn  {c['w']}-{c['l']}-{c['t']}"
              f"  pct {c['pct']:.3f}  titles {c['titles']}  avg finish {c['avg_finish']}"
              f"  normPPG {c['avg_ppg_norm']}  luck {c['luck']:+}")
    if suspects:
        print("\nPOSSIBLE same-person managers (need Bennett's confirmation):")
        for a, b in suspects:
            print(f"  {a}  <->  {b}")
    print(f"\nWarnings ({len(WARN)}):")
    for w in WARN[:40]:
        print("  " + w)
    if len(WARN) > 40:
        print(f"  ... and {len(WARN) - 40} more")


if __name__ == "__main__":
    build()
