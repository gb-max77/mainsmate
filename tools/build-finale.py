#!/usr/bin/env python3
"""Build data/finale.json from finale/<paper>/NN-unit.json.

One block = one examiner-ready idea in a fixed five-part frame:
    t  term            x  the concept, in a sentence
    th thinker/source  in Indian application
    gl global instance w  the line to actually write
    pyq 0-3 how often the theme is asked   y26 1 = likely to matter in 2026
    link  cross-paper interlink, e.g. "II-8"
Total across x/in/gl/w is meant to sit at 50-70 words.
"""
import json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'finale'
OUT = ROOT / 'data' / 'finale.json'
PAPERS = [('pubad1', 'Paper I — Administrative Theory'),
          ('pubad2', 'Paper II — Indian Administration')]
FIELDS = ('t', 'x', 'th', 'in', 'gl', 'w')


def main():
    out, report, total = {}, [], 0
    for pid, label in PAPERS:
        units = []
        for f in sorted((SRC / pid).glob('*.json')):
            u = json.loads(f.read_text())
            blocks = []
            for b in u['blocks']:
                if not b.get('t') or not b.get('x'):
                    sys.exit(f'{f}: block missing t/x: {b.get("t")!r}')
                o = {k: b[k].strip() for k in FIELDS if b.get(k)}
                o['pyq'] = int(b.get('pyq', 0))
                if b.get('y26'):
                    o['y26'] = 1
                if b.get('link'):
                    o['link'] = b['link']
                words = sum(len(str(b.get(k, '')).split()) for k in ('x', 'in', 'gl', 'w'))
                o['n'] = words
                blocks.append(o)
            if blocks:
                units.append({'u': u['u'], 'blocks': blocks})
        n = sum(len(u['blocks']) for u in units)
        total += n
        out[pid] = {'label': label, 'units': units}
        long = sum(1 for u in units for b in u['blocks'] if b['n'] > 78)
        report.append(f'{label:38} {n:4} blocks  {len(units):2} units'
                      + (f'  ({long} over 78 words)' if long else ''))
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    print('\n'.join(report))
    print(f'{"TOTAL":38} {total:4} blocks → {OUT.relative_to(ROOT)} ({OUT.stat().st_size/1024:.0f} KB)')


if __name__ == '__main__':
    main()
