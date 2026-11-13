#!/usr/bin/env python3
"""Builds the game's own typeface, "Spinneret", from scratch.

Every letter is assembled from a few spider-ish parts: blade-cut stems, bars that end
in fangs, and diagonals that taper to a point like a leg. Two weights come out of the
same drawings: Black for titles and menus, Regular for small text. Lowercase maps to
small capitals.

    pip install fonttools shapely brotli
    python3 tools/build_font.py
"""
import os
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
from shapely import affinity
from shapely.geometry.polygon import orient
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'fonts')


class Master:
    def __init__(self, name, weight, S, B, cw, sb, cap=700):
        self.name, self.weight = name, weight
        self.S, self.B, self.cw, self.sb, self.C = S, B, cw, sb, cap
        self.W = 2 * S + cw            # width of a square letter such as H
        self.d = 0.27 * S              # how far a blade cut overshoots
        self.fl = 0.66 * S             # fang length
        self.fb = 0.82 * S             # fang base
        self.ch = 0.5 * S              # corner chamfer
        self.T = 0.74 * S              # thin stroke


def P(*pts):
    return Polygon(pts).buffer(0)


def U(*shapes):
    return unary_union([s for s in shapes if s is not None and not s.is_empty])


def flip(shape, cx):
    return affinity.scale(shape, xfact=-1, yfact=1, origin=(cx, 0))


def stem(m, x, y0=0, y1=None, top='cut', bot='cut', w=None):
    """Vertical stroke. 'cut' ends are sliced like a blade, 'spike' ends in a sting."""
    y1 = m.C if y1 is None else y1
    w = m.S if w is None else w
    d = m.d * (w / m.S)
    pts = [(x, y0 + (0.9 * w if bot == 'spike' else 0))]
    pts += [(x, y1 + d), (x + w, y1)] if top == 'cut' else [(x, y1), (x + w, y1)]
    if bot == 'cut':
        pts += [(x + w, y0 - d)]
    elif bot == 'spike':
        pts += [(x + w, y0 + 0.5 * w), (x + 0.62 * w, y0 - 0.62 * w)]
    else:
        pts += [(x + w, y0)]
    return P(*pts)


def bar(m, x0, x1, y, end='flat', h=None):
    """Horizontal stroke running right from x0. The free end can carry a fang."""
    h = m.B if h is None else h
    e = 0.16 * h
    if end == 'fangdown':
        return P((x0, y), (x0, y + h), (x1 + e, y + h), (x1 + 0.3 * e, y - m.fl), (x1 - m.fb, y))
    if end == 'fangup':
        return P((x0, y), (x0, y + h), (x1 - m.fb, y + h), (x1 + 0.3 * e, y + h + m.fl), (x1 + e, y))
    if end == 'point':
        return P((x0, y), (x0, y + h), (x1 - 0.2 * h, y + h), (x1 + 0.5 * h, y + 0.28 * h), (x1 - 0.45 * h, y))
    if end == 'cut':
        return P((x0, y), (x0, y + h), (x1 + 0.3 * h, y + h), (x1, y))
    return P((x0, y), (x0, y + h), (x1, y + h), (x1, y))


