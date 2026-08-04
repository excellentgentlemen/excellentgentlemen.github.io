# Fantasy League History Site

Turns a Yahoo fantasy football league's full history into a static website:
season archives, all-time standings, head-to-head records, record book, and more.

## How it works

1. **Fetch** — Python scripts pull every season of league data from the Yahoo
   Fantasy Sports API and store raw JSON under `data/raw/` (local only).
2. **Build** — a build script normalizes the raw data into compact JSON under
   `docs/data/`.
3. **Site** — `docs/` is a static website (served by GitHub Pages) that renders
   that data. No backend needed.

## One-time setup

1. Create a Yahoo developer app at <https://developer.yahoo.com/apps/>:
   - Redirect URI: exactly `https://localhost:8080`
   - Permissions: **Fantasy Sports — Read**
   - Pick the app type that issues both a Client ID and a Client Secret
     ("Installed Application" / "Confidential Client").
2. Copy `.env.template` to `.env` and fill in the Client ID and Secret.
3. Authorize (opens Yahoo, click Agree, paste the redirect URL back):

   ```
   .venv\Scripts\python scripts\authorize.py
   ```

## Refreshing data (during the season)

```
.venv\Scripts\python scripts\fetch_league.py
.venv\Scripts\python scripts\build_data.py
git add docs/data && git commit -m "Week update" && git push
```

GitHub Pages redeploys automatically on push.
