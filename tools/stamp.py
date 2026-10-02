# -*- coding: utf-8 -*-
"""Stamp the page with a build time, so a cached copy can be spotted.

Run it after changing anything in css/ or js/:

    python tools/stamp.py

It writes the build time into js/version.js and version.json (beside the page: the
page reads nothing from the data folder), and puts
?v=<build> on every css and js link in the page. The page then loads fresh files
whenever the build changes, and says so if it is running from a cached copy -
which is what happens when the folder is served by plain "python -m http.server",
since that sends no caching headers at all. serve.py does.
"""
import io
import json
import os
import re
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PAGE = os.path.join(ROOT, 'cluster_usage_user_node_time.html')
BUILD = time.strftime('%Y-%m-%d %H:%M')

io.open(os.path.join(ROOT, 'js', 'version.js'), 'w', encoding='utf-8', newline='').write(
    '/* Which build of the page this is. tools/stamp.py writes it, and main.js checks\n'
    '   it against version.json - if they differ the browser is showing a cached\n'
    '   copy and the page says so. */\n\n'
    "const BUILD = '%s';\n" % BUILD)
io.open(os.path.join(ROOT, 'version.json'), 'w', encoding='utf-8', newline='').write(
    json.dumps({'build': BUILD}) + '\n')

page = io.open(PAGE, encoding='utf-8', newline='').read()
if 'js/version.js' not in page:
    page = page.replace('<script src="js/data.js"',
                        '<script src="js/version.js"></script>\n<script src="js/data.js"', 1)
page = re.sub(r'((?:href|src)="(?:css|js)/[A-Za-z0-9_.-]+)(\?v=[^"]*)?"',
              lambda m: '%s?v=%s"' % (m.group(1), BUILD.replace(' ', '_')), page)
io.open(PAGE, 'w', encoding='utf-8', newline='').write(page)

stamped = len(re.findall(r'\?v=', page))
print('build %s stamped on %d files' % (BUILD, stamped))
