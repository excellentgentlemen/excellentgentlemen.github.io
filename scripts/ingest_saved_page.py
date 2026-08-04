"""Extract the scraped league JSON from the browser-saved egl_all.html page.

Writes data/raw/scraped/egl_all.json plus per-season files, and prints a
validation summary.
"""

import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "raw" / "scraped"
OUT.mkdir(parents=True, exist_ok=True)

src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Downloads" / "egl_all.html"
raw = src.read_text(encoding="utf-8", errors="replace")

m = re.search(r'<pre id="egl-data"[^>]*>(.*?)</pre>', raw, re.S)
if not m:
    raise SystemExit(f"No egl-data <pre> found in {src}")

data = json.loads(html.unescape(m.group(1)))
(OUT / "egl_all.json").write_text(json.dumps(data, indent=1), encoding="utf-8")

print(f"Parsed {src.name}: {len(data)} top-level keys\n")
print(f"{'Year':<6}{'LID':<9}{'Teams':<7}{'Sched':<7}{'Draft rds':<10}{'Champion (podium row 1)'}")
for k in sorted(data):
    if k == "meta":
        continue
    s = data[k]
    (OUT / f"{k}.json").write_text(json.dumps(s, indent=1), encoding="utf-8")
    teams = len(s.get("teams") or [])
    sched = len(s.get("schedules") or {})
    draft = len(s.get("draft") or [])
    pod = (s.get("podium") or [["?"]])[0]
    print(f"{k:<6}{s.get('league_id',''):<9}{teams:<7}{sched:<7}{draft:<10}{pod[0] if pod else '?'}")

meta = data.get("meta") or {}
at = meta.get("alltime_tab") or []
print(f"\nmeta.alltime_tab: {len(at)} tables")
print("\nAll seasons written to", OUT)
