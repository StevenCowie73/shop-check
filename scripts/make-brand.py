"""The ColdenJames mark, drawn from the font as outlines.

"ColdenJames" in IBM Plex Sans Bold, tracked -0.02em, kerned as the font
kerns it, every glyph converted to a path so it looks the same everywhere
whether or not the font is loaded. The C and the J are split across their
own middle: rust above (red hair), blue below (blue eyes). The split is
done by drawing the whole letter in blue and the same letter in rust
clipped to its top half, so there is no hairline gap where the halves meet.

Writes public/brand/wordmark.svg, public/brand/icon.svg and
site/brand-svg.js (the same drawings as strings, for inlining).

Run:  pip install fonttools uharfbuzz
      python3 scripts/make-brand.py path/to/IBMPlexSans-Bold.ttf
The font is IBM's, from github.com/IBM/plex (SIL Open Font License); it is
not committed. The PNG favicons are made from the SVGs by
scripts/make-brand-png.js.
"""

import json
import os
import sys

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

WORD = 'ColdenJames'
INK = '#1C1917'
RUST = '#C4501B'
BLUE = '#3F7FC0'
CREAM = '#F4EFE6'
TRACKING = -0.02          # em
SPLIT = {0, 6}            # the C and the J

ROOT = os.path.join(os.path.dirname(__file__), '..')


def fmt(n):
    s = f'{n:.1f}'
    return s[:-2] if s.endswith('.0') else s


def main(font_path):
    font = TTFont(font_path)
    glyphs = font.getGlyphSet()
    upm = font['head'].unitsPerEm
    order = font.getGlyphOrder()

    blob = hb.Blob.from_file_path(font_path)
    hbfont = hb.Font(hb.Face(blob))
    buf = hb.Buffer()
    buf.add_str(WORD)
    buf.guess_segment_properties()
    hb.shape(hbfont, buf, {'kern': True, 'liga': False})

    # Lay the glyphs out: x advances in font units, tracking between letters.
    placed = []
    x = 0
    for i, (info, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
        name = order[info.codepoint]
        placed.append((name, x + pos.x_offset, pos.y_offset, info.cluster))
        x += pos.x_advance + (TRACKING * upm if i < len(buf.glyph_infos) - 1 else 0)

    # Ink bounds of the whole word, in font units (y up).
    def bounds(name, dx, dy):
        bp = BoundsPen(glyphs)
        glyphs[name].draw(TransformPen(bp, (1, 0, 0, 1, dx, dy)))
        return bp.bounds

    all_b = [bounds(n, dx, dy) for n, dx, dy, _ in placed]
    x0 = min(b[0] for b in all_b); x1 = max(b[2] for b in all_b)
    y0 = min(b[1] for b in all_b); y1 = max(b[3] for b in all_b)
    pad = 0.02 * upm

    # SVG space: origin at the top-left of the padded ink box, y down.
    def to_svg(dx, dy):
        return (1, 0, 0, -1, dx - x0 + pad, y1 + pad - dy)

    def path_of(name, dx, dy):
        sp = SVGPathPen(glyphs, ntos=fmt)
        glyphs[name].draw(TransformPen(sp, to_svg(dx, dy)))
        return sp.getCommands()

    width = x1 - x0 + 2 * pad
    height = y1 - y0 + 2 * pad

    ink_paths, split_letters = [], []
    for idx, ((name, dx, dy, cluster), b) in enumerate(zip(placed, all_b)):
        d = path_of(name, dx, dy)
        if cluster in SPLIT:
            # The letter's own middle, in SVG space.
            top = y1 + pad - b[3]
            mid = y1 + pad - (b[1] + b[3]) / 2
            left = b[0] - x0 + pad
            split_letters.append((WORD[cluster], d, left, top, mid, b[2] - b[0]))
        else:
            ink_paths.append(d)

    def split_svg(prefix, letters):
        defs, body = [], []
        for letter, d, left, top, mid, w in letters:
            cid = f'{prefix}-{letter.lower()}-top'
            # Generous on three sides; exact at the middle.
            defs.append(f'<clipPath id="{cid}"><rect x="{fmt(left - 20)}" y="{fmt(top - 20)}" '
                        f'width="{fmt(w + 40)}" height="{fmt(mid - top + 20)}"/></clipPath>')
            body.append(f'<path fill="{BLUE}" d="{d}"/>')
            body.append(f'<path fill="{RUST}" clip-path="url(#{cid})" d="{d}"/>')
        return defs, body

    # ---- the wordmark ----
    defs, split_body = split_svg('cj', split_letters)
    wordmark = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(width)} {fmt(height)}" '
        f'role="img" aria-label="ColdenJames">'
        f'<title>ColdenJames</title>'
        f'<defs>{"".join(defs)}</defs>'
        f'<path fill="{INK}" d="{" ".join(ink_paths)}"/>'
        f'{"".join(split_body)}</svg>'
    )

    # ---- the icon: the split C alone, centred on cream ----
    name, dx, dy, _ = placed[0]
    cb = bounds(name, 0, 0)
    cw, ch = cb[2] - cb[0], cb[3] - cb[1]
    side = max(cw, ch) * 1.44          # breathing room: about a fifth on each side
    ox = (side - cw) / 2 - cb[0]
    oy = (side - ch) / 2 + cb[3]
    sp = SVGPathPen(glyphs, ntos=fmt)
    glyphs[name].draw(TransformPen(sp, (1, 0, 0, -1, ox, oy)))
    cd = sp.getCommands()
    ctop = (side - ch) / 2
    cmid = side / 2
    icon = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(side)} {fmt(side)}" '
        f'role="img" aria-label="ColdenJames">'
        f'<title>ColdenJames</title>'
        f'<defs><clipPath id="cj-icon-top"><rect x="0" y="0" width="{fmt(side)}" height="{fmt(cmid)}"/></clipPath></defs>'
        f'<rect width="{fmt(side)}" height="{fmt(side)}" fill="{CREAM}"/>'
        f'<path fill="{BLUE}" d="{cd}"/>'
        f'<path fill="{RUST}" clip-path="url(#cj-icon-top)" d="{cd}"/></svg>'
    )

    out = os.path.join(ROOT, 'public', 'brand')
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, 'wordmark.svg'), 'w') as f:
        f.write(wordmark + '\n')
    with open(os.path.join(out, 'icon.svg'), 'w') as f:
        f.write(icon + '\n')

    js = ("'use strict';\n/* Generated by scripts/make-brand.py — do not edit. */\n"
          f"module.exports = {{\n  WORDMARK: {json.dumps(wordmark)},\n"
          f"  WORDMARK_RATIO: {width / height:.4f},\n"
          f"  ICON: {json.dumps(icon)}\n}};\n")
    with open(os.path.join(ROOT, 'site', 'brand-svg.js'), 'w') as f:
        f.write(js)

    print(f'wordmark {fmt(width)} x {fmt(height)} units (ratio {width / height:.3f}), '
          f'{len(wordmark)} bytes; icon {len(icon)} bytes')
    for letter, d, left, top, mid, w in split_letters:
        print(f'  {letter}: ink top {fmt(top)}, split at {fmt(mid)} (letter middle)')
    print('glyphs:', ' '.join(n for n, *_ in placed))
    print('any <text> in output:', '<text' in wordmark or '<text' in icon)


if __name__ == '__main__':
    main(sys.argv[1])
