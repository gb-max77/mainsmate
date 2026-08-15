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
        # Height only. The dead space is the blank band and the page number below
        # the drawing; the side margins are near-symmetric, and sips can only crop
        # about the centre — trimming width too shifts the frame and clips captions.
        nh = bot - top + 1
        if nh > h * 0.94:
            print(f'{f.name:18} ok      {w}x{h} (already tight)'); continue
        # Keep the crop centred on the ink so the centred cut lands where we want.
        dy = (top + bot) // 2 - h // 2
        keep = h - 2 * abs(dy)                      # after re-centring
        target = min(nh, keep)
        print(f'{f.name:18} {w}x{h} → {w}x{target}  (-{100 - target * 100 // h}% height)')
        saved += (h - target) * w
        if apply:
            if abs(dy) >= 1:
                subprocess.run(['sips', '-c', str(keep), str(w), str(f)],
                               check=True, capture_output=True)
            subprocess.run(['sips', '-c', str(target), str(w), str(f)],
                           check=True, capture_output=True)
    print(f'\n{"applied" if apply else "would save"} ~{saved // 1000}k pixel-rows of dead space')


if __name__ == '__main__':
    main()
