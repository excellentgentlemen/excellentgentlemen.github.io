"""List every NFL fantasy league on the signed-in Yahoo account, across all seasons.

Also dumps the raw API response to data/raw/discovery.json for debugging.
"""

import json

import yahoo_client as yc


def main() -> None:
    data = yc.get("users;use_login=1/games;game_codes=nfl/leagues")

    raw_dir = yc.ROOT / "data" / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    (raw_dir / "discovery.json").write_text(json.dumps(data, indent=2))

    user = yc.merge(next(yc.numbered(data["fantasy_content"]["users"]))["user"])
    rows = []
    for g in yc.numbered(user.get("games", {})):
        game = yc.merge(g.get("game"))
        for lg in yc.numbered(game.get("leagues", {})):
            league = yc.merge(lg.get("league"))
            rows.append((
                str(game.get("season", "?")),
                league.get("name", "?"),
                league.get("league_key", "?"),
                str(league.get("num_teams", "?")),
                league.get("renew", ""),      # previous season's league (chain link back)
                league.get("renewed", ""),    # next season's league (chain link forward)
            ))

    rows.sort()
    print(f"\n{'Season':<8}{'League':<36}{'League key':<18}{'Teams':<7}{'Renew':<16}Renewed")
    for season, name, key, teams, renew, renewed in rows:
        print(f"{season:<8}{name[:34]:<36}{key:<18}{teams:<7}{renew:<16}{renewed}")
    print(f"\n{len(rows)} league-seasons found. Raw response: data/raw/discovery.json")


if __name__ == "__main__":
    main()
