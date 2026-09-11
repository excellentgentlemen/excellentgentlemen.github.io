"""Merge one scraped season into data/raw/scraped/egl_all.json.

Usage:
    python scripts/ingest_season.py 2026                 # reads data/raw/scraped/egl_2026.json
    python scripts/ingest_season.py 2026 path/to.json    # explicit file

The season JSON is the object produced by scripts/browser_scrape.js for one
year (the same shape as each year entry inside egl_all.json). Follow with
scripts/build_data.py to regenerate docs/data/league.json.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "scraped"

if len(sys.argv) < 2:
    raise SystemExit("usage: ingest_season.py <year> [file.json]")
year = sys.argv[1]
src = Path(sys.argv[2]) if len(sys.argv) > 2 else RAW / f"egl_{year}.json"

season = json.loads(src.read_text(encoding="utf-8"))
if str(season.get("year")) != str(year):
    raise SystemExit(f"{src} says year={season.get('year')}, expected {year}")

all_path = RAW / "egl_all.json"
data = json.loads(all_path.read_text(encoding="utf-8"))
data[str(year)] = season
all_path.write_text(json.dumps(data, indent=1), encoding="utf-8")
(RAW / f"{year}.json").write_text(json.dumps(season, indent=1), encoding="utf-8")

played = sum(1 for rows in (season.get("schedules") or {}).values()
             for r in rows if len(r) > 2 and r[2] in ("Win", "Loss", "Tie")) // 2
print(f"Merged {year}: {len(season.get('teams') or [])} teams, "
      f"{len(season.get('draft') or [])} draft rounds, {played} completed games")
print("Now run: .venv\\Scripts\\python scripts\\build_data.py")
