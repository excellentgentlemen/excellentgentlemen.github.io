"""One-time Yahoo OAuth authorization.

Usage:
    python scripts/authorize.py            # prints the auth URL, prompts for the code
    python scripts/authorize.py <url|code> # non-interactive: finish with a pasted redirect URL or code
"""

import sys
from urllib.parse import parse_qs, urlencode, urlparse

import yahoo_client as yc


def auth_url() -> str:
    cid, _ = yc.creds()
    return f"{yc.AUTH_URL}?" + urlencode({
        "client_id": cid,
        "redirect_uri": yc.REDIRECT_URI,
        "response_type": "code",
    })


def extract_code(pasted: str) -> str:
    pasted = pasted.strip().strip('"')
    if "code=" in pasted:
        return parse_qs(urlparse(pasted).query)["code"][0]
    return pasted


def main() -> None:
    if len(sys.argv) > 1:
        yc.exchange_code(extract_code(sys.argv[1]))
        print("Authorized. Tokens saved to auth/tokens.json")
        return

    print("\n1. Open this URL, sign in to Yahoo, and click 'Agree':\n")
    print(auth_url())
    print(
        "\n2. You'll land on a broken https://localhost:8080 page — that's expected.\n"
        "3. Copy the FULL address from the browser address bar and paste it here.\n"
    )
    yc.exchange_code(extract_code(input("Paste the address (or just the code): ")))
    print("\nAuthorized. Tokens saved to auth/tokens.json")


if __name__ == "__main__":
    main()
