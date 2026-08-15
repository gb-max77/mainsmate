#!/usr/bin/env python3
"""Build data/factnstat.json from the modular sources in factbank/.

Each paper is a directory of section files, merged in filename order:

    factbank/<pid>/NN-slug.json
      { "h": "Section heading", "k": "case",
        "groups": [ { "g": "Group heading",
                      "items": [ {"t": term, "d": detail, "s": source, "k": kind?} ] } ] }

`k` on the section is the default kind for its items; an item may override it.
Papers with no authored sections yet fall back to the legacy string bank so the
site keeps working while the rebuild lands paper by paper.
"""
import json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'factbank'
OUT = ROOT / 'data' / 'factnstat.json'
LEGACY = ROOT / 'data' / 'factnstat.legacy.json'

PAPERS = [
    ('universal', 'Cross-cutting'),
    ('gs1', 'GS-1'),
    ('gs2', 'GS-2'),
    ('gs3', 'GS-3'),
    ('gs4', 'GS-4'),
    ('pubad1', 'PubAd I'),
    ('pubad2', 'PubAd II'),
]

KINDS = {'data', 'index', 'prov', 'case', 'law', 'sch', 'cmte', 'eg', 'quote', 'term'}


def load_paper(pid):
    files = sorted((SRC / pid).glob('*.json'))
    sections = []
    for f in files:
        s = json.loads(f.read_text())
        dk = s.get('k', 'data')
        if dk not in KINDS:
            sys.exit(f'{f}: unknown section kind {dk!r}')
        groups = []
        for g in s['groups']:
            items = []
            for it in g['items']:
                k = it.get('k', dk)
                if k not in KINDS:
                    sys.exit(f'{f}: unknown item kind {k!r} on {it.get("t")!r}')
                o = {'t': it['t'].strip(), 'd': it['d'].strip(), 'k': k}
                if it.get('s'):
                    o['s'] = it['s'].strip()
                items.append(o)
            if items:
                groups.append({'g': g['g'], 'items': items})
        if groups:
            sections.append({'h': s['h'], 'groups': groups})
    return sections


def legacy_paper(pid, legacy):
    """Wrap legacy plain strings as untyped items so nothing disappears mid-rebuild."""
    d = legacy.get(pid)
    if not d:
        return []
    return [{'h': s['h'], 'groups': [
        {'g': g['g'], 'items': [{'t': '', 'd': t, 'k': 'data'} for t in g['items']]}
        for g in s['groups'] if g['items']]} for s in d['sections']]


def main():
    legacy = json.loads(LEGACY.read_text()) if LEGACY.exists() else {}
    out, report = {}, []
    for pid, label in PAPERS:
        secs = load_paper(pid)
        src = 'authored'
        if not secs:
            secs = legacy_paper(pid, legacy)
            src = 'LEGACY'
        n = sum(len(g['items']) for s in secs for g in s['groups'])
        if not secs:
            continue
        out[pid] = {'label': label, 'sections': secs}
        report.append(f'{label:14} {n:5} entries  {len(secs)} sections  [{src}]')
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    total = sum(len(g['items']) for p in out.values() for s in p['sections'] for g in s['groups'])
    print('\n'.join(report))
    print(f'{"TOTAL":14} {total:5} entries → {OUT.relative_to(ROOT)} '
          f'({OUT.stat().st_size / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
