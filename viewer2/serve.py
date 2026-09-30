"""Serve the broadcast viewer, and accept frame captures from it (POST /capture?name=...).

Captures land in runs/viewer/captures/<name>.png, for reviewing the broadcast at full resolution.
Run: python3 viewer2/serve.py [port]
"""
import http.server, os, sys, urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(ROOT), 'runs', 'viewer', 'captures')
os.makedirs(OUT, exist_ok=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != '/capture':
            self.send_error(404); return
        name = urllib.parse.parse_qs(u.query).get('name', ['frame'])[0]
        name = ''.join(c for c in name if c.isalnum() or c in '-_.')[:120] or 'frame'
        n = int(self.headers.get('Content-Length', 0))
        with open(os.path.join(OUT, name + '.png'), 'wb') as f:
            f.write(self.rfile.read(n))
        self.send_response(200); self.end_headers(); self.wfile.write(b'ok')

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8095
    http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
