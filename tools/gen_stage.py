"""
gen_stage.py — Karakura shahri sahni (gun botishi, yomg'urdan keyin).

4 qatlamli parallaks fon (orqadan oldinga):

    sky.png   2800x720  parallax 0.06  — quyosh diski, bulutlar, yulduzlar
    far.png   2800x720  parallax 0.30  — uzoq shahar + tepalar (3 chuqurlik)
    mid.png   2800x720  parallax 0.60  — binolar, simlar, minorva, kapalar, uzme
    near.png  2400x720  parallax 1.00  — nam yo'l, aks-sadolalar, ustunlar, narxonal

Har bir qatlam SS x o'lchamda chiziladi (supersampling), keyin LANCZOS bilan
kichiklashtiriladi va o'ziga xos "depth of field" GaussianBlur qo'llanadi —
bu parallaxni sezarli qiladi (uzoq = yumshoq, yaqin = aniq).

Ishga tushirish:  python tools\\gen_stage.py
Chiqish:          public/assets/stages/karakura/*.png
"""

from __future__ import annotations

import math
import random
import time
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).parent.parent
OUT = ROOT / "public" / "assets" / "stages" / "karakura"

# ----------------------------------------------------------------------------
# Global o'lchamlar
# ----------------------------------------------------------------------------
SS = 2                        # supersampling koeffitsienti
WORLD_W, WORLD_H = 2400, 720  # o'yin dunyosi
CAM_W, CAM_H = 1280, 720      # kamera
GROUND_Y = 600                # belgilar turadigan chiziq
LAYER_W = 2800                # sky/far/mid kengligi (parallaks uchun kengroq)
NEAR_W = 2400                 # near = o'yin yuzasi, aniq 2400
CAM_MEAN = (WORLD_W - CAM_W) / 2.0

# Kamera ko'rinadigan oraliq (parallaks koeffitsientiga qarab):
#   sky 0..1347, far 0..1616, mid 0..1952, near 0..2400
# shuning uchun qiziqarli kompozitsiya 0..2000 oralig'iga joylashtiriladi.

PARALLAX = {"sky": 0.06, "far": 0.30, "mid": 0.60, "near": 1.00}
DOF = {"sky": 3.0, "far": 1.5, "mid": 0.6, "near": 0.0}
SEED = 20260927

SIDE_TOP = 572                # tomchilam (asfalt chegarasi)
KERB_TOP = 591                # bordiurning yuqori chekkasi

# ----------------------------------------------------------------------------
# Palitra
# ----------------------------------------------------------------------------
SKY_TOP, SKY_UP, SKY_MID = "#2B1B4A", "#6E3568", "#C9524F"
SKY_HOT, SKY_GLOW = "#F0904A", "#FFD08A"
BLD_A, BLD_B = "#3A2E44", "#4A3A50"
WIN, ROAD, SAKURA = "#FFC46B", "#2A2430", "#F4A8C0"

_SKY_RAW = [
    (0.000, SKY_TOP),
    (0.140, "#3B2157"),
    (0.300, "#5C2C66"),
    (0.450, "#8A3C64"),
    (0.580, "#B84A56"),
    (0.680, "#D96050"),
    (0.760, SKY_HOT),
    (0.815, "#FFB870"),
    (0.845, SKY_GLOW),
    (0.900, "#F7A85E"),
    (1.000, "#C9744E"),
]

SUN_X = 720                   # quyosh markazi (osmon qatlamida)
SUN_Y, SUN_R = 330, 55        # binolar to'sidan tepada ko'rinadi


