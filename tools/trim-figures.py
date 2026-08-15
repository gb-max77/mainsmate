#!/usr/bin/env python3
"""Trim the dead white margin (and the source page number) off the figure crops.

The figures were cropped out of the source sheets by page region, so most carry a
large blank band and the printed page number below the drawing. This finds the ink
bounding box with a pure-zlib PNG decode, then re-crops with `sips`, which only
crops from the centre — so we pad the box back to a centred one before cropping.

    python3 tools/trim-figures.py            # report only
    python3 tools/trim-figures.py --apply    # rewrite the files
"""
import pathlib, struct, subprocess, sys, zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIR = ROOT / 'data' / 'diagrams'
INK = 215          # below this on any channel counts as ink
PAD = 10           # keep a little air around the drawing


def decode(png: bytes):
    """Minimal PNG reader: returns (w, h, bytes-per-pixel, unfiltered rows)."""
    if png[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    pos, idat, w = 8, b'', None
    while pos < len(png):
        ln = struct.unpack('>I', png[pos:pos + 4])[0]
        typ = png[pos + 4:pos + 8]
        data = png[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, depth, colour = struct.unpack('>IIBB', data[:10])
            if depth != 8 or colour not in (0, 2, 4, 6):
                return None
            bpp = {0: 1, 2: 3, 4: 2, 6: 4}[colour]
        elif typ == b'IDAT':
            idat += data
        elif typ == b'IEND':
            break
        pos += 12 + ln
    if w is None:
        return None
    raw = zlib.decompress(idat)
    stride = w * bpp
    out, prev, p = [], bytearray(stride), 0
    for _ in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if f == 1:
            for i in range(bpp, stride): line[i] = (line[i] + line[i - bpp]) & 255
        elif f == 2:
            for i in range(stride): line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out.append(line); prev = line
    return w, h, bpp, out


def encode(w, h, bpp, rows):
    """Write a PNG back. sips can only crop about the centre, which cannot remove
    bottom-only whitespace without eating the top, so we re-encode ourselves."""
    colour = {1: 0, 2: 4, 3: 2, 4: 6}[bpp]
    raw = bytearray()
    for line in rows:
        raw.append(0)                      # filter: none
        raw += line
    def chunk(typ, data):
        return (struct.pack('>I', len(data)) + typ + data
                + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff))
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, colour, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
            + chunk(b'IEND', b''))


def ink_count(w, h, bpp, rows, y0=0, y1=None):
    """Inked pixels in a row band — compared before and after to prove nothing was cut."""
    n = 0
    for line in rows[y0:(h if y1 is None else y1 + 1)]:
        for x in range(w):
            i = x * bpp
            if line[i] < INK if bpp <= 2 else (line[i] < INK or line[i + 1] < INK or line[i + 2] < INK):
                n += 1
    return n


def ink_box(w, h, bpp, rows, drop_page_number=True):
    top, bot, left, right = None, None, w, 0
    row_has = []
    for y, line in enumerate(rows):
        lo, hi = None, None
        for x in range(w):
            i = x * bpp
            dark = line[i] < INK if bpp <= 2 else (line[i] < INK or line[i + 1] < INK or line[i + 2] < INK)
            if dark:
                if lo is None: lo = x
                hi = x
        row_has.append((lo, hi))
        if lo is not None:
            if top is None: top = y
            bot = y
            left, right = min(left, lo), max(right, hi)
    if top is None:
        return None
    # The printed page number sits alone at the foot, far below the drawing, and
    # is narrow. If the last ink band is separated by a clear gap, drop it.
    if drop_page_number:
        y = bot
        while y > top and row_has[y][0] is not None:
            y -= 1
        gap_end = y
        while y > top and row_has[y][0] is None:
            y -= 1
        gap = gap_end - y
        band_w = max((row_has[k][1] - row_has[k][0]) for k in range(gap_end + 1, bot + 1)
                     if row_has[k][0] is not None) if gap_end < bot else 0
        if gap > 25 and band_w < w * 0.12:
            bot = y
            left = min((row_has[k][0] for k in range(top, bot + 1) if row_has[k][0] is not None), default=left)
            right = max((row_has[k][1] for k in range(top, bot + 1) if row_has[k][1] is not None), default=right)
    return max(0, top - PAD), min(h - 1, bot + PAD), max(0, left - PAD), min(w - 1, right + PAD)


def main():
    apply = '--apply' in sys.argv
    saved = 0
    for f in sorted(DIR.glob('*.png')):
        got = decode(f.read_bytes())
        if not got:
            print(f'{f.name:18} SKIP (unsupported PNG)'); continue
        w, h, bpp, rows = got
        box = ink_box(w, h, bpp, rows)
        if not box:
            print(f'{f.name:18} SKIP (blank)'); continue
        top, bot, _, _ = box
        # Height only — the waste is the blank band and page number under the
        # drawing; side margins are near-symmetric and worth leaving alone.
        target = bot - top + 1
        if target > h * 0.94:
            print(f'{f.name:18} ok      {w}x{h} (already tight)'); continue
        print(f'{f.name:18} {w}x{h} → {w}x{target}  (-{100 - target * 100 // h}% height)')
        saved += (h - target) * w
        if apply:
            want = ink_count(w, h, bpp, rows, top, bot)
            f.write_bytes(encode(w, target, bpp, rows[top:bot + 1]))
            # Prove it: every inked pixel of the drawing survived the cut.
            aw, ah, abpp, arows = decode(f.read_bytes())
            kept = ink_count(aw, ah, abpp, arows)
            if kept != want:
                print(f'{"":18} !! INK CHANGED in {f.name}: {want} → {kept}')
    print(f'\n{"applied" if apply else "would save"} ~{saved // 1000}k pixel-rows of dead space')


if __name__ == '__main__':
    main()
