# Serve this folder and open the page.
#
# Same as "python -m http.server", with one difference: it tells the browser not
# to keep anything. Plain http.server sends no caching headers, so a browser will
# happily reuse a script it fetched earlier - after an edit you then get the new
# page with the old code, and things quietly stop working.
#
#   python serve.py [port] [--no-open]      default port 8000

import http.server
import os
import sys
import webbrowser

ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
PORT = int(ARGS[0]) if ARGS else 8000
OPEN = '--no-open' not in sys.argv
PAGE = 'cluster_usage_user_node_time.html'


class Fresh(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        http.server.SimpleHTTPRequestHandler.end_headers(self)

    def log_message(self, fmt, *args):          # one tidy line per request
        sys.stderr.write('%s %s\n' % (self.command, self.path))


os.chdir(os.path.dirname(os.path.abspath(__file__)))
url = 'http://localhost:%d/%s' % (PORT, PAGE)
print('serving %s' % os.getcwd())
print(url)
print('press Ctrl+C to stop')
if OPEN:
    try:
        webbrowser.open(url)
    except Exception:
        pass
try:
    # threaded, like python -m http.server: a browser keeps connections open, and a
    # server that answers one request at a time can stall the page's other requests
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Fresh).serve_forever()
except KeyboardInterrupt:
    print('stopped')
