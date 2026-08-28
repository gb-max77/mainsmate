#!/usr/bin/env python3
"""Build data/maximus.json from maximus/NN-pod.json.

MAXIMUS WEBERUS — the final revision pod for the Public Administration optional.

One block = one examiner-ready idea, written to be reproduced as it stands.
Length follows the point, as in FactnStat: a bare provision closes in twenty
words, a concept with its Indian application needs sixty. Nothing is padded to
a floor and nothing is cut to a ceiling that the argument does not respect.

Every block carries:
    k   WHAT IT IS   concept thinker critique cmte prov scheme data case eg quote link
    sl  WHERE IT GOES  open argue prove attack close
    tr  1/2/3 — the 2026 prediction
    u   the UPSC syllabus unit (I-1 … II-14, or Cross)

The source files are authored by THEME — each pairs a Paper-I unit with its
Paper-II twin. This script re-cuts the same blocks three ways, with no
duplication in the source:

    Paper I   strict syllabus, units I-1 … I-12
    Paper II  strict syllabus, units II-1 … II-14
    Joint     the thematic pods — theory beside the Indian application it explains
"""
import json, pathlib, re, sys
from collections import Counter, defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'maximus'
OUT = ROOT / 'data' / 'maximus.json'

KINDS = {
    'concept':  ('Concept',   'The theory itself — definition, model, typology'),
    'thinker':  ('Thinker',   'A named scholar doing work in the sentence'),
    'critique': ('Critique',  'The limitation, the counter-argument, the dysfunction'),
    'cmte':     ('Committee',  'A named commission or report, and what it recommended'),
    'prov':     ('Provision',  'An Article, section, schedule, rule or Act'),
    'inst':     ('Institution','A standing body, office or machinery — who does this'),
    'sch':      ('Scheme',     'A programme, policy or instrument in operation'),
    'data':     ('Data',      'A dated figure you can quote'),
    'case':     ('Case law',  'A judgment with its year and its holding'),
    'eg':       ('Example',   'A real Indian instance, named'),
    'quote':    ('Quote',     'A line worth reproducing in quotation marks'),
    'link':     ('Linkage',   'Paper I theory carried into Paper II, or the reverse'),
}
SLOTS = {
    'open':   ('Open',   'Opens the answer — the anchor line'),
    'argue':  ('Argue',  'A body dimension — a claim that needs a heading'),
    'prove':  ('Prove',  'Evidence layer — the fact that settles the claim'),
    'attack': ('Attack', 'The critical turn — where you weigh and qualify'),
    'close':  ('Close',  'The conclusion — verdict plus a named fix'),
}
UNITS = {
    'I-1': 'Introduction', 'I-2': 'Administrative Thought', 'I-3': 'Administrative Behaviour',
    'I-4': 'Organisations', 'I-5': 'Accountability and Control', 'I-6': 'Administrative Law',
    'I-7': 'Comparative Public Administration', 'I-8': 'Development Dynamics',
    'I-9': 'Personnel Administration', 'I-10': 'Public Policy',
    'I-11': 'Techniques of Administrative Improvement', 'I-12': 'Financial Administration',
    'II-1': 'Evolution of Indian Administration', 'II-2': 'Philosophical and Constitutional Framework',
    'II-3': 'Public Sector Undertakings', 'II-4': 'Union Government and Administration',
    'II-5': 'Plans and Priorities', 'II-6': 'State Government and Administration',
    'II-7': 'District Administration since Independence', 'II-8': 'Civil Services',
    'II-9': 'Financial Management', 'II-10': 'Administrative Reforms since Independence',
    'II-11': 'Rural Development', 'II-12': 'Urban Local Government',
    'II-13': 'Law and Order Administration', 'II-14': 'Significant Issues in Indian Administration',
    'Cross': 'Cross-cutting',
}
P1 = [f'I-{i}' for i in range(1, 13)]
P2 = [f'II-{i}' for i in range(1, 15)]

WORD = re.compile(r"[A-Za-z0-9₹%().,;:'’–—/&+-]+")
wc = lambda t: len(WORD.findall(t.replace('**', '')))
norm = lambda t: re.sub(r'[^a-z0-9]+', ' ', t.lower()).strip()