# ============================================================================
# Rang yordamchilari
# ============================================================================
def hx(h: str, a: int = 255) -> tuple[int, int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def mix(c1, c2, t: float):
    """Ikki RGBA rangni aralashtirish."""
    t = 0.0 if t < 0 else (1.0 if t > 1 else t)
    return tuple(int(round(c1[i] + (c2[i] - c1[i]) * t)) for i in range(4))


def ramp(c, f: float):
    """f < 1 -> quyuqroq, f > 1 -> oq tomon yorqinroq. Alpha O'ZGARMAYDI."""
    if f <= 1.0:
        out = tuple(int(max(0, min(255, round(v * f)))) for v in c[:3])
    else:
        t = min(1.0, f - 1.0)
        out = tuple(int(round(v + (255 - v) * t)) for v in c[:3])
    return out + (c[3],)


SKY_STOPS = [(p, hx(c)) for p, c in _SKY_RAW]


def ramp_at(stops, p: float):
    if p <= stops[0][0]:
        return stops[0][1]
    if p >= stops[-1][0]:
        return stops[-1][1]
    for i in range(len(stops) - 1):
        a, ca = stops[i]
        b, cb = stops[i + 1]
        if a <= p <= b:
            return mix(ca, cb, (p - a) / (b - a))
    return stops[-1][1]


def sky_at(y: float):
    """Osmon gradienti rangi (final px y bo'yicha) — 'tuman' rangi uchun."""
    return ramp_at(SKY_STOPS, y / WORLD_H)


# ============================================================================
# Gradient / shakl / shovqin yordamchilari
# ============================================================================
def vgrad(w: int, h: int, c0, c1=None, y0: float = 0.0, y1: float | None = None,
          ss: int = 2) -> Image.Image:
    """Vertikal gradient (RGB). c0 -> c1, rasm ichidagi y0..y1 orasida."""
    if c1 is None:
        c1 = c0
    if y1 is None:
        y1 = float(h)
    n = max(4, h * ss)
    col = Image.new("RGB", (1, n))
    px = col.load()
    span = max(1e-6, y1 - y0)
    for i in range(n):
        yf = (i / (n - 1)) * (h - 1)
        t = (yf - y0) / span
        t = 0.0 if t < 0 else (1.0 if t > 1 else t)
        px[0, i] = mix(c0, c1, t)[:3]
    return col.resize((w, h), Image.BILINEAR)


def vgrad_stops(w: int, h: int, stops, ss: int = 2) -> Image.Image:
    """To'xtamli nuqtalar bilan vertikal gradient (bandsiz)."""
    n = max(4, h * ss)
    col = Image.new("RGB", (1, n))
    px = col.load()
    for i in range(n):
        px[0, i] = ramp_at(stops, i / (n - 1))[:3]
    return col.resize((w, h), Image.BILINEAR)


def vmask(w: int, h: int, y0: float, y1: float, a0: int, a1: int,
          gamma: float = 1.0) -> Image.Image:
    """Vertikal alpha gradienti (L maska)."""
    n = max(4, h * 2)
    col = Image.new("L", (1, n))
    px = col.load()
    span = max(1e-6, y1 - y0)
    for i in range(n):
        yf = (i / (n - 1)) * (h - 1)
        t = (yf - y0) / span
        t = 0.0 if t < 0 else (1.0 if t > 1 else t)
        px[0, i] = int(max(0, min(255, round(a0 + (a1 - a0) * (t ** gamma)))))
    return col.resize((w, h), Image.BILINEAR)


def radial_mask(n: int, power: float = 2.0) -> Image.Image:
    """Markazdan chetga (1-d)^power bo'lgan yumaloq L maska (n x n)."""
    m = Image.new("L", (n, n))
    px = m.load()
    c = (n - 1) / 2.0
    for y in range(n):
        dy = (y - c) / c
        for x in range(n):
            dx = (x - c) / c
            d = math.hypot(dx, dy)
            px[x, y] = int(255 * (1.0 - d) ** power) if d < 1.0 else 0
    return m


def add_glow(base: Image.Image, cx: float, cy: float, r: float, color,
             strength: float = 0.6, power: float = 2.2, n: int = 192) -> None:
    """Yumshoq nur qatlamini qo'shadi (RGB — paste, RGBA — alpha_composite)."""
    d = max(4, int(2 * r))
    m = radial_mask(n, power).resize((d, d), Image.BILINEAR)
    if strength != 1.0:
        m = m.point(lambda v: int(v * strength))
    x = int(cx - r)
    y = int(cy - r)
    x = max(0, min(base.size[0] - d, x))
    y = max(0, min(base.size[1] - d, y))
    if base.mode == "RGB":
        base.paste(color[:3], (x, y, x + d, y + d), m)
    else:
        tile = Image.new("RGBA", (d, d), color[:3] + (0,))
        tile.putalpha(m)
        base.alpha_composite(tile, (x, y))


def add_grain(img: Image.Image, rng: random.Random, sigma: float = 14.0,
              amount: float = 0.06) -> Image.Image:
    """Past alphali shovqin — gradientda 'banding'ni yo'q qiladi."""
    w, h = img.size
    sw, sh = max(2, w // 2), max(2, h // 2)
    rnd = random.Random(rng.randrange(1 << 30))
    data = bytes(bytearray(
        int(max(0, min(255, rnd.gauss(128, sigma)))) for _ in range(sw * sh)))
    n = Image.frombytes("L", (sw, sh), data).resize((w, h), Image.BILINEAR)
    n = n.convert("RGB")
    r, g, b, a = img.split()
    rgb = Image.merge("RGB", (r, g, b))
    out = Image.blend(rgb, ImageChops.overlay(rgb, n), amount)
    return Image.merge("RGBA", (*out.split(), a))


def bloom(img: Image.Image, thresh: int = 205, radius: float = 9.0,
          strength: float = 0.55) -> Image.Image:
    """Yorqin joylarni (deraza, neon, chiroq) yumshatib qaytadi."""
    r, g, b, a = img.split()
    rgb = Image.merge("RGB", (r, g, b))
    lum = ImageChops.lighter(ImageChops.lighter(r, g), b)
    m = lum.point(lambda v: 0 if v < thresh
                  else int(255 * strength * min(1.0, (v - thresh) / (255 - thresh))))
    m = m.filter(ImageFilter.GaussianBlur(radius * 0.55))
    soft = ImageChops.multiply(rgb.filter(ImageFilter.GaussianBlur(radius)),
                               m.convert("RGB"))
    out = ImageChops.screen(rgb, soft)
    return Image.merge("RGBA", (*out.split(), a))


# ============================================================================
# Chizish qalami — koordinatalar FINAL px da, chizish SS da
# ============================================================================
class Pen:
    """Supersampled rasmga chizish. Barcha koordinatalar final px."""

    def __init__(self, w: int, h: int, mode: str = "RGBA"):
        self.w, self.h = w, h
        self.mode = mode
        size = (w * SS, h * SS)
        # "RGBA" rejimi ImageDraw ga alpha-blending yoqadi (faqat RGB rasm uchun)
        self.img = (Image.new("RGB", size, (0, 0, 0)) if mode == "RGB"
                    else Image.new("RGBA", size, (0, 0, 0, 0)))
        self.d = ImageDraw.Draw(self.img, "RGBA")

    def rect(self, x0, y0, x1, y1, fill):
        self.d.rectangle([x0 * SS, y0 * SS, x1 * SS, y1 * SS], fill=fill)

    def poly(self, pts, fill=None, outline=None, width=1.0):
        self.d.polygon([(x * SS, y * SS) for x, y in pts], fill=fill,
                       outline=outline, width=max(1, int(round(width * SS))))

    def line(self, pts, fill, width=1.0):
        self.d.line([(x * SS, y * SS) for x, y in pts], fill=fill,
                    width=max(1, int(round(width * SS))), joint="curve")

    def ellipse(self, x0, y0, x1, y1, fill=None, outline=None, width=1.0):
        self.d.ellipse([x0 * SS, y0 * SS, x1 * SS, y1 * SS], fill=fill,
                       outline=outline, width=max(1, int(round(width * SS))))

    def dot(self, cx, cy, r, fill):
        self.ellipse(cx - r, cy - r, cx + r, cy + r, fill=fill)

    def paste(self, im, xy, mask=None):
        self.img.paste(im, (int(round(xy[0])), int(round(xy[1]))), mask)

    def vgrad(self, c0, c1=None, y0=0.0, y1=None):
        """Vertikal gradient — y0/y1 FINAL px (ichida SS ga ko'paytiriladi)."""
        return vgrad(self.img.size[0], self.img.size[1], c0, c1,
                     y0 * SS, self.h * SS if y1 is None else y1 * SS)

    def vmask(self, y0, y1, a0, a1, gamma=1.0):
        """Vertikal alpha maska — y0/y1 FINAL px."""
        return vmask(self.img.size[0], self.img.size[1],
                     y0 * SS, y1 * SS, a0, a1, gamma)

    def glow(self, cx, cy, r, color, strength=0.6, power=2.2):
        add_glow(self.img, cx * SS, cy * SS, r * SS, color, strength, power)

    def sub(self, w: int, h: int) -> "Pen":
        """Kichik bo'lak qatlam (masalan daraxt gumbazi)."""
        return Pen(w, h)

    def stamp(self, pen: "Pen", x, y):
        self.img.alpha_composite(pen.img, (int(round(x * SS)), int(round(y * SS))))

    def finish(self) -> Image.Image:
        return self.img.resize((self.w, self.h), Image.LANCZOS)


# ============================================================================
# Qurilma detallari
# ============================================================================
def roof_hip(pen: Pen, x0, x1, top, rh, col, col_hi, col_dk, rng,
             overhang=13.0, upturn=0.0, tiles=True):
    """Khayroma (yane) tomi — egri qiya, chinni qatorlari, ko'tarilgan chetlar."""
    ex0, ex1 = x0 - overhang, x1 + overhang
    cx = (x0 + x1) * 0.5

    def ridge_y(t):
        return (top - rh * (t ** 0.68)
                - upturn * max(0.0, 1.0 - t / 0.20) ** 2)

    n = 16
    left = [(ex0 + (cx - ex0) * (i / n), ridge_y(i / n)) for i in range(n + 1)]
    right = [(cx + (ex1 - cx) * (i / n), ridge_y(i / n)) for i in range(n + 1)]
    pen.poly(left + right[1:] + [(ex1, top), (ex0, top)], fill=col)
    if tiles:
        for (xa, xb) in ((ex0, cx), (cx, ex1)):
            x = xa
            while x <= xb:
                t = (x - xa) / max(1e-6, xb - xa)
                pen.line([(x, ridge_y(t) + 1.6), (x, top - 1)],
                         fill=col_dk, width=1.1)
                x += 5.5
    # nurga qaragan qiya biroz yorqinroq (hammasi emas)
    pen.poly(right + [(ex1, top), (cx, top)], fill=col_hi)
    pen.line(left + right[1:], fill=col_dk, width=2.0)
    if tiles:  # chet ("hangadochi") chinnilari
        x = ex0 + 3
        while x < ex1:
            pen.dot(x, top - 1.0, 2.0, col_hi)
            x += 7.5


def roof_flat(pen: Pen, x0, x1, top, col, col_hi, col_dk, rng, parapet=7.0):
    """Tekis tom + to'siq (parapet)."""
    pen.rect(x0, top, x1, top + parapet, fill=col)
    pen.rect(x0, top, x1, top + 1.6, fill=col_hi)
    pen.rect(x0, top + parapet - 1.4, x1, top + parapet, fill=col_dk)
    x = x0 + 3
    while x < x1 - 2:
        pen.line([(x, top + 1.6), (x, top + parapet - 1.6)], fill=col_dk, width=0.9)
        x += rng.uniform(9, 17)


def roof_flare(pen: Pen, cx, half, y, h, col, col_hi, col_dk, up=0.0):
    """Pagoda uslubidagi kengayib turgan, burchaklari ko'tarilgan tom."""
    pts = [(cx - half, y - up)]
    n = 14
    for i in range(1, n + 1):
        t = i / n
        pts.append((cx - half + (half * 0.86) * t,
                    y - h * math.sin(t * math.pi / 2) ** 1.25))
    for i in range(1, n + 1):
        t = 1 - i / n
        pts.append((cx + half - (half * 0.86) * t,
                    y - h * math.sin(t * math.pi / 2) ** 1.25))
    pts += [(cx + half, y - up), (cx + half * 0.92, y), (cx - half * 0.92, y)]
    pen.poly(pts, fill=col)
    x = cx - half * 0.86
    while x < cx + half * 0.86:
        t = min(1.0, abs(x - cx) / (half * 0.86))
        yt = y - h * math.sin(t * math.pi / 2) ** 1.25
        pen.line([(x, yt + 2), (x, y - 1)], fill=col_dk, width=1.0)
        x += 6.5
    pen.line(pts[1:1 + n], fill=col_hi, width=1.6)
    x = cx - half + 4
    while x < cx + half - 2:
        pen.dot(x, y - 0.8, 1.9, col_hi)
        x += 7.0


def windows_grid(pen: Pen, x0, y0, x1, y1, cols, rows, rng, lit=0.30,
                 wcol=None, fcol=None):
    """Derazalar to'ri; ulardan bir qismi iliq yorqin (#FFC46B)."""
    wcol = wcol or hx("#221A2A")
    fcol = fcol or hx("#332A3C")
    gw = (x1 - x0) / max(1, cols)
    gh = (y1 - y0) / max(1, rows)
    ww, wh = gw * 0.56, gh * 0.58
    for r in range(rows):
        for c in range(cols):
            if rng.random() < 0.06:
                continue
            wx = x0 + gw * (c + 0.5) - ww / 2
            wy = y0 + gh * (r + 0.5) - wh / 2
            pen.rect(wx - 1.1, wy - 1.1, wx + ww + 1.1, wy + wh + 1.1, fill=fcol)
            if rng.random() < lit:
                pen.rect(wx, wy, wx + ww, wy + wh,
                         fill=mix(hx(WIN), hx(SKY_HOT), rng.uniform(0.20, 0.62)))
                if rng.random() < 0.3:
                    pen.glow(wx + ww / 2, wy + wh / 2, ww * 1.8, hx(WIN), 0.26)
                pen.line([(wx + ww / 2, wy), (wx + ww / 2, wy + wh)],
                         fill=mix(hx(WIN), hx("#6A3A30"), 0.55), width=0.8)
            else:
                pen.rect(wx, wy, wx + ww, wy + wh, fill=wcol)
                pen.line([(wx, wy + wh * 0.72), (wx + ww, wy + wh * 0.72)],
                         fill=ramp(wcol, 1.6), width=0.8)


def sign_horizontal(pen: Pen, x0, y, w, h, rng, col=None):
    """Peshtaqora ustidagi gorizontal banner."""
    col = col or mix(hx(WIN), hx("#B8503C"), rng.uniform(0.25, 0.6))
    pen.rect(x0 - 2, y - 2, x0 + w + 2, y + h + 2, fill=ramp(col, 0.35))
    pen.rect(x0, y, x0 + w, y + h, fill=col)
    pen.rect(x0, y, x0 + w, y + 1.4, fill=ramp(col, 1.4))
    bx = x0 + 6
    while bx + 7 < x0 + w - 4:
        pen.rect(bx, y + 3.5, bx + rng.uniform(4, 8), y + h - 3.5,
                 fill=ramp(col, 1.75))
        bx += 11.5
    pen.glow(x0 + w / 2, y + h / 2, w * 0.85, col, 0.32)


def sign_vertical(pen: Pen, x, y, w, h, rng, col=None):
    """Fasadning burchagidan chiqqan vertikal kanban belgisi."""
    col = col or mix(hx(WIN), hx("#C9524F"), rng.uniform(0.15, 0.45))
    pen.rect(x, y, x + w, y + h, fill=ramp(col, 0.30))
    pen.rect(x + 1.6, y + 1.6, x + w - 1.6, y + h - 1.6, fill=col)
    yy = y + 6
    while yy < y + h - 9:
        pen.rect(x + 4, yy, x + w - 4, yy + rng.uniform(3, 5.5), fill=ramp(col, 1.8))
        yy += 10.5
    pen.glow(x + w / 2, y + h / 2, w * 2.4, col, 0.38)


def sign_neon(pen: Pen, x, y, w, h, col):
    """Neon konturi."""
    pen.rect(x, y, x + w, y + h, outline=col, width=1.6)
    pen.rect(x + 3, y + 3, x + w - 3, y + h - 3, outline=ramp(col, 0.6), width=0.9)
    pen.glow(x + w / 2, y + h / 2, max(w, h) * 1.5, col, 0.42)
    bx = x + 7
    while bx < x + w - 7:
        pen.line([(bx, y + h * 0.3), (bx, y + h * 0.7)], fill=col, width=1.4)
        bx += 12.0


def awning(pen: Pen, x0, x1, y, drop, cols=2):
    """Chadqayot (tengri chiziqli)."""
    w = (x1 - x0) / cols
    for i in range(cols):
        a = hx("#D8CFC4") if i % 2 == 0 else hx("#B4483F")
        pen.poly([(x0 + w * i, y), (x0 + w * (i + 1), y),
                  (x0 + w * (i + 1) + 3, y + drop), (x0 + w * i + 3, y + drop)],
                 fill=a)
    pen.rect(x0, y - 1.5, x1, y + 1.0, fill=hx("#2A2430"))
    for i in range(cols):
        pen.dot(x0 + w * i + 3, y + drop, 2.0, hx("#2A2430"))


def balcony(pen: Pen, x0, x1, y, h, col, col_hi):
    pen.rect(x0, y, x1, y + h, fill=col)
    pen.rect(x0, y, x1, y + 1.3, fill=col_hi)
    x = x0 + 3
    while x < x1 - 2:
        pen.line([(x, y + 1.6), (x, y + h - 1)], fill=ramp(col, 0.55), width=0.9)
        x += 5.5
    pen.rect(x0, y + h - 1.4, x1, y + h, fill=ramp(col, 0.45))


def antenna(pen: Pen, x, base, h, col, light=False, cross=3):
    pen.line([(x, base), (x, base - h)], fill=col, width=1.5)
    for i in range(cross):
        y = base - h * (0.42 + 0.52 * i / max(1, cross - 1))
        w = 8.5 - i * 1.7
        pen.line([(x - w, y), (x + w, y)], fill=col, width=1.1)
    if light:
        pen.dot(x, base - h, 1.7, hx("#FF6A5A"))
        pen.glow(x, base - h, 9, hx("#FF6A5A"), 0.55)


def roof_tank(pen: Pen, x, base, w, h, col, col_hi, col_dk, legs=14):
    """Uy ustidagi suv idishi."""
    pen.rect(x - w / 2 + 3, base - legs, x - w / 2 + 6, base, fill=col_dk)
    pen.rect(x + w / 2 - 6, base - legs, x + w / 2 - 3, base, fill=col_dk)
    pen.rect(x - w / 2 - 2, base - legs - h, x + w / 2 + 2, base - legs, fill=col)
    pen.ellipse(x - w / 2 - 2, base - legs - h - 5, x + w / 2 + 2,
                base - legs - h + 5, fill=col_hi)
    pen.rect(x - w / 2 - 2, base - legs, x + w / 2 + 2, base - legs + 2, fill=col_dk)
    for k in (0.3, 0.62):
        pen.line([(x - w / 2, base - legs - h * k), (x + w / 2, base - legs - h * k)],
                 fill=col_dk, width=1.0)


def water_tower(pen: Pen, cx, base, s, col, col_hi, col_dk):
    """Minorva silueti — 4 oyoq, idish, konusli qopqoq."""
    lw, lh, tw, th = 7 * s, 98 * s, 116 * s, 74 * s
    top = base - lh
    for dx in (-1, 1):
        pen.line([(cx + dx * (lw * 0.5 + tw * 0.5 - 10 * s), base),
                  (cx + dx * lw * 0.5, top)], fill=col_dk, width=2.4 * s)
    for k in (0.32, 0.70):
        y = top + lh * k
        pen.line([(cx - lw * 0.5 - 44 * s, y), (cx + lw * 0.5 + 38 * s, y - 16 * s)],
                 fill=col_dk, width=1.1 * s)
        pen.line([(cx + lw * 0.5 + 38 * s, y), (cx - lw * 0.5 - 44 * s, y - 16 * s)],
                 fill=col_dk, width=1.1 * s)
    pen.rect(cx - tw / 2, top - th, cx + tw / 2, top, fill=col)
    pen.ellipse(cx - tw / 2, top - th - 8 * s, cx + tw / 2, top - th + 8 * s,
                fill=col_hi)
    pen.ellipse(cx - tw / 2, top - 8 * s, cx + tw / 2, top + 8 * s, fill=col_dk)
    for k in (0.28, 0.62, 0.86):
        pen.line([(cx - tw / 2, top - th * k), (cx + tw / 2, top - th * k)],
                 fill=col_dk, width=1.3 * s)
    # qopqoq
    pen.poly([(cx - tw / 2 - 10 * s, top - th), (cx + tw / 2 + 10 * s, top - th),
              (cx + 4 * s, top - th - 28 * s), (cx - 4 * s, top - th - 28 * s)],
             fill=col)
    pen.poly([(cx - tw / 2 - 10 * s, top - th), (cx + 4 * s, top - th - 28 * s),
              (cx - 4 * s, top - th - 28 * s), (cx - tw / 2, top - th)],
             fill=col_hi)
    pen.line([(cx, top - th - 28 * s), (cx, top - th - 40 * s)], fill=col_dk, width=1.6 * s)
    for i in range(7):
        y = top - 6 * s - i * 9 * s
        pen.line([(cx + tw / 2, y), (cx + tw / 2 + 8 * s, y)], fill=col_dk, width=1.1 * s)


def power_pole(pen: Pen, x, base, top, rng, col, col_hi):
    """Elektr ustuni: tayoq, krestovina, izolyatorlar, transformator."""
    pen.rect(x - 3.2, top, x + 3.2, base, fill=col)
    pen.rect(x + 0.6, top, x + 3.2, base, fill=col_hi)
    pen.rect(x - 6.5, base - 4, x + 6.5, base, fill=ramp(col, 0.7))
    arm_y = top + 16
    pen.rect(x - 30, arm_y, x + 30, arm_y + 4, fill=col)
    for k in (-26, -12, 12, 26):
        pen.rect(x + k - 2, arm_y - 7, x + k + 2, arm_y, fill=col_hi)
        pen.dot(x + k, arm_y - 8, 1.8, ramp(col_hi, 1.6))
    arm2 = arm_y + 26
    pen.rect(x - 20, arm2, x + 20, arm2 + 3.4, fill=col)
    for k in (-15, 0, 15):
        pen.rect(x + k - 1.6, arm2 - 6, x + k + 1.6, arm2, fill=col_hi)
    if rng.random() < 0.6:
        ty = arm2 + 30
        pen.rect(x - 9, ty, x + 9, ty + 22, fill=ramp(col, 1.3))
        pen.rect(x - 9, ty, x + 9, ty + 2, fill=col_hi)
        for k in (-4, 0, 4):
            pen.line([(x + k, ty + 3), (x + k, ty + 19)], fill=col, width=0.9)
    return arm_y, arm2


def wires(pen: Pen, p0, p1, levels, col, sag, width=1.0):
    """Osilgan (catenary) simlar."""
    (x0, y0), (x1, y1) = p0, p1
    for dy in levels:
        ya, yb = y0 + dy, y1 + dy
        pts = []
        n = 22
        s = sag * (1.0 + abs(dy) * 0.012)
        for i in range(n + 1):
            t = i / n
            pts.append((x0 + (x1 - x0) * t,
                        ya + (yb - ya) * t + s * 4 * t * (1 - t)))
        pen.line(pts, fill=col, width=width)


def stone_wall(pen: Pen, x0, x1, base, h, rng, col, col_hi, col_dk):
    """Tosh devor: qatorlar, har blok boshqacha, ustida 'kap' toshi."""
    top = base - h
    pen.rect(x0, top, x1, base, fill=col)
    rows = max(2, int(h / 19))
    rh = h / rows
    y = top
    for _ in range(rows):
        x = x0 - rng.uniform(0, 16)
        while x < x1:
            bw = rng.uniform(24, 46)
            by = y + rng.uniform(-1.2, 1.2)
            bh = rh - rng.uniform(1.2, 2.6)
            tone = ramp(col, rng.uniform(0.74, 1.16))
            xr = min(x + bw - 1.6, x1)
            pen.rect(x, by, xr, by + bh, fill=tone)
            pen.rect(x, by, xr, by + 1.5, fill=ramp(tone, 1.3))
            pen.rect(x, by + bh - 1.4, xr, by + bh, fill=ramp(tone, 0.72))
            x += bw
        y += rh
    pen.rect(x0 - 2.5, top - 6.5, x1 + 2.5, top, fill=col_hi)
    pen.rect(x0 - 2.5, top - 6.5, x1 + 2.5, top - 4.6, fill=ramp(col_hi, 1.32))
    x = x0 - 2
    while x < x1 + 1:
        pen.line([(x, top - 6.5), (x, top)], fill=ramp(col_hi, 0.7), width=0.9)
        x += rng.uniform(22, 40)
    for _ in range(int((x1 - x0) / 55)):
        px = rng.uniform(x0, x1)
        pen.ellipse(px - rng.uniform(6, 16), base - rng.uniform(4, 13),
                    px + rng.uniform(8, 22), base + 1, fill=col_dk)


def mon_gate(pen: Pen, cx, base, w, h, col, col_hi, col_dk, rng):
    """Devordagi kichik tomakli darvoza (mon)."""
    top = base - h
    pen.rect(cx - w / 2, top + 14, cx - w / 2 + 9, base, fill=col)
    pen.rect(cx + w / 2 - 9, top + 14, cx + w / 2, base, fill=col)
    pen.rect(cx - w / 2 - 2, top + 8, cx + w / 2 + 2, top + 16, fill=col_dk)
    roof_hip(pen, cx - w / 2 - 8, cx + w / 2 + 8, top + 10, 20,
             col_dk, col_hi, col, rng, overhang=7, upturn=5)


def cherry_tree(pen: Pen, x, base, h, rng):
    """Uzme daraxti: ko'rinadigan o'zak, tarmoqlar, notekis gumbaz, gullar."""
    col = hx("#2A2030")
    tw = h * 0.062
    fork = 0.50                                    # tarmoqlar shu balandlikdan
    pen.poly([(x - tw, base), (x + tw, base),
              (x + tw * 0.30, base - h * fork), (x - tw * 0.30, base - h * fork)],
             fill=col)
    tips, twigs = [], []
    nb = rng.randint(5, 6)
    for i in range(nb):
        a = math.radians(-90 + (i - (nb - 1) / 2) * rng.uniform(30, 46))
        ln = h * rng.uniform(0.24, 0.34)
        bx = x + math.cos(a) * ln
        by = base - h * fork + math.sin(a) * ln
        tips.append((bx, by))
        twigs.append((tw * 0.55, [(x, base - h * (fork + 0.12)), (bx, by)]))
        for s in (-1, 1):
            a2 = a + math.radians(s * rng.uniform(30, 55))
            l2 = ln * rng.uniform(0.45, 0.70)
            ex, ey = bx + math.cos(a2) * l2, by + math.sin(a2) * l2
            twigs.append((tw * 0.30, [(bx, by), (ex, ey)]))
            tips.append((ex, ey))
    # tarmoqlar gumbaz OSTIDA chiziladi — faqat chekkasi ko'rinadi
    for (w_, pts) in twigs:
        pen.line(pts, fill=col, width=w_)

    # gumbaz — alohida qatlam: ko'p kichik to'p, keyin yumshatiladi
    cw, chh = int(h * 1.60), int(h * 1.34)
    ox, oy = int(x - cw / 2), int(base - h * 1.26)
    r = h * rng.uniform(0.13, 0.17)
    tiles = [(bx, by, r * rng.uniform(0.72, 1.0), r * rng.uniform(0.60, 0.86))
             for (bx, by) in tips]
    for _ in range(rng.randint(8, 12)):            # yon to'plar
        tiles.append((x + rng.uniform(-cw * 0.30, cw * 0.30),
                      base - h * rng.uniform(0.60, 1.00),
                      r * rng.uniform(0.50, 0.90), r * rng.uniform(0.44, 0.76)))
    sub = pen.sub(cw, chh)
    mask = Image.new("L", (cw * SS, chh * SS), 0)
    md = ImageDraw.Draw(mask)
    for (bx, by, rx, ry) in tiles:
        md.ellipse([(bx - ox - rx) * SS, (by - oy - ry) * SS,
                    (bx - ox + rx) * SS, (by - oy + ry) * SS], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(2.4 * SS))
    # ustasi yorqin, osti to'q pushti
    body = vgrad(cw * SS, chh * SS, hx("#EFA6C0"), hx("#8E4468"),
                 y0=0, y1=(base - h * 0.50 - oy) * SS)
    sub.img.paste(body, (0, 0), mask)
    hi = Image.new("L", (cw * SS, chh * SS), 0)
    hd = ImageDraw.Draw(hi)
    for (bx, by, rx, ry) in tiles[: max(5, len(tiles) // 2)]:
        hd.ellipse([(bx - ox - rx) * SS, (by - oy - ry - 4) * SS,
                    (bx - ox + rx) * SS, (by - oy + ry - 4) * SS], fill=95)
    hi = hi.filter(ImageFilter.GaussianBlur(4.0 * SS))
    sub.img.paste(Image.new("RGB", (cw * SS, chh * SS), hx("#FBD2E0")), (0, 0), hi)
    pen.stamp(sub, ox, oy)

    # gumbaz orasidan sezilarli yalang'oq tarmoqlar
    for (w_, pts) in twigs[1::3]:
        pen.line(pts, fill=hx("#A86680"), width=max(1.0, w_ * 0.42))

    pen.glow(x, base - h * 0.90, h * 0.46, hx(SAKURA), 0.18)
    for _ in range(rng.randint(14, 20)):
        pen.dot(x + rng.uniform(-cw * 0.5, cw * 0.5),
                base - h * rng.uniform(0.05, 0.80),
                rng.uniform(1.1, 2.2),
                mix(hx(SAKURA), hx("#FFF0F5"), rng.random() * 0.5))


def street_lamp(pen: Pen, x, base, h, rng, arm=-1):
    """Ko'cha chirog'i: quyuq ustun, yengil yoy, iliq cho'g'."""
    col, col_hi = hx("#241E2E"), hx("#3A3246")
    top = base - h
    pen.rect(x - 2.6, top, x + 2.6, base, fill=col)
    pen.rect(x + 0.8, top, x + 2.6, base, fill=col_hi)
    pen.rect(x - 5.5, base - 5, x + 5.5, base, fill=ramp(col, 0.65))
    for k in (0.42, 0.72):
        pen.rect(x - 4, base - h * k, x + 4, base - h * k + 3, fill=ramp(col, 0.8))
    pts = [(x + arm * (h * 0.19) * (i / 12),
            top - math.sin((i / 12) * math.pi / 2) * h * 0.075 + (i / 12) * h * 0.02)
           for i in range(13)]
    pen.line(pts, fill=col, width=2.4)
    lx, ly = pts[-1]
    pen.rect(lx - 9, ly, lx + 9, ly + 5.5, fill=col)
    pen.poly([(lx - 8, ly + 5), (lx + 8, ly + 5), (lx + 5, ly + 12), (lx - 5, ly + 12)],
             fill=ramp(col, 1.3))
    pen.ellipse(lx - 7, ly + 9, lx + 7, ly + 15, fill=hx(WIN))
    pen.glow(lx, ly + 12, 64, hx(WIN), 0.40)
    pen.glow(lx, ly + 12, 20, hx("#FFF0CE"), 0.75)
    return lx, ly + 12


def vending(pen: Pen, x, base, w, h):
    """Avtomat (vending machine) — kuchli iliq manba."""
    body, dk = hx("#E8E2D6"), hx("#2A2430")
    pen.rect(x, base - h, x + w, base, fill=dk)
    pen.rect(x + 2, base - h + 2, x + w - 2, base - 2, fill=body)
    rows, cols = 3, 4
    cw = (w - 8) / cols
    ch = (h - 18) / rows
    cans = ["#E0554F", "#4E86C6", "#E0A34F", "#6FBF73", "#C75F9E", "#D9D2BE"]
    for r in range(rows):
        for c in range(cols):
            x0 = x + 4 + cw * c
            y0 = base - h + 6 + ch * r
            pen.rect(x0, y0, x0 + cw - 1.4, y0 + ch - 1.4, fill=dk)
            cc = mix(hx(cans[(r * cols + c) % len(cans)]), body, 0.25)
            pen.rect(x0 + 1.2, y0 + 1.6, x0 + cw - 2.6, y0 + ch - 3.4, fill=cc)
            pen.rect(x0 + 1.2, y0 + 1.6, x0 + cw - 2.6, y0 + ch * 0.45, fill=ramp(cc, 1.35))
    pen.rect(x + 4, base - 12, x + w - 4, base - 4, fill=hx("#B8B2A6"))
    for c in range(5):
        bx = x + 6 + c * (w - 12) / 5
        pen.rect(bx, base - 10.5, bx + 3, base - 6, fill=dk)
    pen.rect(x + 2, base - h + 2, x + w - 2, base - h + 7, fill=hx(WIN))
    pen.glow(x + w / 2, base - h * 0.5, w * 2.2, hx(WIN), 0.32)


def traffic_light(pen: Pen, x, base, h):
    """Yo'l signali — qizil chiroq (nam yo'lda qizil aks-sado)."""
    col, col_hi = hx("#241E2E"), hx("#3A3246")
    head_y = base - h
    pen.rect(x - 2.4, head_y + 10, x + 2.4, base, fill=col)
    pen.rect(x + 0.6, head_y + 10, x + 2.4, base, fill=col_hi)
    pen.rect(x - 2, base - h - 1, x + 2, base, fill=ramp(col, 0.6))
    hw, hh = 15.0, 42.0
    pen.rect(x - hw / 2 - 2.5, head_y - hh / 2 - 2.5, x + hw / 2 + 2.5,
             head_y + hh / 2 + 2.5, fill=ramp(col, 0.55))
    for c, lit in ((0, False), (1, False), (2, True)):
        cy = head_y - hh / 2 + 8 + c * 13
        pen.dot(x, cy, 5.2, hx("#181320"))
        pen.dot(x, cy, 3.9, hx("#FF6A5A") if lit else hx("#3A2A30"))
        if lit:
            pen.glow(x, cy, 17, hx("#FF6A5A"), 0.75)
    pen.rect(x - hw / 2 + 1, head_y + hh / 2 - 9, x + hw / 2 - 1,
             head_y + hh / 2 - 4, fill=ramp(col, 0.8))
    return x, head_y - hh / 2 + 34


def bicycle(pen: Pen, x, base):
    """Velosiped silueti (masshtab uchun)."""
    col, r = hx("#1F1A28"), 12.0
    for dx in (-19, 19):
        pen.ellipse(x + dx - r, base - r * 1.5, x + dx + r, base + r * 0.5,
                    outline=col, width=1.6)
    pen.line([(x - 19, base - r * 0.5), (x - 2, base - r * 1.2),
              (x + 6, base - r * 1.2), (x + 19, base - r * 0.5)], fill=col, width=1.8)
    pen.line([(x - 2, base - r * 1.2), (x + 10, base - r * 2.1),
              (x + 19, base - r * 0.5)], fill=col, width=1.6)
    pen.line([(x - 19, base - r * 0.5), (x + 6, base - r * 1.2)], fill=col, width=1.4)
    pen.line([(x + 4, base - r * 2.3), (x + 15, base - r * 2.3)], fill=col, width=1.6)


# ============================================================================
# QATLAM 1 — OSMON
# ============================================================================
def make_sky() -> Image.Image:
    pen = Pen(LAYER_W, WORLD_H, "RGB")
    W, H = pen.img.size
    pen.paste(vgrad_stops(W, H, SKY_STOPS), (0, 0))

    # quyosh nuri
    add_glow(pen.img, SUN_X * SS, SUN_Y * SS, 330 * SS, hx(SKY_HOT), 0.42, 2.8)
    add_glow(pen.img, SUN_X * SS, SUN_Y * SS, 165 * SS, hx("#FFCE96"), 0.60, 2.2)
    add_glow(pen.img, SUN_X * SS, SUN_Y * SS, 84 * SS, hx("#FFDCA4"), 0.90, 1.8)
    # quyosh diski (yumaloq chekkali, iliq oltin)
    add_glow(pen.img, SUN_X * SS, SUN_Y * SS, SUN_R * SS, hx("#FFD07A"), 1.0, 0.28)
    add_glow(pen.img, SUN_X * SS, SUN_Y * SS, SUN_R * 0.72 * SS, hx("#FFEDB4"),
             1.0, 0.50)
    add_glow(pen.img, SUN_X * SS, SUN_Y * SS, SUN_R * 0.34 * SS, hx("#FFFBEC"),
             1.0, 0.60)

    # yulduzlar
    rng = random.Random(SEED + 1)
    for _ in range(54):
        sx, sy = rng.uniform(0, LAYER_W), rng.uniform(0, 215)
        fade = max(0.0, 1.0 - sy / 215.0) ** 1.25
        a = int(rng.uniform(60, 215) * fade)
        if a >= 12:
            pen.dot(sx, sy, rng.uniform(1.0, 2.3) * (0.7 + 0.7 * fade),
                    (255, 246, 232, min(255, a)))

    rng = random.Random(SEED + 2)

    def clouds(ellipses, y0, y1, c0, c1, blur, alpha):
        mask = Image.new("L", (W, H), 0)
        md = ImageDraw.Draw(mask)
        for (cx, cy, rx, ry) in ellipses:
            md.ellipse([(cx - rx) * SS, (cy - ry) * SS, (cx + rx) * SS,
                        (cy + ry) * SS], fill=255)
        mask = mask.filter(ImageFilter.GaussianBlur(blur * SS))
        mask = mask.point(lambda v: int(v * alpha))
        pen.paste(vgrad(W, H, c0, c1, y0=y0 * SS, y1=y1 * SS), (0, 0), mask)

    def streak(y, wmin, wmax, hmin, hmax):
        out, x = [], rng.uniform(-100, 100)
        while x < LAYER_W + 200:
            w, h = rng.uniform(wmin, wmax), rng.uniform(hmin, hmax)
            out.append((x, y + rng.uniform(-h, h), w, h))
            x += w * rng.uniform(0.42, 0.85) + (rng.uniform(20, 130)
                                                if rng.random() < 0.18 else 0)
        return out

    # yuqori ingichka sirruslar
    clouds(streak(126, 90, 300, 4, 9), 105, 150, hx("#4B2B62"), hx("#3A2450"), 7.0, 0.55)
    # o'rta to'p bulutlar
    mid = [(rng.uniform(-40, LAYER_W + 40), rng.uniform(212, 300),
            rng.uniform(70, 210), rng.uniform(11, 26)) for _ in range(30)]
    clouds(mid, 205, 305, hx("#3E2452"), hx("#8A3F58"), 9.0, 0.72)
    # pastki, quyoshdan yoritilgan
    low = [(rng.uniform(-60, LAYER_W + 60), rng.uniform(340, 424),
            rng.uniform(110, 300), rng.uniform(13, 30)) for _ in range(22)]
    clouds(low, 330, 432, hx("#6E3050"), hx(SKY_HOT), 10.0, 0.70)
    # ufq yaqinidagi iliq ingichka yo'llar
    clouds(streak(470, 120, 380, 3.5, 8), 455, 500, hx(SKY_HOT), hx(SKY_GLOW), 8.0, 0.60)
    clouds(streak(524, 150, 420, 3.0, 6.5), 512, 552, hx("#FFD8A0"), hx(SKY_GLOW),
           9.0, 0.48)

    # ufqda yig'ilgan yorug'lik
    pen.paste(pen.vgrad(hx(SKY_GLOW), hx(SKY_GLOW), 500, 606), (0, 0),
              pen.vmask(500, 606, 0, 110, 0.85))
    return pen.finish().convert("RGBA")


# ============================================================================
# QATLAM 2 — UZOQ SHAHAR (3 chuqurlik, atmosferada)
# ============================================================================
def make_far() -> Image.Image:
    pen = Pen(LAYER_W, WORLD_H)
    W, H = pen.img.size
    body = mix(hx(BLD_A), hx(SKY_MID), 0.30)
    base = GROUND_Y + 4

    def band(shapes, top, haze):
        """Siluet + vertikal 'haze' gradienti + blok darajasi tebranishi."""
        mask = Image.new("L", (W, H), 0)
        md = ImageDraw.Draw(mask)
        sm = Image.new("L", (W, H), 255)     # blok darajasini o'zgartirish
        sd = ImageDraw.Draw(sm)
        for sh in shapes:
            sh(md, sd)
        # ufqga yaqinlashganda tuman ko'payadi -> qiymat yorqinlashadi
        c_top = mix(body, sky_at(top), haze * 0.58)
        c_bot = mix(body, sky_at(base), min(0.90, haze * 0.98))
        grad = vgrad(W, H, c_top, c_bot, y0=top * SS, y1=base * SS)
        pen.paste(ImageChops.multiply(grad, sm.convert("RGB")), (0, 0), mask)

    # --- BAND 1 (eng uzoq): tepalar — eng och qiymat
    rng = random.Random(SEED + 11)
    ph = [rng.uniform(0, 6.28) for _ in range(4)]

    def ridge(x):
        t = x / LAYER_W
        return (470 - 30 * math.sin(t * 5.1 + ph[0])
                - 17 * math.sin(t * 11.3 + ph[1]) - 9 * math.sin(t * 23.7 + ph[2]))

    crest = []
    x = -60.0
    while x < LAYER_W + 80:
        crest.append((x, ridge(x)))
        x += 7
    shp1 = [lambda md, sd: md.polygon([(a * SS, b * SS) for a, b in crest]
                                      + [(LAYER_W * SS, base * SS), (0, base * SS)],
                                      fill=255)]
    for _ in range(10):                     # tepa ustidagi uzoq minoralar
        mx = rng.uniform(0, LAYER_W)
        my = ridge(mx) + 2
        mw, mh = rng.uniform(3, 7), rng.uniform(14, 36)

        def tw(md, sd, mx=mx, my=my, mw=mw, mh=mh):
            md.rectangle([mx * SS, (my - mh) * SS, (mx + mw) * SS, my * SS], fill=255)
            sd.rectangle([mx * SS, (my - mh) * SS, (mx + mw) * SS, my * SS], fill=236)
        shp1.append(tw)
    band(shp1, 430, 0.62)

    # --- BAND 2: o'rta shaharcha + past tepa
    rng = random.Random(SEED + 12)
    shp2 = []
    p2 = [rng.uniform(0, 6.28) for _ in range(2)]
    ridge2 = []
    x = -60.0
    while x < LAYER_W + 80:
        t = x / LAYER_W
        ridge2.append((x, 528 - 22 * math.sin(t * 7.3 + p2[0])
                         - 12 * math.sin(t * 17.1 + p2[1])))
        x += 6
    shp2.append(lambda md, sd: md.polygon(
        [(a * SS, b * SS) for a, b in ridge2]
        + [(LAYER_W * SS, base * SS), (0, base * SS)], fill=255))
    bx = -30.0
    while bx < LAYER_W + 40:
        bw, bh = rng.uniform(26, 84), rng.uniform(30, 74)
        tone = rng.randint(206, 244)

        def blk(md, sd, bx=bx, bw=bw, bh=bh, tone=tone):
            box = [bx * SS, (base - bh) * SS, (bx + bw) * SS, base * SS]
            md.rectangle(box, fill=255)
            sd.rectangle(box, fill=tone)
        shp2.append(blk)
        if rng.random() < 0.20:              # ustida idish/antenna
            tw_, th_ = rng.uniform(8, 20), rng.uniform(10, 26)
            tx = bx + bw * rng.uniform(0.2, 0.7)

            def ex(md, sd, tx=tx, tw_=tw_, th_=th_, tone=tone):
                box = [tx * SS, (base - bh - th_) * SS, (tx + tw_) * SS,
                       (base - bh) * SS]
                md.rectangle(box, fill=255)
                sd.rectangle(box, fill=tone)
            shp2.append(ex)
        bx += bw + rng.uniform(-4, 16)
    band(shp2, 470, 0.34)

    # --- BAND 3 (eng yaqin): shahar tomchilari — eng to'q
    rng = random.Random(SEED + 13)
    shp3 = []
    bx = -40.0
    while bx < LAYER_W + 40:
        bw, bh = rng.uniform(30, 96), rng.uniform(30, 104)
        tone = rng.randint(196, 240)
        top = base - bh
        box = [bx * SS, top * SS, (bx + bw) * SS, base * SS]
        shp3.append(lambda md, sd, box=box, tone=tone: (md.rectangle(box, fill=255),
                                                          sd.rectangle(box, fill=tone)))
        if rng.random() < 0.32:
            tw_, th_ = rng.uniform(12, 22), rng.uniform(8, 16)
            tx = bx + bw * rng.uniform(0.15, 0.75)
            b2 = [tx * SS, (top - th_) * SS, (tx + tw_) * SS, top * SS]
            shp3.append(lambda md, sd, b2=b2, tone=tone: (md.rectangle(b2, fill=255),
                                                           sd.rectangle(b2, fill=tone)))
        if rng.random() < 0.24:
            ax = bx + bw * rng.uniform(0.2, 0.8)
            ah = rng.uniform(14, 36)
            b3 = [ax * SS, (top - ah) * SS, (ax + 1.6) * SS, top * SS]
            shp3.append(lambda md, sd, b3=b3, tone=tone: (md.rectangle(b3, fill=255),
                                                           sd.rectangle(b3, fill=tone)))
        bx += bw + rng.uniform(-6, 12)
    band(shp3, 486, 0.12)

    # atmosferadagi umumiy tuman
    haze_col = mix(sky_at(540), sky_at(420), 0.45)
    pen.paste(pen.vgrad(haze_col, haze_col, 396, 664), (0, 0),
              pen.vmask(396, 664, 0, 78, 1.05))
    # ufq chizig'idagi yorug'lik
    pen.paste(pen.vgrad(hx(SKY_GLOW), hx(SKY_GLOW), 556, 616), (0, 0),
              pen.vmask(552, 618, 0, 76, 1.0))
    return pen.finish()


# ============================================================================
# QATLAM 3 — ASOSIY BINOLAR
# ============================================================================
# (x, kenglik, uslub, chuqurlik: 0 = uzoq/kichik, 1 = yaqin/katta)
# Bo'sh joylar (ariq) qoldirilgan — ular orqali uzoq shahar ko'rinadi.
PLOTS = [
    (-100, 214, "apartment", 0.78),
    (128, 150, "house", 0.50),
    (352, 130, "shop", 0.38),
    (566, 220, "warehouse", 0.72),        # ariq 482..566
    (720, 214, "machiya", 0.92),          # ariq 650..720
    (1010, 190, "shop", 0.98),            # ariq 934..1010
    (1276, 196, "temple", 0.52),          # ariq 1200..1276
    (1546, 148, "house", 0.46),           # ariq 1472..1546
    (1766, 292, "apartment", 1.00),       # ariq 1694..1766
    # kamera ko'rinmaydigan to'ldiruvchi qism (2058..2800)
    (2120, 200, "house", 0.55),
    (2332, 240, "warehouse", 0.70),
    (2584, 180, "shop", 0.62),
    (2776, 220, "machiya", 0.80),
]

WALLS = [(14, 352, 70), (352, 482, 44), (566, 650, 58), (720, 934, 64),
         (1010, 1200, 32), (1276, 1472, 70), (1546, 1694, 46), (1766, 2010, 64),
         (2072, 2400, 60), (2472, 2800, 66)]
TREES = [(548, 590, 208), (972, 592, 162), (1618, 588, 122)]
POLE_X = [60, 452, 848, 1244, 1640, 2036, 2432, 2828]
WATER_TOWER_X = 1560


def draw_plot(pen: Pen, rng, x, w, base, h, style, depth, sun_x):
    """Bitta bino/uzilma. depth: 0 = uzoq (kichik, och), 1 = yaqin (katta, to'q)."""
    top = base - h
    haze = (1.0 - depth) * 0.40
    body = mix(mix(hx(BLD_A), hx(SKY_MID), 0.22 + haze * 0.55),
               hx(BLD_B), 0.30 * depth)
    body = ramp(body, rng.uniform(0.88, 1.14))
    body_dk = ramp(body, 0.62)
    body_hi = ramp(body, 1.12)
    roof_hi = ramp(body, 1.04)          # tom qiyasi juda yorqin emas
    sun_right = (x + w / 2) < sun_x    # quyosh qaysi tomonda

    # --- ombor (past, yassi yotq tom)
    if style == "warehouse":
        pen.rect(x, top + 16, x + w, base, fill=body)
        sx, sw = x + w * 0.30, w * 0.40
        pen.rect(sx, base - 74, sx + sw, base - 3, fill=ramp(body_dk, 1.3))
        for i in range(11):
            pen.line([(sx, base - 70 + i * 6.2), (sx + sw, base - 70 + i * 6.2)],
                     fill=ramp(body_dk, 0.80), width=1.1)
        pen.rect(sx - 2, base - 76, sx + sw + 2, base - 72, fill=body_hi)
        pen.poly([(x - 5, top + 16), (x + w + 5, top + 12), (x + w + 5, top + 2),
                  (x - 5, top + 4)], fill=body_dk)
        for i in range(int(w / 7)):
            pen.line([(x - 4 + i * 7, top + 5), (x - 4 + i * 7, top + 15)],
                     fill=ramp(body_dk, 1.25), width=1.0)
        pen.rect(x - 5, top + 1, x + w + 5, top + 4.5, fill=body_hi)
        windows_grid(pen, x + 8, top + 26, x + w - 8, top + 58, 5, 1, rng, 0.22)
        if rng.random() < 0.7:
            sign_horizontal(pen, x + w * 0.18, top - 12, w * 0.42, 20, rng)
        roof_tank(pen, x + w * 0.72, top + 2, 26, 18, body_dk, body_hi, body)
        return

    # --- ko'p qavatli uy-joy
    if style == "apartment":
        floors = max(3, int(h / 46))
        pen.rect(x, top, x + w, base, fill=body)
        for f in range(floors):
            fy = top + 20 + f * (h - 26) / floors
            fh = min(20.0, (h - 26) / floors * 0.42)
            balcony(pen, x + 2, x + w - 2, fy, fh, ramp(body, 0.78), body_hi)
            windows_grid(pen, x + 7, fy + fh + 4, x + w - 7, fy + fh + 26, 4, 1,
                         rng, 0.30)
        pen.rect(x, top, x + w, top + 8, fill=body_dk)
        pen.rect(x, base - 20, x + w, base, fill=ramp(body, 0.80))
        windows_grid(pen, x + 9, base - 17, x + w - 9, base - 5, 4, 1, rng, 0.45)
        pen.rect((x + w - 3.0) if sun_right else x, top,
                 (x + w) if sun_right else (x + 3.0), base, fill=ramp(body, 1.55))
        roof_flat(pen, x, x + w, top, body_dk, body_hi, body, rng)
        if rng.random() < 0.8:
            roof_tank(pen, x + w * rng.uniform(0.2, 0.75), top - 1, 24, 17,
                      body_dk, body_hi, body)
        if rng.random() < 0.65:
            antenna(pen, x + w * rng.uniform(0.2, 0.8), top - 2,
                    rng.uniform(30, 52), body_dk, light=rng.random() < 0.4)
        return

    # --- machiya (an'anaviy uy): pastko'k, to'g'ri devor, chuqur tom
    if style == "machiya":
        pen.rect(x, top + 14, x + w, base, fill=body)
        for i in range(int(w / 9)):
            xx = x + i * 9
            pen.line([(xx, top + 16), (xx, base)], fill=ramp(body, 0.86), width=1.6)
        pen.rect(x + 2, base - 58, x + w - 2, base - 2, fill=mix(hx(WIN), hx(SKY_MID), 0.42))
        for i in range(int((w - 6) / 13)):
            pen.rect(x + 4 + i * 13, base - 56, x + 6 + i * 13, base - 4,
                     fill=ramp(body_dk, 0.9))
        pen.rect(x + 2, base - 58, x + w - 2, base - 54, fill=ramp(body_dk, 1.3))
        windows_grid(pen, x + 8, top + 24, x + w - 8, top + 60, 3, 1, rng, 0.45)
        awning(pen, x + 3, x + w - 3, base - 66, 12)
        sign_horizontal(pen, x + 6, top - 10, w * 0.5, 19, rng)
        if rng.random() < 0.75:
            sign_vertical(pen, x + w - 16, top - 74, 14, 62, rng)
        roof_hip(pen, x, x + w, top + 15, 30, ramp(body, 0.80), roof_hi, body_dk,
                 rng, overhang=17, upturn=7)
        return

    # --- kichik uy + mo'yin
    if style == "house":
        pen.rect(x, top + 18, x + w, base, fill=body)
        pen.rect(x + 2, base - 34, x + w - 2, base - 2, fill=ramp(body, 0.80))
        windows_grid(pen, x + 8, base - 32, x + w - 8, base - 8, 3, 1, rng, 0.50)
        windows_grid(pen, x + 8, top + 30, x + w - 8, top + 58, 2, 1, rng, 0.40)
        cx0 = x + w * rng.uniform(0.2, 0.6)
        pen.rect(cx0, top - 16, cx0 + 9, top + 6, fill=body_dk)
        pen.rect(cx0 - 2, top - 19, cx0 + 11, top - 14, fill=body_hi)
        roof_hip(pen, x, x + w, top + 19, 32, ramp(body, 0.78), roof_hi, body_dk,
                 rng, overhang=15, upturn=6)
        return

    # --- yapon uslubidagi ibodatxona (pagoda)
    if style == "temple":
        cx = x + w / 2
        pen.rect(x + w * 0.18, top + h * 0.30, x + w * 0.82, base, fill=body)
        pen.rect(x + w * 0.36, top + h * 0.10, x + w * 0.64, base, fill=ramp(body, 1.12))
        windows_grid(pen, x + w * 0.40, base - 52, x + w * 0.60, base - 12, 1, 2,
                     rng, 0.7)
        pen.rect(x + w * 0.28, base - 66, x + w * 0.72, base - 50, fill=body_dk)
        roof_hip(pen, x + w * 0.28, x + w * 0.72, base - 66, 16, body_dk, roof_hi,
                 body, rng, overhang=9, upturn=4)
        step = h * 0.28
        for i in range(3):
            ry = top + 8 + i * step
            half = w * 0.5 * (0.70 + 0.15 * i)
            pen.rect(cx - half * 0.42, ry, cx + half * 0.42, ry + step * 0.55,
                     fill=ramp(body, 1.0 + 0.05 * i))
            roof_flare(pen, cx, half, ry, 20 - i * 3, body_dk, roof_hi, body,
                       up=6 - i * 1.5)
        pen.line([(cx, top + 4), (cx, top - 16)], fill=body_hi, width=2.0)
        for k in range(3):
            pen.rect(cx - 5 + k * 2, top - 8 - k * 5, cx + 5 - k * 2,
                     top - 5 - k * 5, fill=body_hi)
        return

    # --- do'kon (asosiy peshtaqa)
    pen.rect(x, top, x + w, base, fill=body)
    floors = 2 if h < 190 else 3
    fh = (h - 96) / floors
    for f in range(floors):
        windows_grid(pen, x + 8, top + 14 + f * fh, x + w - 8,
                     top + 14 + f * fh + fh * 0.62, 3 if w < 190 else 4, 1, rng, 0.32)
    pen.rect(x + 2, base - 86, x + w - 2, base - 2, fill=mix(hx(WIN), hx(SKY_MID), 0.34))
    pen.rect(x + 4, base - 82, x + w - 4, base - 6, fill=mix(hx(WIN), hx(SKY_GLOW), 0.30))
    for i in range(int((w - 8) / 15)):
        pen.rect(x + 5 + i * 15, base - 84, x + 7.6 + i * 15, base - 4,
                 fill=ramp(body_dk, 0.85))
    pen.rect(x + 2, base - 88, x + w - 2, base - 84, fill=body_hi)
    pen.glow(x + w / 2, base - 44, w * 0.85, hx(WIN), 0.28)
    awning(pen, x + 2, x + w - 2, base - 96, 13)
    pen.rect((x + w - 2.6) if sun_right else x, top,
             (x + w) if sun_right else (x + 2.6), base, fill=ramp(body, 1.6))
    sign_horizontal(pen, x + 5, base - 128, w * 0.62, 24, rng)
    if rng.random() < 0.6:
        sign_vertical(pen, x + 3, base - 232, 15, 70, rng,
                      mix(hx(WIN), hx("#D0608E"), 0.45))
    if rng.random() < 0.35:
        sign_neon(pen, x + w * 0.2, top + 26, w * 0.5, 30, hx("#FF7A9A"))
    roof_flat(pen, x, x + w, top, body_dk, body_hi, body, rng, parapet=6)
    if rng.random() < 0.5:
        roof_tank(pen, x + w * 0.25, top - 1, 22, 15, body_dk, body_hi, body)
    if rng.random() < 0.5:
        antenna(pen, x + w * 0.72, top - 1, rng.uniform(24, 40), body_dk, light=True)


def make_mid() -> Image.Image:
    pen = Pen(LAYER_W, WORLD_H)
    rng = random.Random(SEED + 20)
    sun_mid_x = SUN_X + PARALLAX["mid"] * CAM_MEAN   # quyoshning mid-koordinatasi

    # --- orqa yer chizig'i (binolarni osiltirmaslik uchun)
    gcol = mix(hx(ROAD), hx(BLD_A), 0.45)
    pen.paste(pen.vgrad(ramp(gcol, 1.12), ramp(gcol, 0.72), 548, WORLD_H), (0, 0),
              pen.vmask(548, 560, 0, 255))

    # --- minorva (binolardan orqada, tomlardan baland)
    tcol = mix(hx(BLD_A), sky_at(300), 0.20)
    water_tower(pen, WATER_TOWER_X, 566, 1.62, tcol, ramp(tcol, 1.16), ramp(tcol, 0.66))

    # --- binolar (uzoq -> yaqin)
    for (x, w, style, depth) in sorted(PLOTS, key=lambda p: p[3]):
        base = 562 + 24 * depth + rng.uniform(-3, 3)
        scale = 0.70 + 0.30 * depth
        h = {"apartment": (225, 305), "house": (104, 142), "warehouse": (100, 140),
             "machiya": (126, 168), "shop": (170, 235),
             "temple": (185, 215)}[style]
        draw_plot(pen, rng, x, w, base, rng.uniform(*h) * scale, style, depth,
                  sun_mid_x)

    # --- tosh devor + mon darvoza (binolardan oldin, to'qroq)
    for (wx0, wx1, wh) in WALLS:
        c = mix(hx("#3C323E"), sky_at(540), 0.10 + 0.08 * rng.random())
        stone_wall(pen, wx0, wx1, 588, wh, rng, c, ramp(c, 1.20), ramp(c, 0.62))
    mon_gate(pen, 1210, 588, 62, 84, hx("#382E3E"), hx("#4A3E52"), hx("#241E2C"), rng)

    # --- uzme daraxtlari
    for (tx, tb, th) in TREES:
        cherry_tree(pen, tx, tb, th, rng)

    # --- elektr ustunlari va simlar (eng oldin)
    poles = []
    for i, px in enumerate(POLE_X):
        ptop = 330 + rng.uniform(-26, 30) + (18 if i % 3 == 0 else 0)
        col = mix(hx("#1E1826"), sky_at(ptop), 0.10)
        poles.append((px,) + power_pole(pen, px, 590, ptop, rng, col, ramp(col, 2.0)))
    wcol = mix(hx("#1A1522"), sky_at(360), 0.14)
    for i in range(len(poles) - 1):
        x0, a0, b0 = poles[i]
        x1, a1, b1 = poles[i + 1]
        wires(pen, (x0, a0 - 4), (x1, a1 - 4), (0, 12, 24), wcol, 13)
        wires(pen, (x0, b0 - 3), (x1, b1 - 3), (0, 9, 18), wcol, 10, 0.9)
    for (px, arm, arm2) in poles[::2]:
        wires(pen, (px + 14, arm2 - 3), (px + rng.uniform(40, 96), arm2 + 40),
              (0, 8), wcol, 6, 0.9)

    # ko'cha darajasida yumshoq soyalanish (faqat siluet ichida)
    W, H = pen.img.size
    depth_shade = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    depth_shade.putalpha(ImageChops.multiply(pen.img.getchannel("A"),
                                             pen.vmask(370, 604, 0, 62, 1.5)))
    pen.img.alpha_composite(depth_shade)
    return bloom(pen.finish(), 206, 9.0, 0.42)


# ============================================================================
# QATLAM 4 — KO'CHA (nam asfalt, aks-sadolalar)
# ============================================================================
def make_near(backdrop: Image.Image) -> Image.Image:
    pen = Pen(NEAR_W, WORLD_H)
    fx = Pen(NEAR_W, WORLD_H)      # yarim-shaffof effektlar (alpha_composite)
    rng = random.Random(SEED + 30)
    W, H = pen.img.size
    vis = WORLD_H - GROUND_Y       # ko'rinadigan yo'l balandligi (120 px)

    # ---------- ko'cha yuzasi (butunlay opak to'ldiruvchi) ----------
    pen.rect(0, GROUND_Y - 1, NEAR_W, WORLD_H, fill=hx("#2E2833"))
    pen.paste(pen.vgrad(hx("#3A3140"), hx("#241F2B"), GROUND_Y, WORLD_H), (0, 0),
              pen.vmask(GROUND_Y, GROUND_Y + 3, 0, 255))

    # ---------- osmonning issiq ko'lmagi (notekis, tekis emas) ----------
    sw, sh = 300, 16
    pool = Image.new("L", (sw, sh))
    pd = ImageDraw.Draw(pool)
    for _ in range(46):
        px, py = rng.uniform(-30, sw + 30), rng.uniform(0, sh)
        rx, ry = rng.uniform(14, 62), rng.uniform(1.4, 4.2)
        pd.ellipse([px - rx, py - ry, px + rx, py + ry], fill=rng.randint(70, 205))
    pool = pool.resize((W, vis * SS), Image.BILINEAR)
    fade = vmask(W, vis * SS, 0, vis * SS, 190, 0, 1.35)
    pen.paste(Image.new("RGB", (W, vis * SS), hx(SKY_HOT)), (0, GROUND_Y * SS),
              ImageChops.multiply(pool, fade).point(lambda v: int(v * 0.36)))
    pen.paste(Image.new("RGB", (W, vis * SS), hx(SKY_MID)), (0, GROUND_Y * SS),
              ImageChops.multiply(pool, vmask(W, vis * SS, 0, vis * SS, 255, 0, 1.6)
                                  ).point(lambda v: int(v * 0.18)))

    # ---------- vertikal aks-sado (binolar + osmon) ----------
    PAD = 300
    bg = backdrop.convert("RGBA")
    src = Image.new("RGBA", (LAYER_W + 2 * PAD, WORLD_H), (0, 0, 0, 0))
    src.paste(bg, (PAD, 0))
    src.paste(bg.crop((0, 0, PAD, WORLD_H)), (0, 0))
    src.paste(bg.crop((LAYER_W - PAD, 0, LAYER_W, WORLD_H)), (PAD + LAYER_W, 0))

    REF_H = 196                                    # ~180 px da so'nib ketadi
    OFF = -int(round(0.40 * CAM_MEAN))             # parallaks kelishuvi
    flip = src.crop((PAD + OFF, GROUND_Y - REF_H, PAD + OFF + NEAR_W, GROUND_Y))
    flip = flip.transpose(Image.FLIP_TOP_BOTTOM).crop((0, 0, NEAR_W, vis))
    refl_fade = vmask(NEAR_W, vis, 0, vis, 158, 0, 0.92)
    soft = flip.filter(ImageFilter.GaussianBlur(2.4))
    soft.putalpha(ImageChops.multiply(soft.getchannel("A"), refl_fade))
    pen.img.alpha_composite(soft.resize((W, vis * SS), Image.BILINEAR),
                            (0, GROUND_Y * SS))

    # ---------- ko'chalar, dog'lar, yorqiz (juda yorqin emas) ----------
    for _ in range(9):
        px, py = rng.uniform(0, NEAR_W), GROUND_Y + rng.uniform(4, 108)
        pw, ph = rng.uniform(90, 260), rng.uniform(9, 26)
        pen.ellipse(px - pw / 2, py - ph / 2, px + pw / 2, py + ph / 2,
                    fill=mix(hx("#26212E"), hx("#3E3548"), rng.uniform(0.0, 0.45)))
    for _ in range(26):
        px, py = rng.uniform(0, NEAR_W), GROUND_Y + rng.uniform(2, 118)
        pen.line([(px, py), (px + rng.uniform(-70, 70), py + rng.uniform(-6, 10))],
                 fill=mix(hx("#1D1925"), hx(ROAD), 0.5), width=1.0)

    # ---------- quyosh yo'lagi (faqat yo'l ichida) ----------
    warm = Image.new("L", (W, vis * SS), 0)
    wd = ImageDraw.Draw(warm)
    for cx0, rr in ((392, 300), (1046, 340), (1712, 320), (2286, 290)):
        wd.ellipse([(cx0 - rr) * SS, -40 * SS, (cx0 + rr) * SS, (vis + 30) * SS],
                   fill=48)
    pen.paste(Image.new("RGB", (W, vis * SS), hx(SKY_HOT)), (0, GROUND_Y * SS),
              warm.filter(ImageFilter.GaussianBlur(40 * SS)))

    # ---------- ko'chalar / lyuklar (nosoz, pastel emas) ----------
    for (ly, a_) in ((614, 84), (646, 104), (682, 124)):
        depth = (ly - GROUND_Y) / 120.0
        col = mix(hx("#8E8496"), hx(ROAD), 1.0 - a_ / 200.0)
        x = -80.0
        while x < NEAR_W + 90:
            w = 62 + depth * 150 + rng.uniform(-22, 30)
            h = 3.0 + depth * 8.0
            gap = 46 + depth * 118 + rng.uniform(-14, 24)
            pen.rect(x, ly - h / 2 + rng.uniform(-1.5, 1.5), x + w,
                     ly + h / 2 + rng.uniform(-1.5, 1.5), fill=col)
            x += w + gap
    pen.rect(0, 603, NEAR_W, 606.4, fill=mix(hx("#8E8496"), hx(ROAD), 0.55))
    for lx in (218, 1042, 1930):
        ly, lr = GROUND_Y + rng.uniform(26, 96), rng.uniform(15, 24)
        pen.ellipse(lx - lr, ly - lr * 0.34, lx + lr, ly + lr * 0.34,
                    fill=mix(hx("#1E1926"), hx(ROAD), 0.75))
        pen.ellipse(lx - lr, ly - lr * 0.34, lx + lr, ly - lr * 0.34 + 2.2,
                    fill=mix(hx("#6A6076"), hx(ROAD), 0.62))

    # ---------- ko'lmaklar (aniqroq, kuchliroq aks-sado) ----------
    puddles = [(214, 668, 190, 40), (712, 700, 250, 46), (1210, 640, 160, 30),
               (1666, 686, 220, 42), (2178, 652, 176, 34)]
    pm = Image.new("L", (NEAR_W, vis))
    pmd = ImageDraw.Draw(pm)
    for (px, py, pw, ph) in puddles:
        pmd.ellipse([px - pw / 2, py - ph / 2, px + pw / 2, py + ph / 2], fill=255)
    pm = pm.resize((W, vis * SS), Image.BILINEAR).filter(
        ImageFilter.GaussianBlur(3.4 * SS))
    crisp = flip.filter(ImageFilter.GaussianBlur(0.9))
    crisp.putalpha(ImageChops.multiply(crisp.getchannel("A"),
                                       pm.point(lambda v: int(v * 0.95))))
    pen.img.alpha_composite(crisp.resize((W, vis * SS), Image.BILINEAR),
                            (0, GROUND_Y * SS))
    for (px, py, pw, ph) in puddles:
        pen.ellipse(px - pw / 2, py - ph / 2, px + pw / 2, py + ph / 2,
                    outline=mix(hx("#6A5E78"), hx(ROAD), 0.42), width=1.2)
        for _ in range(rng.randint(2, 4)):   # yomg'ir tomchilari halqalari
            rx = px + rng.uniform(-pw * 0.36, pw * 0.36)
            ry = py + rng.uniform(-ph * 0.3, ph * 0.3)
            rr = rng.uniform(5, 13)
            pen.ellipse(rx - rr, ry - rr * 0.28, rx + rr, ry + rr * 0.28,
                        outline=mix(hx("#8A7E96"), hx(ROAD), 0.55), width=0.9)

    # ---------- tomchilam + bordiur (ko'chaning uzoq chekkasi) ----------
    pcol = mix(hx("#463C4C"), sky_at(SIDE_TOP), 0.12)
    pen.rect(0, SIDE_TOP, NEAR_W, KERB_TOP, fill=pcol)
    for _ in range(int(NEAR_W / 5)):
        if rng.random() < 0.42:
            xx, yy = rng.uniform(0, NEAR_W), rng.uniform(SIDE_TOP + 2, KERB_TOP - 2)
            pen.rect(xx, yy, xx + rng.uniform(2, 7), yy + rng.uniform(1, 2.2),
                     fill=ramp(pcol, rng.uniform(0.82, 1.18)))
    for i in range(int(NEAR_W / 62)):
        pen.line([(i * 62, SIDE_TOP), (i * 62 - 3, KERB_TOP)],
                 fill=ramp(pcol, 0.86), width=1.1)
    pen.rect(0, SIDE_TOP, NEAR_W, SIDE_TOP + 2.6, fill=ramp(pcol, 1.42))
    kcol = mix(hx("#332C3A"), sky_at(KERB_TOP), 0.14)
    pen.rect(0, KERB_TOP, NEAR_W, GROUND_Y, fill=kcol)
    for i in range(int(NEAR_W / 58) + 1):
        pen.line([(i * 58, KERB_TOP + 1.5), (i * 58, GROUND_Y)],
                 fill=ramp(kcol, 0.78), width=1.2)
    pen.rect(0, KERB_TOP, NEAR_W, KERB_TOP + 2.2, fill=ramp(kcol, 1.7))
    pen.rect(0, GROUND_Y - 3.4, NEAR_W, GROUND_Y, fill=ramp(kcol, 0.55))

    # ---------- ko'cha chiroqlari ----------
    for (lx, lh, arm) in ((300, 292, -1), (1180, 268, 1), (2100, 300, -1)):
        gx, _ = street_lamp(pen, lx, 588, lh, rng, arm=arm)
        pen.glow(gx, GROUND_Y + 40, 150, hx(WIN), 0.24)
        n = 26                                   # uzun vertikal aks-sado
        for i in range(n):
            t = i / (n - 1)
            yy = GROUND_Y + 2 + t * 116
            w = 3.0 + t * 9.0
            jx = gx + math.sin(t * 7.0 + lx) * 4.5 * (0.3 + t)
            fx.rect(jx - w / 2, yy, jx + w / 2, yy + 6,
                    fill=mix(hx(WIN), hx(SKY_HOT), t * 0.6)[:3]
                    + (int(120 * (1 - t) ** 1.5),))
        pen.glow(gx, GROUND_Y + 18, 46, hx(WIN), 0.28)

    vending(pen, 902, 588, 44, 78)
    for i in range(22):                          # avtomat aks-sadosi
        t = i / 21
        yy = GROUND_Y + 1 + t * 104
        fx.rect(924 - 3 - t * 2, yy, 924 + 3 + t * 2, yy + 6,
                fill=mix(hx(WIN), hx(SKY_HOT), t)[:3]
                + (int(105 * (1 - t) ** 1.4),))
    tx, _ = traffic_light(pen, 1690, 588, 210)
    for i in range(20):                          # qizil chiroq aks-sadosi
        t = i / 19
        yy = GROUND_Y + 1 + t * 92
        fx.rect(tx - 2.5 - t * 1.5, yy, tx + 2.5 + t * 1.5, yy + 6,
                fill=mix(hx("#FF6A5A"), hx(SKY_MID), t)[:3]
                + (int(95 * (1 - t) ** 1.4),))
    for (px, cc) in ((652, "#C9524F"), (1348, "#6E3568"), (1962, "#4E86C6")):
        pen.rect(px, 534, px + 26, 568, fill=mix(hx(cc), hx("#B8B0A0"), 0.35))
        for i in range(4):
            pen.rect(px + 3, 538 + i * 7, px + 23, 540 + i * 7,
                     fill=mix(hx(cc), hx("#E8E2D6"), 0.5))
    bicycle(pen, 512, 584)
    bicycle(pen, 1866, 586)

    # ---------- old plandagi narxonal ----------
    rail = hx("#171320")
    for i in range(0, NEAR_W + 60, 44):
        x = i + rng.uniform(-5, 5)
        pen.rect(x, 700, x + 5, WORLD_H, fill=rail)
    pen.rect(0, 711, NEAR_W, WORLD_H, fill=rail)
    pen.rect(0, 692, NEAR_W, 699.5, fill=rail)
    pen.rect(0, 692, NEAR_W, 694.2, fill=ramp(rail, 2.6))

    # yarim-shaffof effektlar oxirida qo'shiladi (pastki 120 px opak qoladi)
    pen.img.alpha_composite(fx.img)
    return add_grain(bloom(pen.finish(), 190, 9.0, 0.52), rng, 12.0, 0.035)


# ============================================================================
# SAQLASH
# ============================================================================
T0 = time.perf_counter()


def save(img: Image.Image, name: str, blur: float, grain: float = 0.0) -> None:
    """Pen.finish() allaqachon final o'lchamga tushirgan — endi DOF + shovqin."""
    key = name[:-4]
    out = img
    if blur > 0:
        out = out.filter(ImageFilter.GaussianBlur(blur))
    if grain > 0:
        out = add_grain(out, random.Random(SEED + 90), 13.0, grain)
    path = OUT / name
    out.save(path, optimize=True)
    rel = path.relative_to(ROOT.parent)
    print(f"yozildi: {rel}  |  {out.size[0]}x{out.size[1]}  |  "
          f"parallax {PARALLAX[key]:.2f}  |  DOF {blur:.1f}px  |  "
          f"{path.stat().st_size / 1024:,.0f} KB  |  "
          f"{time.perf_counter() - T0:.1f}s")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    print("Karakura sahni yaratilmoqda...")

    sky = make_sky()
    save(sky, "sky.png", DOF["sky"], 0.07)

    far = make_far()
    save(far, "far.png", DOF["far"])

    mid = make_mid()
    save(mid, "mid.png", DOF["mid"])

    # aks-sado manbai: osmon + uzoq shahar + binolar
    bd = Image.alpha_composite(Image.alpha_composite(sky, far), mid)

    near = make_near(bd)
    save(near, "near.png", DOF["near"])

    print("Tayyor!")


if __name__ == "__main__":
    main()
