#!/usr/bin/env python3
"""Dev server for arcade-js.

Live input reaches the emulation worker through a SharedArrayBuffer, which
requires the page to be cross-origin isolated — so every response carries the
COOP/COEP/CORP headers that a plain `python -m http.server` does not. Serves the
repo ROOT so /core, /boards, /games and /web are all reachable.

    python3 web/server.py            # defaults to :8917
    python3 web/server.py 8080

Then open the printed URL (the game selector).
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".bin": "application/octet-stream",
        ".html": "text/html",
        ".json": "application/json",
    }

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):  # quieter
        sys.stderr.write("  " + (fmt % args) + "\n")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8917
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo root
    httpd = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=root))
    print(f"serving {root}")
    print(f"open  http://localhost:{port}/web/index.html")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
