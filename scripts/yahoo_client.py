"""Shared Yahoo Fantasy API client: credential loading, token storage/refresh, GET helper.

All other scripts import this. Tokens live in auth/tokens.json (gitignored).
"""

import json
import os
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
TOKEN_FILE = ROOT / "auth" / "tokens.json"

REDIRECT_URI = "https://localhost:8080"
AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth"
TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token"
API_BASE = "https://fantasysports.yahooapis.com/fantasy/v2"

load_dotenv(ROOT / ".env")


def creds():
    cid = os.getenv("YAHOO_CLIENT_ID", "")
    sec = os.getenv("YAHOO_CLIENT_SECRET", "")
    if not cid or not sec or cid.startswith("paste-"):
        raise SystemExit(
            "Missing Yahoo credentials. Edit .env in the project root and fill in "
            "YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET from https://developer.yahoo.com/apps/"
        )
    return cid, sec


def save_tokens(tok: dict) -> None:
    TOKEN_FILE.parent.mkdir(exist_ok=True)
    tok["obtained_at"] = int(time.time())
    TOKEN_FILE.write_text(json.dumps(tok, indent=2))


def load_tokens() -> dict:
    if not TOKEN_FILE.exists():
        raise SystemExit("Not authorized yet — run: python scripts/authorize.py")
    return json.loads(TOKEN_FILE.read_text())


def exchange_code(code: str) -> None:
    """Trade the one-time authorization code for access + refresh tokens."""
    cid, sec = creds()
    r = requests.post(TOKEN_URL, auth=(cid, sec), data={
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
    })
    r.raise_for_status()
    save_tokens(r.json())


def refresh() -> dict:
    cid, sec = creds()
    tok = load_tokens()
    r = requests.post(TOKEN_URL, auth=(cid, sec), data={
        "grant_type": "refresh_token",
        "refresh_token": tok["refresh_token"],
        "redirect_uri": REDIRECT_URI,
    })
    r.raise_for_status()
    new = r.json()
    new.setdefault("refresh_token", tok["refresh_token"])
    save_tokens(new)
    return new


def access_token() -> str:
    tok = load_tokens()
    age = time.time() - tok.get("obtained_at", 0)
    if age > tok.get("expires_in", 3600) - 120:
        tok = refresh()
    return tok["access_token"]


def get(path: str, params: dict | None = None) -> dict:
    """GET an API path relative to /fantasy/v2, return parsed JSON.

    Handles expired tokens (401 -> refresh) and Yahoo rate limiting
    (status 999 / 5xx -> backoff) with up to 4 attempts.
    """
    params = dict(params or {})
    params["format"] = "json"
    r = None
    for attempt in range(4):
        r = requests.get(
            f"{API_BASE}/{path}",
            params=params,
            headers={"Authorization": f"Bearer {access_token()}"},
            timeout=30,
        )
        if r.status_code == 401:
            refresh()
            continue
        if r.status_code == 999 or r.status_code >= 500:
            time.sleep(2 * (attempt + 1))
            continue
        r.raise_for_status()
        return r.json()
    r.raise_for_status()
    return {}


# ---- helpers for Yahoo's numbered-dict JSON shape ----------------------------

def numbered(d):
    """Yield values of Yahoo's {'0': ..., '1': ..., 'count': n} collections in order."""
    if not isinstance(d, dict):
        return
    for k in sorted(d, key=lambda x: int(x) if x.isdigit() else 1 << 30):
        if k.isdigit():
            yield d[k]


def merge(obj):
    """Yahoo represents one object as a list of single-key dicts; merge into one dict.

    Passes plain dicts through unchanged so callers don't need to care which
    shape Yahoo used.
    """
    if isinstance(obj, dict):
        return obj
    out = {}
    for item in obj or []:
        if isinstance(item, dict):
            out.update(item)
    return out