def taper(p0, p1, w0, w1):
    """Straight stroke from p0 to p1 whose width goes from w0 to w1 (0 = a point)."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    ln = (dx * dx + dy * dy) ** 0.5
    nx, ny = -dy / ln, dx / ln
    a, b = w0 / 2, w1 / 2
    if w1 <= 0:
        return P((p0[0] + nx * a, p0[1] + ny * a), p1, (p0[0] - nx * a, p0[1] - ny * a))
    return P((p0[0] + nx * a, p0[1] + ny * a), (p1[0] + nx * b, p1[1] + ny * b), (p1[0] - nx * b, p1[1] - ny * b), (p0[0] - nx * a, p0[1] - ny * a))


def bowl(m, x0, y0, x1, y1, tr=True, br=True, t=None):
    """Angular bowl attached to a stem at x0: a chamfered box with its counter cut out."""
    t = m.S if t is None else t
    c, ci = m.ch, m.ch * 0.45
    outer = [(x0, y0), (x0, y1)]
    outer += [(x1 - c, y1), (x1, y1 - c)] if tr else [(x1, y1)]
    outer += [(x1, y0 + c), (x1 - c, y0)] if br else [(x1, y0)]
    ix0, ix1, iy0, iy1 = x0 + t * 0.2, x1 - t, y0 + m.B, y1 - m.B
    inner = [(ix0, iy0), (ix0, iy1)]
    inner += [(ix1 - ci, iy1), (ix1, iy1 - ci)] if tr else [(ix1, iy1)]
    inner += [(ix1, iy0 + ci), (ix1 - ci, iy0)] if br else [(ix1, iy0)]
    return P(*outer).difference(P(*inner))


def oval(m, w, y0=0, y1=None):
    """The round letters: an octagon, so O never reads as D."""
    y1 = m.C if y1 is None else y1
    c, ci, S, B = m.ch * 1.25, m.ch * 0.62, m.S, m.B
    outer = P((0, y0 + c), (0, y1 - c), (c, y1), (w - c, y1), (w, y1 - c), (w, y0 + c), (w - c, y0), (c, y0))
    inner = P((S, y0 + B + ci), (S, y1 - B - ci), (S + ci, y1 - B), (w - S - ci, y1 - B), (w - S, y1 - B - ci),
              (w - S, y0 + B + ci), (w - S - ci, y0 + B), (S + ci, y0 + B))
    return outer.difference(inner)


# ---------------------------------------------------------------- letters

def glyphs(m):
    S, B, C, W, d, T, fl, ch = m.S, m.B, m.C, m.W, m.d, m.T, m.fl, m.ch
    mid = 0.5 * C - 0.5 * B + 0.02 * C     # y of a middle bar
    G = {}

    def put(ch_, shape, width):
        G[ch_] = (shape, width)

    # --- straight letters
    put('H', U(stem(m, 0), stem(m, W - S), bar(m, S - 2, W - S + 2, mid)), W)
    put('I', stem(m, 0), S)
    wl = S + 0.62 * W
    put('L', U(stem(m, 0, bot='flat'), bar(m, 0, wl - 0.1 * S, 0, 'fangup')), wl)
    wt = 0.95 * W + 0.3 * S
    tb = bar(m, wt / 2 - 1, wt - 0.1 * S, C - B, 'fangdown')
    put('T', U(tb, flip(tb, wt / 2), stem(m, wt / 2 - S / 2, 0, C - 2, top='flat', bot='spike')), wt)
    we = S + 0.66 * W
    put('E', U(stem(m, 0, top='flat', bot='flat'), bar(m, 0, we - 0.1 * S, C - B, 'fangdown'),
               bar(m, S - 2, we - 0.36 * W, mid, 'point', h=B * 0.9), bar(m, 0, we - 0.1 * S, 0, 'fangup')), we)
    put('F', U(stem(m, 0, top='flat', bot='spike'), bar(m, 0, we - 0.1 * S, C - B, 'fangdown'),
               bar(m, S - 2, we - 0.36 * W, mid, 'point', h=B * 0.9)), we - 0.04 * W)

    # --- round letters
    put('O', oval(m, W), W)
    put('Q', U(oval(m, W), taper((W - S - 0.3 * S, 0.3 * C), (W + 0.32 * S, -0.2 * C), S * 0.85, 0)), W)
    put('D', U(stem(m, 0, bot='flat'), bowl(m, S * 0.8, 0, W, C)), W)
    wc = S + 0.7 * W
    c_shape = U(stem(m, 0, bot='flat'), bar(m, 0, wc - 0.1 * S, C - B, 'fangdown'), bar(m, 0, wc - 0.1 * S, 0, 'fangup'))
    c_shape = c_shape.difference(P((-5, -5), (ch, -5), (-5, ch)))
    put('C', c_shape, wc)
    wg = S + 0.78 * W
    g_shape = U(stem(m, 0, bot='flat'), bar(m, 0, wg - 0.1 * S, C - B, 'fangdown'), bar(m, 0, wg, 0),
                stem(m, wg - S, 0, 0.46 * C, top='flat', bot='cut'), bar(m, wg - S - 0.42 * S, wg, 0.46 * C - B))
    put('G', g_shape.difference(P((-5, -5), (ch, -5), (-5, ch))), wg)
    u_shape = U(stem(m, 0, bot='flat'), stem(m, W - S, bot='cut'), bar(m, 0, W, 0))
    put('U', u_shape.difference(P((-5, -5), (ch, -5), (-5, ch))), W)
    wj = S + 0.5 * W
    jb = flip(bar(m, wj / 2, wj - 0.1 * S, 0, 'fangup'), wj / 2)
    put('J', U(stem(m, wj - S, bot='flat'), jb, bar(m, wj / 2, wj, 0)), wj)

    # --- bowls on a stem
    wp = W - 0.04 * W
    put('P', U(stem(m, 0, top='flat', bot='spike'), bowl(m, S * 0.8, mid - 0.02 * C, wp, C)), wp)
    put('R', U(stem(m, 0, top='flat', bot='cut'), bowl(m, S * 0.8, mid - 0.02 * C, wp, C),
               taper((S + 0.34 * W, mid + 0.6 * B), (wp + 0.34 * S, -0.12 * C), S * 1.02, 0)), wp + 0.1 * S)
    put('B', U(stem(m, 0, top='flat', bot='flat'), bowl(m, S * 0.8, mid, wp - 0.05 * W, C), bowl(m, S * 0.8, 0, wp + 0.03 * W, mid + B)), wp + 0.03 * W)

    # --- the S: three bars and two short walls
    ws = W - 0.02 * W
    s_shape = U(bar(m, 0, ws - 0.1 * S, C - B, 'fangdown'), P((0, mid), (0, C), (S, C), (S, mid)),
                bar(m, 0, ws, mid), P((ws - S, 0), (ws - S, mid + B), (ws, mid + B), (ws, 0)),
                flip(bar(m, ws / 2, ws - 0.1 * S, 0, 'fangup'), ws / 2), bar(m, ws / 2, ws, 0))
    s_shape = s_shape.difference(P((-5, C + 5), (ch, C + 5), (-5, C - ch))).difference(P((ws + 5, -5), (ws - ch, -5), (ws + 5, ch)))
    put('S', s_shape, ws)

    # --- diagonals: every one of them tapers to a point
    wa = W + 0.3 * S
    a_out = P((wa / 2 - 0.06 * S, C + 0.09 * C), (wa, -d), (wa - S * 1.06, 0), (wa / 2, C - 1.3 * S), (S * 1.06, 0), (0, 0))
    a_bar = box(0.2 * wa, 0.2 * C, 0.8 * wa, 0.2 * C + T).intersection(P((wa / 2, C), (wa, 0), (0, 0)))
    put('A', U(a_out, a_bar), wa)
    wv = W + 0.26 * S
    put('V', P((0, C + d), (S * 1.08, C), (wv / 2, 1.25 * S), (wv - S * 1.08, C), (wv, C), (wv / 2 + 0.06 * S, -0.1 * C)), wv)
    v2 = P((0, C + d), (S * 1.04, C), (wv / 2 - 0.1 * S, 1.3 * S), (wv - S * 1.3, C), (wv - 0.3 * S, C), (wv / 2 - 0.04 * S, -0.1 * C))
    put('W', U(v2, affinity.translate(v2, wv - S * 1.32)), 2 * wv - S * 1.5)
    wm = 1.42 * W
    m_l = P((0, C + d), (S * 0.95, C), (wm / 2, 0.44 * C), (wm / 2, 0.44 * C - 1.35 * S))
    m_r = P((wm, C), (wm - S * 0.95, C), (wm / 2, 0.44 * C), (wm / 2, 0.44 * C - 1.35 * S))
    put('M', U(stem(m, 0), stem(m, wm - S, top='flat'), m_l, m_r), wm)
    wn = W + 0.28 * S
    put('N', U(stem(m, 0), stem(m, wn - S, top='flat'), P((0, C + d), (S * 1.0, C), (wn, -d), (wn - S * 1.0, 0))), wn)
    wx = W + 0.2 * S
    put('X', U(P((0, C + d), (S * 1.12, C), (wx, -d), (wx - S * 1.12, 0)), P((wx - S * 1.12, C), (wx, C), (S * 1.12, 0), (0, 0))), wx)
    wy = W + 0.2 * S
    put('Y', U(P((0, C + d), (S * 1.08, C), (wy / 2 + S / 2, 0.42 * C), (wy / 2 - S / 2, 0.42 * C)),
               P((wy, C), (wy - S * 1.08, C), (wy / 2 - S / 2, 0.42 * C), (wy / 2 + S / 2, 0.42 * C)),
               stem(m, wy / 2 - S / 2, 0, 0.46 * C, top='flat', bot='spike')), wy)
    wk = W + 0.2 * S
    put('K', U(stem(m, 0), P((S - 4, 0.34 * C), (S - 4, 0.56 * C), (wk - S * 1.1, C), (wk, C)),
               taper((S + 0.26 * W, 0.5 * C), (wk + 0.3 * S, -0.12 * C), S * 1.05, 0)), wk + 0.08 * S)
    wz = W
    zt = flip(bar(m, wz / 2, wz - 0.1 * S, C - B, 'fangdown'), wz / 2)
    put('Z', U(zt, bar(m, wz / 2, wz, C - B), P((wz - S * 1.2, C - B + 1), (wz, C - B + 1), (S * 1.2, B - 1), (0, B - 1)),
               bar(m, 0, wz - 0.1 * S, 0, 'fangup')), wz)

    # --- figures
    w0 = W - 0.06 * W
    put('0', U(oval(m, w0), taper((S + 0.1 * S, 0.3 * C), (w0 - S * 1.1, 0.7 * C), T * 0.9, T * 0.9)), w0)
    w1 = 1.75 * S
    put('1', U(stem(m, w1 - S, top='flat'), P((w1 - S + 2, C), (w1 - S + 2, C - 0.9 * B), (0, C - 1.5 * B - 0.4 * S), (0, C - 0.62 * B - 0.4 * S))), w1)
    w2 = W - 0.04 * W
    t2 = flip(bar(m, w2 / 2, w2 - 0.1 * S, C - B, 'fangdown'), w2 / 2)
    put('2', U(t2, bar(m, w2 / 2, w2, C - B), P((w2 - S, mid), (w2 - S, C), (w2, C), (w2, mid + 0.2 * S)),
               P((w2 - S * 1.2, mid + B * 0.6), (w2, mid + 0.2 * S), (S * 1.15, B - 1), (0, B - 1)),
               bar(m, 0, w2 - 0.1 * S, 0, 'fangup')).difference(P((w2 + 5, C + 5), (w2 - ch, C + 5), (w2 + 5, C - ch))), w2)
    t3 = flip(bar(m, w2 / 2, w2 - 0.1 * S, C - B, 'fangdown'), w2 / 2)
    b3 = flip(bar(m, w2 / 2, w2 - 0.1 * S, 0, 'fangup'), w2 / 2)
    s3 = U(t3, b3, bar(m, w2 / 2, w2, C - B), bar(m, w2 / 2, w2, 0), bar(m, 0.34 * w2, w2, mid, h=B * 0.9), P((w2 - S, 0), (w2 - S, C), (w2, C), (w2, 0)))
    s3 = s3.difference(P((w2 + 5, C + 5), (w2 - ch, C + 5), (w2 + 5, C - ch))).difference(P((w2 + 5, -5), (w2 - ch, -5), (w2 + 5, ch)))
    s3 = s3.difference(P((w2 + 5, mid + B * 0.45 - 0.3 * ch), (w2 - 0.6 * ch, mid + B * 0.45), (w2 + 5, mid + B * 0.45 + 0.3 * ch)))
    put('3', s3, w2)
    w4 = W + 0.1 * S
    put('4', U(stem(m, w4 - S * 1.5, top='flat', bot='spike'), bar(m, 0, w4, 0.24 * C, 'cut', h=B * 0.92),
               P((0, 0.24 * C + 2), (S * 1.15, 0.24 * C + 2), (w4 - S * 0.5, C), (w4 - S * 1.6, C))), w4 + 0.05 * S)
    s5 = U(bar(m, 0, w2 - 0.1 * S, C - B, 'fangdown'), P((0, mid), (0, C), (S, C), (S, mid)),
           bar(m, 0, w2, mid), P((w2 - S, 0), (w2 - S, mid + B), (w2, mid + B), (w2, 0)),
           flip(bar(m, w2 / 2, w2 - 0.1 * S, 0, 'fangup'), w2 / 2), bar(m, w2 / 2, w2, 0))
    put('5', s5.difference(P((w2 + 5, -5), (w2 - ch, -5), (w2 + 5, ch))).difference(P((w2 + 5, mid + B + 5), (w2 - ch, mid + B + 5), (w2 + 5, mid + B - ch))), w2)
    six = U(stem(m, 0, top='flat', bot='flat'), bar(m, 0, w2 - 0.1 * S, C - B, 'fangdown'), bowl(m, S * 0.8, 0, w2, mid + B))
    put('6', six.difference(P((-5, -5), (ch, -5), (-5, ch))).difference(P((-5, C + 5), (ch, C + 5), (-5, C - ch))), w2)
    put('9', affinity.rotate(six.difference(P((-5, -5), (ch, -5), (-5, ch))).difference(P((-5, C + 5), (ch, C + 5), (-5, C - ch))), 180, origin=(w2 / 2, C / 2)), w2)
    t7 = flip(bar(m, w2 / 2, w2 - 0.1 * S, C - B, 'fangdown'), w2 / 2)
    put('7', U(t7, bar(m, w2 / 2, w2, C - B), P((w2 - S * 1.25, C - B + 1), (w2, C - B + 1), (w2, C - B - 0.2 * S), (0.3 * w2 + S * 0.35, -0.1 * C))), w2)
    e8 = U(P((0, 0), (0, C), (w2, C), (w2, 0)))
    e8 = e8.difference(P((S, B), (S, mid), (w2 - S, mid), (w2 - S, B))).difference(P((S, mid + B * 0.9), (S, C - B), (w2 - S, C - B), (w2 - S, mid + B * 0.9)))
    for cx, cy, sx, sy in ((0, 0, 1, 1), (w2, 0, -1, 1), (0, C, 1, -1), (w2, C, -1, -1)):
        e8 = e8.difference(P((cx - 5 * sx, cy - 5 * sy), (cx + ch * sx, cy - 5 * sy), (cx - 5 * sx, cy + ch * sy)))
    e8 = e8.difference(P((-5, mid + B * 0.45 - 0.3 * ch), (0.6 * ch, mid + B * 0.45), (-5, mid + B * 0.45 + 0.3 * ch)))
    e8 = e8.difference(P((w2 + 5, mid + B * 0.45 - 0.3 * ch), (w2 - 0.6 * ch, mid + B * 0.45), (w2 + 5, mid + B * 0.45 + 0.3 * ch)))
    put('8', e8, w2)

    # --- punctuation and symbols
    dot = lambda x, y, k=1.0: P((x, y + 0.5 * S * k), (x + 0.5 * S * k, y + S * k + 0.12 * S * k), (x + S * k, y + 0.5 * S * k), (x + 0.5 * S * k, y - 0.12 * S * k))
    tail = lambda x, y: P((x + 0.1 * S, y + 0.55 * S), (x + 0.95 * S, y + 0.5 * S), (x + 0.1 * S, y - 0.85 * S))
    put('.', dot(0, 0), S)
    put(',', U(dot(0, 0), tail(0, 0)), S)
    put(':', U(dot(0, 0), dot(0, 0.42 * C)), S)
    put(';', U(dot(0, 0), tail(0, 0), dot(0, 0.42 * C)), S)
    put('!', U(dot(0, 0), P((-0.05 * S, C + d), (S * 1.05, C), (0.5 * S, 1.45 * S))), S)
    wq = 0.86 * W
    qm = U(flip(bar(m, wq / 2, wq - 0.1 * S, C - B, 'fangdown'), wq / 2), bar(m, wq / 2, wq, C - B), P((wq - S, 0.5 * C), (wq - S, C), (wq, C), (wq, 0.5 * C)),
           bar(m, wq / 2 - 0.5 * S, wq, 0.5 * C - 0.1 * B, h=B * 0.9), P((wq / 2 - 0.5 * S, 0.5 * C), (wq / 2 + 0.5 * S, 0.5 * C), (wq / 2, 1.45 * S)), dot(wq / 2 - 0.5 * S, 0))
    put('?', qm.difference(P((wq + 5, C + 5), (wq - ch, C + 5), (wq + 5, C - ch))), wq)
    put('-', P((0, mid + 0.1 * B), (0.2 * B, mid + 0.95 * B), (0.62 * W, mid + 0.95 * B), (0.62 * W - 0.2 * B, mid + 0.1 * B)), 0.62 * W)
    put('–', P((0, mid + 0.14 * B), (0.2 * B, mid + 0.86 * B), (0.9 * W, mid + 0.86 * B), (0.9 * W - 0.2 * B, mid + 0.14 * B)), 0.9 * W)
    put('—', P((0, mid + 0.14 * B), (0.2 * B, mid + 0.86 * B), (1.5 * W, mid + 0.86 * B), (1.5 * W - 0.2 * B, mid + 0.14 * B)), 1.5 * W)
    put('_', P((0, -0.9 * B), (0, -0.2 * B), (W, -0.2 * B), (W, -0.9 * B)), W)
    quote = lambda x: P((x, C + d), (x + 0.95 * S, C), (x + 0.3 * S, C - 1.45 * S))
    put("'", quote(0), 0.95 * S)
    put('"', U(quote(0), quote(1.2 * S)), 2.15 * S)
    put('/', P((0.9 * W - S * 0.95, C + d), (0.9 * W, C + d), (S * 0.95, -d), (0, -d)), 0.9 * W)
    put('\\', flip(P((0.9 * W - S * 0.95, C + d), (0.9 * W, C + d), (S * 0.95, -d), (0, -d)), 0.45 * W), 0.9 * W)
    par = P((1.5 * S, C + d), (0.7 * S, C + d), (0, 0.5 * C), (0.7 * S, -d), (1.5 * S, -d), (0.85 * S, 0.5 * C))
    put('(', par, 1.5 * S)
    put(')', flip(par, 0.75 * S), 1.5 * S)
    brk = U(P((0, -d), (0, C + d), (0.8 * S, C + d), (0.8 * S, -d)), P((0, C + d - 0.7 * B), (0, C + d), (1.7 * S, C + d), (1.7 * S, C + d - 0.7 * B)), P((0, -d), (0, -d + 0.7 * B), (1.7 * S, -d + 0.7 * B), (1.7 * S, -d)))
    put('[', brk, 1.7 * S)
    put(']', flip(brk, 0.85 * S), 1.7 * S)
    pw = 0.8 * W
    put('+', U(box(0, mid + 0.1 * B, pw, mid + 0.9 * B), box(pw / 2 - 0.4 * B, mid + 0.5 * B - pw / 2, pw / 2 + 0.4 * B, mid + 0.5 * B + pw / 2)), pw)
    put('=', U(box(0, mid + 0.95 * B, pw, mid + 1.7 * B), box(0, mid - 0.7 * B, pw, mid + 0.05 * B)), pw)
    chev = P((0.62 * W, 0.86 * C), (0.62 * W, 0.86 * C - 1.1 * T), (1.15 * T, 0.5 * C), (0.62 * W, 0.14 * C + 1.1 * T), (0.62 * W, 0.14 * C), (0, 0.5 * C))
    put('<', chev, 0.62 * W)
    put('>', flip(chev, 0.31 * W), 0.62 * W)
    put('‹', chev, 0.62 * W)
    put('›', flip(chev, 0.31 * W), 0.62 * W)
    put('|', box(0, -d, 0.7 * S, C + d), 0.7 * S)
    put('·', dot(0, 0.5 * C - 0.5 * S), S)
    put('•', dot(0, 0.5 * C - 0.65 * S, 1.3), 1.3 * S)
    put('…', U(dot(0, 0), dot(1.35 * S, 0), dot(2.7 * S, 0)), 3.7 * S)
    put('×', U(taper((0, 0.22 * C), (0.56 * C, 0.78 * C), T, T), taper((0, 0.78 * C), (0.56 * C, 0.22 * C), T, T)), 0.56 * C)
    wpc = 1.5 * W
    ring = lambda x, y: P((x, y), (x, y + 0.36 * C), (x + 0.5 * W, y + 0.36 * C), (x + 0.5 * W, y)).difference(P((x + 0.6 * T, y + 0.6 * T), (x + 0.6 * T, y + 0.36 * C - 0.6 * T), (x + 0.5 * W - 0.6 * T, y + 0.36 * C - 0.6 * T), (x + 0.5 * W - 0.6 * T, y + 0.6 * T)))
    put('%', U(ring(0, 0.64 * C), ring(wpc - 0.5 * W, 0), P((wpc - 0.42 * W - T, C + d), (wpc - 0.42 * W, C + d), (0.42 * W + T, -d), (0.42 * W, -d))), wpc)
    put('#', U(P((0.22 * W, -d), (0.22 * W + T, -d), (0.4 * W + T, C + d), (0.4 * W, C + d)), P((0.62 * W, -d), (0.62 * W + T, -d), (0.8 * W + T, C + d), (0.8 * W, C + d)),
               box(0, 0.6 * C, 1.05 * W, 0.6 * C + 0.8 * T), box(0, 0.26 * C, 1.05 * W, 0.26 * C + 0.8 * T)), 1.05 * W)
    star = U(*[affinity.rotate(taper((0.3 * W, 0.78 * C), (0.3 * W, 0.78 * C + 0.3 * W), T * 0.9, 0), a, origin=(0.3 * W, 0.78 * C)) for a in (0, 72, 144, 216, 288)])
    put('*', star, 0.6 * W)
    arrow = U(box(0.3 * W, mid + 0.14 * B, 1.1 * W, mid + 0.86 * B), P((0, mid + 0.5 * B), (0.5 * W, mid + 0.5 * B + 0.36 * W), (0.5 * W, mid + 0.5 * B - 0.36 * W)))
    put('←', arrow, 1.1 * W)
    put('→', flip(arrow, 0.55 * W), 1.1 * W)
    put('↑', affinity.rotate(arrow, -90, origin=(0.55 * W, mid + 0.5 * B)), 1.1 * W)
    put('↓', affinity.rotate(arrow, 90, origin=(0.55 * W, mid + 0.5 * B)), 1.1 * W)
    amp = U(oval(m, 0.8 * W, 0, 0.56 * C), oval(m, 0.62 * W, 0.56 * C - B, C), taper((0.3 * W, 0.6 * C), (1.02 * W, -0.08 * C), S * 0.9, 0))
    put('&', amp, 1.0 * W)
    put('©', U(oval(m, 0.5 * W, 0.2 * C, 0.8 * C)), 0.5 * W)
    put(' ', None, 0.52 * W)
    return G


# ---------------------------------------------------------------- font file

def draw(pen, shape):
    geoms = [shape] if shape.geom_type == 'Polygon' else list(shape.geoms)
    for g in geoms:
        if g.geom_type != 'Polygon' or g.area < 4:
            continue
        g = orient(g.simplify(0.4), sign=-1.0)
        for ring in [g.exterior] + list(g.interiors):
            pts = [(round(x), round(y)) for x, y in ring.coords[:-1]]
            if len(pts) < 3:
                continue
            pen.moveTo(pts[0])
            for p in pts[1:]:
                pen.lineTo(p)
            pen.closePath()


def build(m, sc_master):
    caps, small = glyphs(m), glyphs(sc_master)
    k = 0.78  # small capitals are drawn heavier, then shrunk, so they match the capitals
    order, cmap, glyf, metrics = ['.notdef'], {}, {}, {}
    pen = TTGlyphPen(None)
    draw(pen, box(60, 0, 440, 700).difference(box(120, 60, 380, 640)))
    glyf['.notdef'] = pen.glyph(); metrics['.notdef'] = (500, 60)

    def add(name, code, shape, width, sb):
        pen = TTGlyphPen(None)
        lsb = sb
        if shape is not None and not shape.is_empty:
            shape = affinity.translate(shape, sb)
            draw(pen, shape)
            lsb = round(shape.bounds[0])
        glyf[name] = pen.glyph()
        metrics[name] = (round(width + 2 * sb), lsb)
        order.append(name)
        for c in ([code] if isinstance(code, int) else code):
            cmap[c] = name

    for ch_, (shape, width) in caps.items():
        codes = [ord(ch_)]
        if ch_ == "'": codes += [0x2019, 0x2018]
        if ch_ == '"': codes += [0x201c, 0x201d]
        if ch_ == ' ': codes += [0xa0]
        add('u%04X' % ord(ch_), codes, shape, width, m.sb)
    for ch_ in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ':
        shape, width = small[ch_]
        add('sc_' + ch_, ord(ch_.lower()), affinity.scale(shape, xfact=k, yfact=k, origin=(0, 0)), width * k, m.sb * 0.92)

    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyf)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=900, descent=-240)
    fb.setupNameTable({'familyName': 'Spinneret', 'styleName': m.name, 'uniqueFontIdentifier': 'Spinneret-' + m.name,
                       'fullName': 'Spinneret ' + m.name, 'psName': 'Spinneret-' + m.name, 'version': 'Version 1.000',
                       'copyright': 'Made for Spider-Man: Rebirth, a fan project. Free to use and modify.'})
    fb.setupOS2(sTypoAscender=900, sTypoDescender=-240, sTypoLineGap=0, usWinAscent=940, usWinDescent=260,
                sxHeight=round(700 * k), sCapHeight=700, usWeightClass=m.weight)
    fb.setupPost()
    path = os.path.join(OUT, 'spinneret-%s' % m.name.lower())
    fb.save(path + '.ttf')
    font = TTFont(path + '.ttf')
    font.flavor = 'woff2'
    font.save(path + '.woff2')
    os.remove(path + '.ttf')
    print('built', path + '.woff2', len(order), 'glyphs')


if __name__ == '__main__':
    black = Master('Black', 900, S=150, B=124, cw=170, sb=26)
    black_sc = Master('BlackSC', 900, S=150 / 0.78 * 0.93, B=124 / 0.78 * 0.93, cw=170 / 0.78 * 0.98, sb=26)
    regular = Master('Regular', 400, S=92, B=80, cw=210, sb=40)
    regular_sc = Master('RegularSC', 400, S=92 / 0.78 * 0.95, B=80 / 0.78 * 0.95, cw=210 / 0.78, sb=40)
    build(black, black_sc)
    build(regular, regular_sc)
