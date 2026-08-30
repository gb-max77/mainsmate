#!/usr/bin/env python3
"""Render the Joint book as a numbered keyword chain, for print.

The blocks were authored with their load-bearing terms already in bold, so the
chain is not a summary — it is the same argument with the connective tissue
stripped to whatever carries the logic. A short link between two keywords
("versus", "not", "so", "yet") is kept because it IS the thinking; anything
longer collapses to a separator.

    python3 tools/keychain.py [joint|p1|p2]   → build/keychain-<book>.html
"""
import json, pathlib, re, html, sys
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / 'data' / 'maximus.json'
BUILD = ROOT / 'build'

# Links worth keeping between two keywords: they carry the direction of the argument.
LINK = re.compile(r'^(?:'
    r'versus|not|but|yet|so|because|hence|therefore|unless|while|against|into|through|'
    r'before|after|without|beyond|over|under|then|and|or|from|to|for|with|as|is|are|was|'
    r'means|gives|needs|becomes|produces|requires|rests on|turns on|explains|replaced by|'
    r'answered by|corrected by|→|—'
    r')$', re.I)
SPAN = re.compile(r'\*\*(.+?)\*\*')
ENUM = re.compile(r'^\(\d+\)$')          # a bare list marker, e.g. **(3)**
QUOTED = re.compile(r'["“]([^"”]{12,})["”]')
GLOSS = re.compile(r'^\s*\(([^)]{1,34})\)')      # **Kosha** (treasury) — the gloss belongs to the term


def chain(d, kind=''):
    """Bold spans in order, with any short logical link between them preserved.

    Two spans are not keywords on their own and are folded into what follows:
    a bare enumerator like **(3)**, whose item may not itself be bold, and a
    quotation, where the sentence IS the content and losing it empties the line.
    """
    out, last, pending = [], 0, None
    spans = list(SPAN.finditer(d))
    for n, m in enumerate(spans):
        gap_raw = d[last:m.start()]
        # A short parenthetical straight after a term glosses it; keep them together.
        gl = GLOSS.match(gap_raw)
        if gl and out and out[-1][0] == 'key':
            out[-1] = ('key', f'{out[-1][1]} ({gl.group(1)})')
            gap_raw = gap_raw[gl.end():]
        gap = re.sub(r"[^\w'’\-→—]+", ' ', gap_raw).strip()
        term = m.group(1)
        if pending is not None:                    # carry the enumerator onto its item
            item = gap.strip(' ,;.-')
            if ENUM.match(term):                   # the item was wholly plain
                out.append(('key', f'{pending} {item}'.strip()))
                pending = term
            else:                                  # the item runs plain then bold
                out.append(('key', ' '.join(x for x in (pending, item, term) if x)))
                pending = None
            last = m.end(); continue
        if ENUM.match(term):
            if out: out.append(('sep', None))
            pending = term; last = m.end(); continue
        if out:
            words = gap.split()
            if 1 <= len(words) <= 2 and LINK.match(' '.join(words)):
                out.append(('link', ' '.join(words)))
            else:
                out.append(('sep', None))
        out.append(('key', term))
        last = m.end()
    if pending is not None:
        tail = re.sub(r"[^\w'’\-→—]+", ' ', d[last:]).strip().strip(' ,;.')
        out.append(('key', f'{pending} {tail}'.strip()))
    # A quotation carries its own weight; keep it whole where the chain lost it.
    if kind == 'quote':
        plain = re.sub(r'\*\*', '', d)
        for q in QUOTED.findall(plain):
            if q[:28] not in ' '.join(t for k, t in out if k == 'key'):
                out += [('sep', None), ('quote', q)]
    return out


def md(t):
    """The block as written, for the lines a chain would gut."""
    t = html.escape(t)
    t = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', t)
    return re.sub(r'(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)', r'\1<em>\2</em>', t)


def render(parts):
    bits = []
    for kind, text in parts:
        if kind == 'key':
            bits.append('<b>' + re.sub(r'\*(.+?)\*', r'</b><em>\1</em><b>',
                                       html.escape(text)) + '</b>')
        elif kind == 'link':
            bits.append(f'<i>{html.escape(text)}</i>')
        elif kind == 'quote':
            bits.append(f'<q>{html.escape(text)}</q>')
        else:
            bits.append('<s>·</s>')
    return ' '.join(bits)


# Below this, the chain has thrown away the argument rather than compressed it —
# those blocks carry their sense in the prose, so they print as written.
def line(b):
    parts = chain(b['d'], b['k'])
    keys = [t for k, t in parts if k in ('key', 'quote')]
    plain = re.sub(r'\*\*', '', b['d'])
    dense = len(' '.join(keys)) / max(1, len(plain))
    if len(keys) < 4 or dense < 0.32:
        return md(b['d']), True
    return render(parts), False


