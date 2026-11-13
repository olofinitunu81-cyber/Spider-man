# Turns the hero model's painted textures into recolourable masks for the menu.
# Usage: python3 tools/hero/tex_prep.py <model textures folder> <out folder>
# The hull around the chest spider is measured on this model's 8000 px suit texture.
#   suit.png  (RGB): r = "mask colour" panels (red on the original), g = web lines, b = chest spider
#   detail.jpg (L):  fabric height (painted wrinkles + the woven pattern from the red cloth)
#   lens.jpg   (L):  the honeycomb lens mesh
import sys, os
import numpy as np
from PIL import Image, ImageDraw
Image.MAX_IMAGE_PIXELS = 200_000_000
src, out = sys.argv[1], sys.argv[2]
N = 2048
def load(name, size, mode='RGB'):
    im = Image.open(os.path.join(src, name)).convert(mode)
    return np.asarray(im.resize((size, size), Image.BOX), dtype=np.float32) / 255.0
def blur(a, r):
    # separable box blur, two passes
    for _ in range(2):
        for ax in (0, 1):
            c = np.cumsum(np.pad(a, [(r + 1, r) if i == ax else (0, 0) for i in range(2)], mode='edge'), axis=ax)
            a = (np.take(c, range(2 * r + 1, c.shape[ax]), axis=ax) - np.take(c, range(0, c.shape[ax] - 2 * r - 1), axis=ax)) / (2 * r + 1)
    return a
def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

dif = load('NewDiffuse.png', N)
spec = load('spec2.png', N, 'L')
r, g, b = dif[..., 0], dif[..., 1], dif[..., 2]
reddish = smooth(0.06, 0.16, r - np.maximum(g, b)) * smooth(0.12, 0.25, r)
# the black web lines inside the red are still red panel: close the gaps
panel = smooth(0.3, 0.55, blur(np.maximum(reddish, spec * smooth(0.2, 0.6, blur(reddish, 6))), 3))

# chest spider: inside a hull around it, minus the web lines that run through the hull
S = 8000 / N
hull_pts = [(130, 345), (240, 338), (300, 352), (452, 372), (468, 420), (458, 482), (400, 498), (332, 474), (328, 562), (270, 570), (206, 558), (202, 474), (148, 474), (126, 420)]
hull_img = Image.new('L', (N, N), 0)
ImageDraw.Draw(hull_img).polygon([((x * 2) / S, (y * 2 + 4100) / S) for x, y in hull_pts], fill=255)
hull = np.asarray(hull_img, dtype=np.float32) / 255
ring = (blur(hull, 14) > 0.02) & (hull < 0.5)
lines_out = (spec > 0.5) & ring
# extend each line that enters the hull straight through it, and keep those pixels as web
from collections import deque
seen = np.zeros_like(lines_out); webcut = np.zeros((N, N), np.float32)
ys, xs = np.nonzero(lines_out)
yy, xx = np.mgrid[0:N, 0:N]
for y0, x0 in zip(ys, xs):
    if seen[y0, x0]: continue
    comp = []; q = deque([(y0, x0)]); seen[y0, x0] = True
    while q:
        y, x = q.popleft(); comp.append((y, x))
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                v, u = y + dy, x + dx
                if 0 <= v < N and 0 <= u < N and lines_out[v, u] and not seen[v, u]:
                    seen[v, u] = True; q.append((v, u))
    if len(comp) < 12: continue
    P = np.array(comp, np.float32); c = P.mean(0); _, _, vt = np.linalg.svd(P - c); d = vt[0]
    dist = np.abs((yy - c[0]) * d[1] - (xx - c[1]) * d[0])
    webcut = np.maximum(webcut, (dist < 3.2) * (hull > 0.5))
body = np.zeros((N, N), np.float32)
cx, cy = 268 * 2 / S, (500 * 2 + 4100) / S
body[(((xx - cx) / (58 * 2 / S)) ** 2 + ((yy - cy) / (66 * 2 / S)) ** 2) < 1] = 1  # abdomen is drawn over the lines
hx, hy = 272 * 2 / S, (418 * 2 + 4100) / S
body[(((xx - hx) / (26 * 2 / S)) ** 2 + ((yy - hy) / (24 * 2 / S)) ** 2) < 1] = 1  # and so is the head
emblem = spec * hull * np.maximum(1 - webcut, body)
web = np.clip(spec - emblem, 0, 1)

suit = np.stack([panel, web, emblem], -1)
Image.fromarray((suit * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, 'suit.png'), optimize=True)

# fabric height: the painted wrinkles (the fine weave is drawn by the shader instead)
wr = Image.open(os.path.join(src, 'wrinkles.png')).convert('L').resize((1024, 1024), Image.BOX)
wa = np.asarray(wr, dtype=np.float32) / 255.0
wa = np.clip(0.5 + 0.9 * (wa - np.median(wa)), 0, 1)
Image.fromarray((wa * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, 'detail.jpg'), quality=80, optimize=True)

lens = Image.open(os.path.join(src, '1_-_Lentes_-_Difusse.jpg')).convert('L').resize((1024, 1024), Image.BOX)
lens.save(os.path.join(out, 'lens.jpg'), quality=85, optimize=True)
for f in ('suit.png', 'detail.jpg', 'lens.jpg'): print(f, os.path.getsize(os.path.join(out, f)) // 1024, 'KB')
