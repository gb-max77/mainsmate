#!/usr/bin/env python3
"""Stamp one build number across sw.js and index.html, then report what to push.

GitHub Pages serves every asset with `max-age=600`, so for ten minutes after a
deploy a returning browser will answer from its own HTTP cache — the service
worker cannot help, because it is fetched from that same cache. The fix is to
make each release request genuinely new URLs: one number, stamped on the cache
name and on every versioned asset link, bumped here so the two cannot drift.
"""
import re, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SW, HTML = ROOT / 'sw.js', ROOT / 'index.html'


def main():
    sw = SW.read_text()
    cur = int(re.search(r"mainsmate-v(\d+)", sw).group(1))
    new = int(sys.argv[1]) if len(sys.argv) > 1 else cur + 1

    SW.write_text(re.sub(r"mainsmate-v\d+", f"mainsmate-v{new}", sw))

    html = HTML.read_text()
    html = re.sub(r'(href="app\.css)(\?v=\d+)?"', rf'\1?v={new}"', html)
    html = re.sub(r'(src="js/app\.js)(\?v=\d+)?"', rf'\1?v={new}"', html)
    HTML.write_text(html)

    print(f'v{cur} → v{new}   (sw.js cache, app.css, js/app.js)')
    print('next: rebuild the banks, commit, push, then poll sw.js for the new version')


if __name__ == '__main__':
    main()
