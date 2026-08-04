"""Tiny localhost receiver for the browser scrape.

The league pages are read in the user's own Chrome session; this server just
catches each season's JSON (POST /save/<name>) and writes it under
data/raw/scraped/. Runs on 127.0.0.1 only.

Handles Chrome's CORS + Private Network Access preflights so an https page can
POST to localhost.
"""

import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "raw" / "scraped"
OUT.mkdir(parents=True, exist_ok=True)

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Private-Network": "true",
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    timeout = 20

    def _headers(self, code=200, length=0):
        self.send_response(code)
        for k, v in CORS.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(length))
        self.end_headers()

    def do_OPTIONS(self):
        self._headers(204)

    def do_GET(self):
        body = b"receiver alive"
        self._headers(200, len(body))
        self.wfile.write(body)

    def do_POST(self):
        m = re.match(r"^/save/([A-Za-z0-9_\-]{1,40})$", self.path)
        if not m:
            self._headers(404)
            return
        name = m.group(1)
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            json.loads(body)  # validate before writing
        except ValueError:
            self._headers(400)
            print(f"REJECTED {name}: not valid JSON ({len(body)} bytes)", flush=True)
            return
        path = OUT / f"{name}.json"
        path.write_bytes(body)
        self._headers(200)
        print(f"SAVED {path.name} ({len(body):,} bytes)", flush=True)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print(f"Receiver listening on http://127.0.0.1:8123 -> {OUT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8123), Handler).serve_forever()
