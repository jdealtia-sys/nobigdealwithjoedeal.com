#!/usr/bin/env python3
"""Local dev server with gzip — for honest Lighthouse runs.

python3 -m http.server serves uncompressed, which inflates Lighthouse's
simulated network costs ~4.5x on our inline-styled pages (the homepage
document is 135KiB raw but ~30KiB gzipped, matching production Firebase
Hosting). Perf audits against the plain server report phantom
"opportunities" (unminified/unused CSS) whose real transfer cost is
~1-2KiB. Audit against THIS server for production-indicative numbers:

    python3 scripts/dev-server-gzip.py   # serves docs/ on :8189
"""
import gzip, http.server, io, os

class GzipHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        pass  # headers written manually in send_head path

    def do_GET(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            path = os.path.join(path, 'index.html')
        if not os.path.exists(path):
            self.send_response(404); super().end_headers(); return
        ctype = self.guess_type(path)
        raw = open(path, 'rb').read()
        compressible = any(t in ctype for t in ('text', 'javascript', 'json', 'svg', 'xml', 'css', 'html'))
        accept = 'gzip' in self.headers.get('Accept-Encoding', '')
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        if compressible and accept:
            body = gzip.compress(raw, 6)
            self.send_header('Content-Encoding', 'gzip')
        else:
            body = raw
        self.send_header('Content-Length', str(len(body)))
        super().end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass

os.chdir('/home/user/nobigdealwithjoedeal.com/docs')
http.server.ThreadingHTTPServer(('127.0.0.1', 8189), GzipHandler).serve_forever()