def main():
    pods, pool, seen, dupes, long_ = [], [], {}, [], []
    kc, sc, tc, uc = Counter(), Counter(), Counter(), Counter()
    by_unit = defaultdict(lambda: defaultdict(list))     # unit -> group name -> blocks
    total = 0

    for f in sorted(SRC.glob('*.json')):
        p = json.loads(f.read_text())
        groups, n = [], 0
        for g in p['groups']:
            blocks = []
            for b in g['items']:
                for req in ('t', 'd', 'k', 'sl', 'tr', 'u'):
                    if b.get(req) is None or b.get(req) == '':
                        sys.exit(f'{f.name}: block {b.get("t")!r} missing {req}')
                if b['k'] not in KINDS: sys.exit(f'{f.name}: {b["t"]!r} bad kind {b["k"]!r}')
                if b['sl'] not in SLOTS: sys.exit(f'{f.name}: {b["t"]!r} bad slot {b["sl"]!r}')
                if b['u'] not in UNITS: sys.exit(f'{f.name}: {b["t"]!r} bad unit {b["u"]!r}')
                w = wc(b['d'])
                if w > 120: sys.exit(f'{f.name}: {b["t"]!r} runs to {w} words — split it')
                if w > 80: long_.append(f'{f.name} · {b["t"]} · {w}w')
                key = norm(b['d'])[:120]
                if key in seen: dupes.append(f'{f.name} · {b["t"]!r} ≡ {seen[key]}')
                seen[key] = f'{f.name} · {b["t"]}'
                o = {'t': b['t'].strip(), 'd': b['d'].strip(), 'k': b['k'],
                     'sl': b['sl'], 'tr': int(b['tr']), 'u': b['u'], 'n': w}
                if b.get('s'): o['s'] = b['s'].strip()
                if b.get('x'): o['x'] = b['x'].strip()
                kc[b['k']] += 1; sc[b['sl']] += 1; tc[int(b['tr'])] += 1; uc[b['u']] += 1
                idx = len(pool); pool.append(o)
                blocks.append(idx); n += 1
                by_unit[b['u']][g['g']].append(idx)
            groups.append({'g': g['g'], 'i': blocks})
        pods.append({'u': p['id'], 'name': p['pod'], 'tag': ' · '.join(p['units']), 'sel': p['pod'],
                     'blurb': p.get('blurb', ''), 'groups': groups, 'n': n})
        total += n

    def book(unit_ids):
        units = []
        for u in unit_ids:
            if u not in by_unit: continue
            gs = [{'g': g, 'i': items} for g, items in by_unit[u].items()]
            units.append({'u': u, 'name': UNITS[u], 'tag': u, 'sel': f'{u} — {UNITS[u]}',
                          'groups': gs, 'n': sum(len(x['i']) for x in gs)})
        return units

    books = [
        {'id': 'p1', 'label': 'Paper I', 'sub': 'Administrative Theory', 'units': book(P1)},
        {'id': 'p2', 'label': 'Paper II', 'sub': 'Indian Administration', 'units': book(P2)},
        {'id': 'joint', 'label': 'Joint', 'sub': 'Theory beside its application', 'units': pods},
    ]
    for bk in books:
        bk['n'] = sum(u['n'] for u in bk['units'])

    OUT.write_text(json.dumps({
        'b': pool,
        'books': books,
        'kinds': {k: {'label': v[0], 'hint': v[1]} for k, v in KINDS.items()},
        'slots': {k: {'label': v[0], 'hint': v[1]} for k, v in SLOTS.items()},
        'n': total,
    }, ensure_ascii=False, separators=(',', ':')))

    for bk in books:
        print(f'{bk["label"]:<9} {bk["n"]:>4} blocks in {len(bk["units"]):>2} sections')
    print(f'\nTOTAL {total} blocks   ·   {OUT.stat().st_size // 1024} KB')
    print('tiers  ' + '  '.join(f'T{t} {tc[t]}' for t in (0, 1, 2, 3)))
    print('kinds  ' + '  '.join(f'{k} {kc[k]}' for k in KINDS if kc[k]))
    print('slots  ' + '  '.join(f'{s} {sc[s]}' for s in SLOTS if sc[s]))
    missing = [u for u in P1 + P2 if u not in by_unit]
    print('units  ' + ('every syllabus unit covered' if not missing else f'MISSING {missing}'))
    if long_:
        print(f'\n{len(long_)} blocks over 80 words (allowed where the point needs it):')
        for s in long_[:10]: print('   ', s)
    if dupes:
        print(f'\n!! {len(dupes)} duplicates:')
        for s in dupes: print('   ', s)
        sys.exit(1)


if __name__ == '__main__':
    main()