TITLES = {
    'joint': ('Maximus Weberus', 'Public Administration optional · the keyword chain'),
    'p1':    ('Maximus Weberus · Paper I', 'Administrative Theory · the keyword chain'),
    'p2':    ('Maximus Weberus · Paper II', 'Indian Administration · the keyword chain'),
}
# The five things a Paper-I answer has to carry, and which kinds supply each.
FACETS = [('Concept', ('concept',)), ('Thinker', ('thinker', 'quote')),
          ('Critique', ('critique',)), ('Example', ('eg', 'data', 'case')),
          ('Anchor', ('prov', 'cmte', 'inst', 'sch')), ('Linkage', ('link',))]


def main():
    book_id = sys.argv[1] if len(sys.argv) > 1 else 'joint'
    d = json.loads(DATA.read_text())
    joint = next((b for b in d['books'] if b['id'] == book_id), None)
    if joint is None:
        sys.exit(f'no such book: {book_id} (try joint, p1, p2)')
    OUT = BUILD / f'keychain-{book_id}.html'
    title, sub = TITLES.get(book_id, (joint['label'], joint['sub']))
    kinds = d['kinds']

    toc, body, nblocks, nwhole = [], [], 0, 0
    for si, unit in enumerate(joint['units'], 1):
        toc.append(f'<li><b>{si}</b> {html.escape(unit["name"])}'
                   f'<span>{unit["tag"]} · {unit["n"]}</span></li>')
        body.append(f'<section class="sec"><h2><span class="n">{si}</span>'
                    f'{html.escape(unit["name"])}<em>{html.escape(unit["tag"])}</em></h2>')
        if unit.get('blurb'):
            body.append(f'<p class="blurb">{html.escape(unit["blurb"])}</p>')
        # What this unit is made of, so a thin facet is visible before you read it.
        mix = Counter(d['b'][i]['k'] for g in unit['groups'] for i in g['i'])
        chips = ''.join(
            f'<span class="fc" data-f="{lab.lower()}">{lab}<b>{sum(mix[k] for k in ks)}</b></span>'
            for lab, ks in FACETS if sum(mix[k] for k in ks))
        t0 = sum(1 for g in unit['groups'] for i in g['i'] if d['b'][i]['tr'] == 0)
        body.append(f'<p class="mix">{chips}<span class="fc t0">T0<b>{t0}</b></span></p>')
        for gi, g in enumerate(unit['groups'], 1):
            body.append(f'<h3><span class="n">{si}.{gi}</span>{html.escape(g["g"])}</h3><ol class="chain">')
            for bi, idx in enumerate(g['i'], 1):
                b = d['b'][idx]
                nblocks += 1
                tier = ' t0' if b['tr'] == 0 else ''
                text, whole = line(b)
                if whole: nwhole += 1
                body.append(
                    f'<li class="blk{tier}"><span class="num">{si}.{gi}.{bi}</span>'
                    f'<span class="term">{html.escape(b["t"])}</span>'
                    f'<span class="kw{" full" if whole else ""}">{text}</span>'
                    f'<span class="tag" data-k="{b["k"]}">{html.escape(kinds[b["k"]]["label"])}'
                    f'{" · T0" if b["tr"] == 0 else ""}</span></li>')
            body.append('</ol>')
        body.append('</section>')

    n_t0 = sum(1 for u in joint['units'] for g in u['groups']
               for i in g['i'] if d['b'][i]['tr'] == 0)
    tpl = (ROOT / 'tools' / 'keychain.css').read_text()
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>{title}</title><style>{tpl}</style></head><body>
<header class="cover">
  <h1>{title}</h1>
  <p class="sub">{sub}</p>
  <p class="meta">{nblocks} blocks · {len(joint["units"])} sections · {n_t0} marked <b>T0</b>,
     the core to own if there is time for nothing else · CSE 2026</p>
  <p class="how"><b>How to read it.</b> Each line is one examiner-ready idea reduced to the terms
     that carry it. <b>Bold</b> is a term to reproduce; <i>italic</i> is the link that carries the
     logic between two terms; <s>·</s> is a break in the argument. Numbering is
     <b>section.group.block</b>, so <b>4.2.7</b> is the seventh idea of the second group of section
     four. A <b>T0</b> line is in the last-48-hours set.</p>
  <ol class="toc">{"".join(toc)}</ol>
</header>
{"".join(body)}
</body></html>''')
    print(f'{book_id}: {nblocks} blocks · {len(joint["units"])} sections → {OUT.relative_to(ROOT)}'
          f' ({OUT.stat().st_size // 1024} KB)')
    print(f'{nblocks - nwhole} as keyword chains · {nwhole} printed whole '
          f'(the chain would have gutted them)')


if __name__ == '__main__':
    main()
