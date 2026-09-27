"""
rig.py — 2D skeletal character renderer (Pillow).

Belgilar kod bilan chiziladi: skelet (toshak) -> pozalar -> interpolyatsiya ->
supersampling (SS x kattalikda chizib LANCZOS bilan kichiklashtirish) ->
cel-shading (yorug'lik/shadow rim) -> kontur (outline).

Natija: PNG spritesheet + har bir animatsiya uchun hitbox/hurtbox ma'lumotlari.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from PIL import Image, ImageChops, ImageDraw, ImageFilter

# ----------------------------------------------------------------------------
# Global o'lchamlar
# ----------------------------------------------------------------------------
SS = 3  # supersampling koeffitsienti
# Kadr kengligi yetarli bo'lishi kerak: cho'zilgan zarba paytida palka pelvismasdan
# ~270px uzoqqa chiqadi (ichki 224 + 270 = 494 > 448 edi va palka kadrdan chiqib ketardi).
FRAME_W = 560
FRAME_H = 448
GROUND_Y = 404  # yerga tegish chizig'i (final px)
# Belgining markaziy nuqtasi (sprite o'qida) — dvigatel shunga moslashadi.
PELVIS_X = 280

# Skelet segment uzunliklari (final px)
RIG = {
    "spine": 88.0,   # pelvis -> ko'krak
    "neck": 15.0,    # ko'krak -> bo'yin
    "headOff": 27.0,  # bo'yin -> bosh markazi
    "headR": 28.0,   # bosh radiusi
    "hipW": 9.0,     # yonboshqar (pelvisdan qancha yon)
    "upper": 54.0,   # yelka -> tirnoq
    "fore": 48.0,    # tirnoq -> bilak
    "thigh": 66.0,   # son -> tizza
    "shin": 62.0,    # tizza -> oqcha
    "foot": 26.0,    # oqcha -> barmoq
}

# Skeletning eng pastki nuqtasi qanchalik pastda bo'lsa, u yerga tegadi
FOOT_R = 8.0
# Oddiy tik turish pozasi (yerga tushirish shundan olinadi)
STANCE = dict(
    torso=11.0, head=-2.0,
    armU=128.0, armF=34.0, armU2=152.0, armF2=58.0,
    thigh=152.0, shin=188.0, foot=182.0,
    thigh2=202.0, shin2=177.0, foot2=186.0,
    weaponA=-55.0,
)

# Boshlang'ich pelvis balandligi (avtomatik yerga tushirish uni to'g'rilaydi)
PELVIS_Y = 280.0


# ----------------------------------------------------------------------------
# Vektor yordamchilari
# ----------------------------------------------------------------------------
# burchak: 0 = yuqoriga (-y), 90 = o'ngga (+x), 180 = pastga, -90 = chapga
def polar(angle_deg: float, r: float) -> tuple[float, float]:
    a = math.radians(angle_deg)
    return (math.sin(a) * r, -math.cos(a) * r)


def add(p: tuple[float, float], d: tuple[float, float]) -> tuple[float, float]:
    return (p[0] + d[0], p[1] + d[1])


def sub(p: tuple[float, float], q: tuple[float, float]) -> tuple[float, float]:
    return (p[0] - q[0], p[1] - q[1])


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp_pt(a, b, t):
    return (lerp(a[0], b[0], t), lerp(a[1], b[1], t))


def smoothstep(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def rotate_pt(p, center, ang_deg: float):
    a = math.radians(ang_deg)
    ca, sa = math.cos(a), math.sin(a)
    dx, dy = p[0] - center[0], p[1] - center[1]
    return (center[0] + dx * ca - dy * sa, center[1] + dx * sa + dy * ca)


# ----------------------------------------------------------------------------
# Shakl chizish
# ----------------------------------------------------------------------------
# Chizish masshtabi: 1.0 = final px, SS = supersampling canvas'i uchun.
# Radiuslar va chiziq qalinliklari shu masshtabga avtomatik ko'payadi.
S = 1.0


def R(v: float) -> float:
    return v * S


def capsule(d: ImageDraw.ImageDraw, p0, p1, r0: float, r1: float, fill):
    """Konus shaklidagi kapsula (uzunligi va radiusi o'zgaradigan segment)."""
    r0, r1 = R(r0), R(r1)
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    ln = math.hypot(dx, dy)
    if ln < 1e-6:
        d.ellipse([p0[0] - r0, p0[1] - r0, p0[0] + r0, p0[1] + r0], fill=fill)
        return
    px, py = -dy / ln, dx / ln
    quad = [
        (p0[0] + px * r0, p0[1] + py * r0),
        (p1[0] + px * r1, p1[1] + py * r1),
        (p1[0] - px * r1, p1[1] - py * r1),
        (p0[0] - px * r0, p0[1] - py * r0),
    ]
    d.polygon(quad, fill=fill)
    d.ellipse([p0[0] - r0, p0[1] - r0, p0[0] + r0, p0[1] + r0], fill=fill)
    d.ellipse([p1[0] - r1, p1[1] - r1, p1[0] + r1, p1[1] + r1], fill=fill)


def ellipse_rot(d, c, rx: float, ry: float, ang: float, fill):
    rx, ry = R(rx), R(ry)
    pts = []
    for i in range(28):
        a = i / 28 * math.tau
        pts.append((c[0] + math.cos(a) * rx, c[1] + math.sin(a) * ry))
    d.polygon([rotate_pt(p, c, ang) for p in pts], fill=fill)


def ellipse(d, c, rx: float, ry: float, fill):
    rx, ry = R(rx), R(ry)
    d.ellipse([c[0] - rx, c[1] - ry, c[0] + rx, c[1] + ry], fill=fill)


def capsule_points(p0, p1, r0: float, r1: float):
    """Kapsulani nuqtalar ro'yxatiga aylantiradi (silhuet maskasi uchun)."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    ln = math.hypot(dx, dy)
    if ln < 1e-6:
        return [(p0[0] + math.cos(i / 20 * math.tau) * r0,
                 p0[1] + math.sin(i / 20 * math.tau) * r0) for i in range(20)]
    px, py = -dy / ln, dx / ln
    steps = 10
    pts = []
    # p1 yarim doirasi
    base = math.degrees(math.atan2(dy, dx))
    for i in range(steps + 1):
        a = math.radians(base - 90 + 180 * i / steps)
        pts.append((p1[0] + math.cos(a) * r1, p1[1] + math.sin(a) * r1))
    # p0 yarim doirasi
    for i in range(steps + 1):
        a = math.radians(base + 90 + 180 * i / steps)
        pts.append((p0[0] + math.cos(a) * r0, p0[1] + math.sin(a) * r0))
    _ = px, py
    return pts


# ----------------------------------------------------------------------------
# Poz (pose)
# ----------------------------------------------------------------------------
POSE_DEFAULTS: dict[str, float] = {
    "torso": 11.0,    # tana og'ishi
    "head": -2.0,     # bosh og'ishi
    "armU": 128.0,    # oldingi yelka burchagi
    "armF": 34.0,     # oldingi bilak burchagi
    "armU2": 152.0,   # orqadagi yelka
    "armF2": 58.0,    # orqadagi bilak
    "thigh": 152.0,   # oldingi son
    "shin": 188.0,    # oldingi oyoq
    "foot": 182.0,
    "thigh2": 202.0,  # orqadagi son
    "shin2": 177.0,   # orqadagi oyoq
    "foot2": 186.0,
    "bodyRot": 0.0,   # butun skelet pelvis atrofida aylanadi
    "offsetX": 0.0,   # butun skelet siljishi
    "offsetY": 0.0,   # qo'shimcha vertikal siljish (sakrash, cho'kish)
    "weaponA": -55.0,  # qurol burchagi (bilak davomida)
    "weaponAbs": None, # agar berilgan bo'lsa — MUTLAQ burchak (0=yuqori, 90=o'ngga)
    "weaponS": 1.0,   # qurol masshtabi
    "crouch": 0.0,    # eskirgan — endi oyoq burchaklari orqali beriladi
    "hairSway": 0.0,  # soch tebranishi (px)
    "squash": 1.0,    # vertikal siqilish (1 = normal)
    "eyes": 0.0,      # 0=oddiy, 1=yopiq, 2=yorqin (Bankai)
}

POSE_KEYS = list(POSE_DEFAULTS.keys())


def make_pose(**kw) -> dict[str, float]:
    p = dict(POSE_DEFAULTS)
    p.update(kw)
    return p


def blend_pose(a: dict, b: dict, t: float) -> dict:
    e = smoothstep(t)
    out = {}
    for k in POSE_KEYS:
        if k == "weaponAbs":
            out[k] = _blend_angle_abs(a, b, e)
        elif k == "eyes":
            out[k] = a.get(k, 0.0) if e < 0.5 else b.get(k, 0.0)
        elif k == "weaponS":
            out[k] = lerp(a.get(k, 1.0), b.get(k, 1.0), e)
        else:
            out[k] = lerp(a.get(k, 0.0), b.get(k, 0.0), e)
    return out


def _abs_angle(p: dict) -> float:
    """Pozning palka burchagini MUTLAQ burchakka (0=yuqori, 90=o'ngga) keltiradi."""
    w = p.get("weaponAbs")
    if w is not None:
        return float(w)
    return float(p.get("armF", 34.0)) + 180.0 + float(p.get("weaponA", -55.0))


def _blend_angle_abs(a: dict, b: dict, e: float) -> float | None:
    if a.get("weaponAbs") is None and b.get("weaponAbs") is None:
        return None
    return lerp(_abs_angle(a), _abs_angle(b), e)


# ----------------------------------------------------------------------------
# Skelet hisoblash
# ----------------------------------------------------------------------------
@dataclass
class Skeleton:
    pelvis: tuple = (0.0, 0.0)
    chest: tuple = (0.0, 0.0)
    neck: tuple = (0.0, 0.0)
    head: tuple = (0.0, 0.0)
    headA: float = 0.0
    sh: tuple = (0.0, 0.0)      # oldingi yelka
    elbow: tuple = (0.0, 0.0)
    wrist: tuple = (0.0, 0.0)
    sh2: tuple = (0.0, 0.0)     # orqadagi yelka
    elbow2: tuple = (0.0, 0.0)
    wrist2: tuple = (0.0, 0.0)
    hip: tuple = (0.0, 0.0)     # oldingi son (yonboshqar)
    knee: tuple = (0.0, 0.0)
    ankle: tuple = (0.0, 0.0)
    toe: tuple = (0.0, 0.0)
    hip2: tuple = (0.0, 0.0)    # orqadagi son
    knee2: tuple = (0.0, 0.0)
    ankle2: tuple = (0.0, 0.0)
    toe2: tuple = (0.0, 0.0)
    weaponA: float = 0.0
    muzzle: tuple = (0.0, 0.0)
    anchor: tuple = (0.0, 0.0)


# Skeletdagi barcha nuqta maydonlari
_JOINTS = ("pelvis", "chest", "neck", "head", "sh", "elbow", "wrist",
           "sh2", "elbow2", "wrist2", "hip", "knee", "ankle", "toe",
           "hip2", "knee2", "ankle2", "toe2", "muzzle", "anchor")


def compute_skeleton(pose: dict) -> Skeleton:
    """Pozdan skelet quradi va oyoqlarni AVTOMATIK yerga tushiradi.

    Bu nima beradi: oyoq burchaklarini o'zgartirsangiz (masalan cho'kish),
    bosh va tana o'z-o'zidan pastga tushadi, oyoq esa yerga tegib turaveradi.
    """
    r = RIG
    sq = pose.get("squash", 1.0)

    px = PELVIS_X + pose.get("offsetX", 0.0)
    py = PELVIS_Y  # keyin avtomatik tuzatiladi

    pelvis = (px, py)
    t = pose.get("torso", 11.0) * sq
    hd = pose.get("head", -2.0)

    chest = add(pelvis, polar(t, r["spine"] * sq))
    neck = add(chest, polar(t, r["neck"] * sq))
    head = add(neck, polar(hd, r["headOff"] * sq))

    sh = add(chest, polar(t - 8, 6))
    sh2 = add(chest, polar(t + 10, 6))
    elbow = add(sh, polar(pose.get("armU", 128.0), r["upper"] * sq))
    wrist = add(elbow, polar(pose.get("armF", 34.0), r["fore"] * sq))
    elbow2 = add(sh2, polar(pose.get("armU2", 152.0), r["upper"] * sq))
    wrist2 = add(elbow2, polar(pose.get("armF2", 58.0), r["fore"] * sq))

    hip = add(pelvis, polar(160, r["hipW"]))
    hip2 = add(pelvis, polar(200, r["hipW"]))
    knee = add(hip, polar(pose.get("thigh", 152.0), r["thigh"] * sq))
    ankle = add(knee, polar(pose.get("shin", 188.0), r["shin"] * sq))
    toe = add(ankle, polar(pose.get("foot", 182.0), r["foot"]))
    knee2 = add(hip2, polar(pose.get("thigh2", 202.0), r["thigh"] * sq))
    ankle2 = add(knee2, polar(pose.get("shin2", 177.0), r["shin"] * sq))
    toe2 = add(ankle2, polar(pose.get("foot2", 186.0), r["foot"]))

    wA = _abs_angle(pose)
    muzzle = add(wrist, polar(wA, 150.0 * pose.get("weaponS", 1.0)))

    sk = Skeleton(
        pelvis=pelvis, chest=chest, neck=neck, head=head, headA=hd,
        sh=sh, elbow=elbow, wrist=wrist,
        sh2=sh2, elbow2=elbow2, wrist2=wrist2,
        hip=hip, knee=knee, ankle=ankle, toe=toe,
        hip2=hip2, knee2=knee2, ankle2=ankle2, toe2=toe2,
        weaponA=wA, muzzle=muzzle,
        anchor=(px, GROUND_Y),
    )

    rot = pose.get("bodyRot", 0.0)
    if abs(rot) > 1e-4:
        for name in ("chest", "neck", "head", "sh", "elbow", "wrist",
                     "sh2", "elbow2", "wrist2", "hip", "knee", "ankle", "toe",
                     "hip2", "knee2", "ankle2", "toe2", "muzzle"):
            setattr(sk, name, rotate_pt(getattr(sk, name), pelvis, rot))
        sk.headA += rot
        sk.weaponA += rot

    # --- avtomatik yerga tushirish ---
    # Oyoqlar VA tana yadrosi hisobga olinadi: tik turishda eng pastda oyoq
    # bo'ladi, yotganda esa tana — shu sabab yotgan belgi yerga botib ketmaydi.
    # Qurol hisobga OLMAYdi (pastga tushirilgan zarba belgini ko'tarib yubormasligi kerak).
    lows = [
        sk.toe[1] + FOOT_R, sk.toe2[1] + FOOT_R,
        sk.ankle[1] + FOOT_R, sk.ankle2[1] + FOOT_R,
        sk.pelvis[1] + 24.0, sk.chest[1] + 27.0,
        sk.head[1] + RIG["headR"], sk.neck[1] + 13.0,
        sk.knee[1] + 15.0, sk.knee2[1] + 15.0,
        sk.elbow[1] + 11.0, sk.elbow2[1] + 11.0,
        sk.wrist[1] + 9.0, sk.wrist2[1] + 9.0,
    ]
    dy = (GROUND_Y - max(lows)) + pose.get("offsetY", 0.0)
    for name in _JOINTS:
        p = getattr(sk, name)
        setattr(sk, name, (p[0], p[1] + dy))
    return sk


def scale_skeleton(sk: Skeleton, s: float) -> Skeleton:
    """Skeletni `s` barobar kattalashtiradi (supersampling uchun)."""
    for name in _JOINTS:
        p = getattr(sk, name)
        setattr(sk, name, (p[0] * s, p[1] * s))
    return sk


# ----------------------------------------------------------------------------
# Belgi ta'riflari
# ----------------------------------------------------------------------------
@dataclass
class Character:
    key: str
    name: str
    skin: str
    skin_shade: str
    hair: str
    hair_light: str
    hair_style: str = "spiky"       # spiky | flat
    top: str = "#14121A"            # ustki kiyim
    top_light: str = "#2A2733"
    trim: str = "#E8E4DC"           # chetlar
    pants: str = "#1A1822"
    pants_light: str = "#2C2938"
    sash: str = "#F2802A"
    shoe: str = "#1E1B26"
    eye: str = "#E8A33C"
    blade: str = "#15131C"
    blade_light: str = "#3A3747"
    blade_edge: str = "#D9DDE6"
    weapon: str = "sword"           # sword | none
    weapon_len: float = 150.0
    weapon_w: float = 30.0
    sleeves: bool = False           # yeng bilan yopiq qo'l (kapiton)
    coat: bool = False              # uzun kapiton (pastga tushadigan)
    sukuna: bool = False            # Aizen orqasidagi su'kuna
    sukuna_col: str = "#D8D0C0"
    aura: str = "#F2802A"


WHITE = (255, 255, 255, 255)


def _c(hexstr: str, a: int = 255):
    hexstr = hexstr.lstrip("#")
    return (int(hexstr[0:2], 16), int(hexstr[2:4], 16), int(hexstr[4:6], 16), a)


def paint_for(ch: Character, mono: bool):
    if mono:
        w = WHITE
        return dict(skin=w, skin_shade=w, hair=w, hair_light=w, top=w,
                    top_light=w, trim=w, pants=w, pants_light=w, sash=w,
                    eye=w, blade=w, blade_light=w, blade_edge=w, sukuna=w,
                    shoe=w, ink=(0, 0, 0, 0))
    return dict(
        skin=_c(ch.skin), skin_shade=_c(ch.skin_shade),
        hair=_c(ch.hair), hair_light=_c(ch.hair_light),
        top=_c(ch.top), top_light=_c(ch.top_light), trim=_c(ch.trim),
        pants=_c(ch.pants), pants_light=_c(ch.pants_light), sash=_c(ch.sash),
        shoe=_c(ch.shoe), eye=_c(ch.eye), blade=_c(ch.blade),
        blade_light=_c(ch.blade_light), blade_edge=_c(ch.blade_edge),
        sukuna=_c(ch.sukuna_col, 235), ink=_c("#000000", 0),
    )


# ----------------------------------------------------------------------------
# Soch
# ----------------------------------------------------------------------------
def draw_hair(d, ch: Character, sk: Skeleton, pal, sway: float):
    hc = sk.head
    ha = sk.headA
    r = R(RIG["headR"])
    # soch qatlami bosh ustida
    base_a = ha - 178  # yuqoriga qaragan

    if ch.hair_style == "spiky":
        # Ichigo: o'tkir va ko'p uchli soch
        spikes = [
            (-95, 46, 15), (-72, 40, 13), (-50, 34, 12), (-30, 27, 11),
            (6, 20, 10), (-118, 40, 14), (-138, 30, 12),
            (22, 15, 9), (-8, 24, 10),
        ]
        # bosh ustki qalqon
        cap = []
        for i in range(20):
            a = math.radians(ha - 180 - 82 + 164 * i / 19)
            cap.append((hc[0] + math.cos(a) * (r * 1.16), hc[1] + math.sin(a) * (r * 1.16)))
        d.polygon(cap, fill=pal["hair"])
        for ang, ln, wd in spikes:
            a0 = math.radians(ha + ang)
            a1 = math.radians(ha + ang * 0.45)
            # uch uchli
            tip = (hc[0] + math.cos(a0) * R(ln) + R(sway * 0.5),
                   hc[1] + math.sin(a0) * R(ln) - R(4))
            l = (hc[0] + math.cos(a1) * r * 1.2, hc[1] + math.sin(a1) * r * 1.2)
            rr = (hc[0] + math.cos(a1 - 0.42) * r * 0.9, hc[1] + math.sin(a1 - 0.42) * r * 0.9)
            d.polygon([l, tip, rr], fill=pal["hair"])
        # yorug'lik
        hl = []
        for i in range(14):
            a = math.radians(ha - 180 - 62 + 110 * i / 13)
            hl.append((hc[0] + math.cos(a) * (r * 1.18), hc[1] + math.sin(a) * (r * 1.18)))
        for i in range(13, -1, -1):
            a = math.radians(ha - 180 - 62 + 110 * i / 13)
            hl.append((hc[0] + math.cos(a) * (r * 0.86), hc[1] + math.sin(a) * (r * 0.86)))
        if len(hl) > 3:
            d.polygon(hl, fill=pal["hair_light"])
    else:
        # Aizen: tekis, yassi tepali, yon tolalari bor
        top_w = r * 1.34
        top_y = r * 0.92
        pts = [
            (hc[0] - top_w, hc[1] - top_y * 0.30),
            (hc[0] - top_w * 0.86, hc[1] - top_y * 0.92),
            (hc[0] - top_w * 0.34, hc[1] - top_y * 1.24),
            (hc[0] + top_w * 0.40, hc[1] - top_y * 1.24),
            (hc[0] + top_w * 0.94, hc[1] - top_y * 0.86),
            (hc[0] + top_w * 1.04, hc[1] - top_y * 0.10),
            (hc[0] + top_w * 0.72, hc[1] - top_y * 0.52),
            (hc[0] - top_w * 0.60, hc[1] - top_y * 0.52),
        ]
        d.polygon([rotate_pt(p, hc, ha) for p in pts], fill=pal["hair"])
        # yon tolalar (quloqqa tushadi)
        for s in (-1, 1):
            p1 = (hc[0] + s * top_w * 0.92, hc[1] - top_y * 0.16)
            p2 = (hc[0] + s * top_w * 0.78, hc[1] + r * 0.98)
            p3 = (hc[0] + s * top_w * 0.30, hc[1] + r * 1.16)
            p4 = (hc[0] + s * top_w * 0.40, hc[1] + r * 0.10)
            d.polygon([rotate_pt(p, hc, ha) for p in (p1, p2, p3, p4)],
                      fill=pal["hair"])
        # yorug'lik
        hl = [
            (hc[0] - top_w * 0.80, hc[1] - top_y * 0.30),
            (hc[0] - top_w * 0.62, hc[1] - top_y * 0.80),
            (hc[0] + top_w * 0.30, hc[1] - top_y * 1.00),
            (hc[0] + top_w * 0.30, hc[1] - top_y * 0.74),
            (hc[0] - top_w * 0.58, hc[1] - top_y * 0.54),
        ]
        d.polygon([rotate_pt(p, hc, ha) for p in hl], fill=pal["hair_light"])
    _ = base_a


# ----------------------------------------------------------------------------
# Yuz
# ----------------------------------------------------------------------------
def draw_face(d, ch: Character, sk: Skeleton, pal, eyes_closed: bool = False,
              eyes_glow: bool = False):
    hc, ha, r = sk.head, sk.headA, R(RIG["headR"])
    fx = 0.30  # yuz o'qi (o'ngga qaragan)
    eye_dx = r * 0.44
    eye_dy = -r * 0.16
    for s, sc in ((1, 1.0), (-1, 0.86)):
        e = (hc[0] + s * eye_dx * fx * 1.6, hc[1] + eye_dy * 0.55)
        e = rotate_pt(e, hc, 0)
        if eyes_closed:
            d.line([(e[0] - R(6), e[1]), (e[0] + R(6), e[1])],
                   fill=pal["ink"] or (0, 0, 0, 255), width=int(R(3)))
            continue
        if eyes_glow:
            d.ellipse([e[0] - R(11), e[1] - R(9), e[0] + R(11), e[1] + R(9)],
                      fill=(255, 236, 170, 90))
        ellipse_rot(d, e, 7.2 * sc, 5.4 * sc, ha * 0.3, pal["skin_shade"])
        ellipse_rot(d, e, 5.6 * sc, 4.0 * sc, ha * 0.3, (250, 250, 252, 255))
        ellipse_rot(d, e, 3.2 * sc, 3.8 * sc, ha * 0.3, pal["eye"])
        ellipse_rot(d, (e[0] + R(1.2), e[1] - R(0.6)), 1.1, 1.3, 0, (20, 16, 24, 255))
        if eyes_glow:
            ellipse_rot(d, e, 1.5, 1.5, 0, (255, 255, 255, 255))
        # qosh
        brow = rotate_pt((e[0] - R(8), e[1] - R(7.5)), hc, 0)
        brow2 = rotate_pt((e[0] + R(8), e[1] - R(9.5)), hc, 0)
        tilt = -R(3.0) if eyes_glow else 0.0
        d.line([(brow[0], brow[1] + tilt), (brow2[0], brow2[1] - tilt)],
               fill=pal["hair"], width=int(R(4)))
    # og'iz
    m = rotate_pt((hc[0] + r * 0.30, hc[1] + r * 0.44), hc, 0)
    d.line([(m[0] - R(5), m[1]), (m[0] + R(6), m[1] + R(1))],
           fill=pal["skin_shade"], width=int(R(2.4)))


# ----------------------------------------------------------------------------
# Asosiy belgi chizuvchi
# ----------------------------------------------------------------------------
def draw_character(d: ImageDraw.ImageDraw, ch: Character, sk: Skeleton,
                   pose: dict, mono: bool = False, eyes_closed: bool = False,
                   weapon_draw: bool = True, eyes_glow: bool = False):
    pal = paint_for(ch, mono)
    sway = pose.get("hairSway", 0.0)

    def limb(a, b, r0, r1, col):
        capsule(d, a, b, r0, r1, col)

    # --- orqa qo'l (uzoq) ---
    far_sleeve = pal["top"] if (ch.sleeves and not mono) else pal["skin"]
    limb(sk.sh2, sk.elbow2, 14.0, 10.5, far_sleeve)
    if ch.sleeves and not mono:
        capsule(d, sk.elbow2, (sk.elbow2[0] + (sk.wrist2[0] - sk.elbow2[0]) * 0.42,
                               sk.elbow2[1] + (sk.wrist2[1] - sk.elbow2[1]) * 0.42),
                11.5, 10.0, far_sleeve)
    limb(sk.elbow2, sk.wrist2, 10.5, 7.5, pal["skin"])
    ellipse_rot(d, sk.wrist2, 8.5, 7.5, 0, pal["skin"])

    # --- orqa oyoq ---
    limb(sk.hip2, sk.knee2, 22.0, 14.5, pal["pants"])
    limb(sk.knee2, sk.ankle2, 14.0, 9.5, pal["pants"])
    draw_shoe(d, sk.ankle2, sk.toe2, pal)

    # --- kapiton (sonsiz to'g'on, sonra yengil kengayadi) ---
    if ch.coat and not mono:
        bot_y = sk.pelvis[1] + R(52)
        d.polygon([
            (sk.chest[0] - R(22), sk.chest[1] - R(4)),
            (sk.chest[0] + R(15), sk.chest[1] - R(12)),
            (sk.pelvis[0] + R(26), bot_y),
            (sk.pelvis[0] - R(25), bot_y),
            (sk.chest[0] - R(26), sk.chest[1] + R(12)),
        ], fill=pal["top"])
        # kapiton soyasi (orqa chekka)
        d.polygon([
            (sk.chest[0] - R(22), sk.chest[1] - R(4)),
            (sk.chest[0] - R(6), sk.chest[1] - R(9)),
            (sk.pelvis[0] - R(4), bot_y),
            (sk.pelvis[0] - R(25), bot_y),
            (sk.chest[0] - R(26), sk.chest[1] + R(12)),
        ], fill=pal["top_light"])

    # --- tana ---
    capsule(d, sk.pelvis, sk.chest, 23.0, 31.0, pal["top"])
    # yelka yassi qismi
    capsule(d, (sk.chest[0] - R(8), sk.chest[1] + R(6)),
            (sk.sh[0] + R(6), sk.sh[1] + R(2)), 16.0, 14.0, pal["top"])
    # ustki kiyim chetlari
    if not mono:
        capsule(d, (sk.chest[0] - R(15), sk.chest[1] + R(4)),
                (sk.pelvis[0] - R(7), sk.pelvis[1] + R(10)), 14.0, 17.0, pal["top_light"])
    # belbog'
    capsule(d, (sk.pelvis[0], sk.pelvis[1] - R(2)),
            (sk.pelvis[0] + R(3), sk.pelvis[1] + R(14)), 24.0, 21.0, pal["sash"])
    if not mono:
        capsule(d, (sk.pelvis[0] - R(2), sk.pelvis[1] + R(2)),
                (sk.pelvis[0] + R(2), sk.pelvis[1] + R(8)), 25.0, 24.0, pal["top_light"])

    # --- oldingi oyoq ---
    limb(sk.hip, sk.knee, 23.0, 15.0, pal["pants"])
    limb(sk.knee, sk.ankle, 15.0, 10.0, pal["pants"])
    draw_shoe(d, sk.ankle, sk.toe, pal)

    # --- su'kuna (Aizen) — o'rta orqadan chiqadigan suyak ---
    if ch.sukuna and not mono:
        d.polygon([
            (sk.chest[0] - R(10), sk.chest[1] + R(16)),
            (sk.chest[0] - R(56), sk.chest[1] + R(2)),
            (sk.chest[0] - R(44), sk.chest[1] - R(12)),
            (sk.chest[0] - R(6), sk.chest[1] + R(2)),
        ], fill=pal["sukuna"])

    # --- bosh ---
    ellipse_rot(d, sk.head, RIG["headR"] * 0.92, RIG["headR"] * 1.02, sk.headA, pal["skin"])
    # bo'yin
    capsule(d, sk.neck, (sk.head[0], sk.head[1] + R(RIG["headR"] * 0.72)), 11.0, 12.0, pal["skin_shade"])
    draw_face(d, ch, sk, pal, eyes_closed, eyes_glow)
    draw_hair(d, ch, sk, pal, sway)

    # --- oldingi qo'l ---
    if ch.sleeves and not mono:
        limb(sk.sh, sk.elbow, 15.0, 12.0, pal["top"])
        capsule(d, sk.elbow, (sk.elbow[0] + (sk.wrist[0] - sk.elbow[0]) * 0.45,
                              sk.elbow[1] + (sk.wrist[1] - sk.elbow[1]) * 0.45),
                12.5, 11.0, pal["top"])
    else:
        limb(sk.sh, sk.elbow, 15.0, 11.5, pal["skin"])
    limb(sk.elbow, sk.wrist, 11.5, 8.0, pal["skin"])
    ellipse_rot(d, sk.wrist, 9.0, 8.0, 0, pal["skin"])

    # --- qurol ---
    if ch.weapon == "sword" and weapon_draw:
        draw_sword(d, ch, sk, pal, mono)
    return pal


def draw_shoe(d, ankle, toe, pal):
    """Oyoq kiyim (geta) — barmoq tomon qarab cho'zilib turadi."""
    dx, dy = toe[0] - ankle[0], toe[1] - ankle[1]
    ln = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / ln, dx / ln
    a = (ankle[0], ankle[1])
    b = (toe[0], toe[1])
    # orqadigan uchi balandroq (poyabzal tovonigining ko'tarilishi)
    heel = (a[0] - R(8) + nx * R(2), a[1] - R(9) + ny * R(2))
    tip = (b[0] + dx / ln * R(7), b[1] + dy / ln * R(7))
    pts = [
        (heel[0] + nx * R(11), heel[1] + ny * R(11)),
        (a[0] + nx * R(12), a[1] + ny * R(12)),
        (b[0] + nx * R(10), b[1] + ny * R(10)),
        (tip[0], tip[1]),
        (b[0] - nx * R(10), b[1] - ny * R(10)),
        (heel[0] - nx * R(11), heel[1] - ny * R(11)),
    ]
    d.polygon(pts, fill=pal["shoe"] if pal.get("shoe") else pal["trim"])


def draw_sword(d, ch: Character, sk: Skeleton, pal, mono: bool):
    """Zangetsu — katta o'chli qilich. Qo'l bilan birga harakatlanadi."""
    w0 = sk.wrist
    a = sk.weaponA
    L = ch.weapon_len
    hw = ch.weapon_w

    def P(x, y):
        """Mahalliy koordinata (x = palka bo'ylab, y = kesuvchi tomonga) -> canvas.

        `polar` kompas konvensiyasini ishlatadi (0 = yuqori), shuning uchun
        mahalliy o'q ham shu konvensiyada quriladi.
        """
        ang = math.radians(a)
        x, y = R(x), R(y)
        dx, dy = math.sin(ang), -math.cos(ang)   # palka yo'nalishi (mahalliy +x)
        px, py = math.cos(ang), math.sin(ang)    # mahalliy +y
        return (w0[0] + x * dx + y * px, w0[1] + x * dy + y * py)

    # dastlik (o'ralgan)
    hilt = [P(-40, -5), P(-6, -6), P(-6, 6), P(-40, 5)]
    d.polygon(hilt, fill=pal["top_light"] if not mono else pal["blade"])
    for i in range(4):
        x = -36 + i * 9
        d.line([P(x, -6), P(x + 5, 6)], fill=pal["sash"] if not mono else pal["blade"],
               width=int(R(2.2)))
    # gard
    d.polygon([P(-8, -11), P(4, -9), P(4, 9), P(-8, 11)], fill=pal["trim"] if not mono else pal["blade"])
    # palka (asoz) — orqaga qaragan, biroz pastga
    d.polygon([P(-6, 7), P(-14, 30), P(-20, 29), P(-13, 6)],
              fill=pal["top_light"] if not mono else pal["blade"])
    # tilim — orqa qirra tekis, kesuvchi qirra egilgan, uchi "qaziq" shaklida
    N = 12
    back, edge = [], []
    for i in range(N + 1):
        u = i / N
        back.append(P(2 + (L - 2) * u, -hw * 0.54 - math.sin(u * 2.2) * hw * 0.20))
        edge.append(P(2 + L * 0.86 * u, hw * 0.62 + math.sin(u * 1.4) * hw * 0.26))
    d.polygon(back + list(reversed(edge)), fill=pal["blade"])
    # kesuvchi qirra yorug'ligi — tor, faqat kesuvchi tomonda
    if not mono:
        hi = []
        for i in range(N + 1):
            u = i / N
            hi.append(P(2 + L * 0.86 * u, hw * 0.62 + math.sin(u * 1.4) * hw * 0.26))
        for i in range(N, -1, -1):
            u = i / N
            hi.append(P(2 + L * 0.86 * u, hw * 0.30 + math.sin(u * 1.4) * hw * 0.22))
        d.polygon(hi, fill=pal["blade_edge"])
        # palka ichidagi yorug'lik
        hl = [P(2 + (L - 2) * u, -hw * 0.46 - math.sin(u * 2.2) * hw * 0.17) for u in
              (0, 0.25, 0.5, 0.72, 0.9, 1.0)]
        hl += [P(2 + (L - 2) * u, -hw * 0.20 - math.sin(u * 2.2) * hw * 0.12) for u in
               (1.0, 0.9, 0.72, 0.5, 0.25, 0)]
        d.polygon(hl, fill=pal["blade_light"])


# ----------------------------------------------------------------------------
# Kadrlarni render qilish
# ----------------------------------------------------------------------------
LIGHT = (250, 250, 255, 88)      # yuqori-chapdan
SHADE = (10, 8, 24, 118)          # pastki-o'ngdan
INK = (14, 11, 22, 255)           # kontur


def _shift_alpha(mask: Image.Image, dx: int, dy: int) -> Image.Image:
    out = Image.new("L", mask.size, 0)
    out.paste(mask, (dx, dy))
    return out


def render_pose(ch: Character, pose: dict, *, eyes: int = 0,
                aura: str | None = None, fx: str | None = None) -> Image.Image:
    """Pozni render qilib yakuniy PNG (FRAME_W x FRAME_H) qaytaradi.

    `eyes`: 0 = oddiy, 1 = yopiq, 2 = yorqin (Bankai).
    """
    global S
    S = float(SS)
    W, H = FRAME_W * SS, FRAME_H * SS
    sk = scale_skeleton(compute_skeleton(pose), float(SS))

    sil = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d_sil = ImageDraw.Draw(sil)
    draw_character(d_sil, ch, sk, pose, mono=True)

    body = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d_body = ImageDraw.Draw(body)
    draw_character(d_body, ch, sk, pose, mono=False,
                   eyes_closed=(eyes == 1), eyes_glow=(eyes == 2))

    alpha = sil.getchannel("A")

    # --- cel-shading: faqat CHETLARDA (rim) yorug'lik/soqirt ---
    def tint(body_img: Image.Image, mask: Image.Image, col) -> Image.Image:
        """mask qayeri to'q bo'lsa, ustiga `col` rangini (alpha bo'yicha) qo'yadi."""
        layer = Image.new("RGBA", (W, H), col)
        layer.putalpha(mask)
        return Image.alpha_composite(body_img, layer)

    # yorug'lik: yuqori-chap chekka — "yuqoriga siljigan" soxta maskaning YO'Q joylari
    sh_dx, sh_dy = int(3.0 * SS), int(2.0 * SS)
    sh_mask = ImageChops.subtract(alpha, _shift_alpha(alpha, -sh_dx, -sh_dy))
    body = tint(body, sh_mask, SHADE)

    hl_dx, hl_dy = int(3.2 * SS), int(3.2 * SS)
    hl_mask = ImageChops.subtract(alpha, _shift_alpha(alpha, hl_dx, hl_dy))
    body = tint(body, hl_mask, LIGHT)

    # --- kontur (silhuetni kengaytirib, ichkarisini olib tashlash) ---
    # 2*SS+3 = 9 -> SS=3 da har tomondan 4px (final 1.3px) kengaytiradi
    dil = alpha.filter(ImageFilter.MaxFilter(2 * SS + 3))
    ink_mask = ImageChops.subtract(dil, alpha)
    body = tint(body, ink_mask, INK)

    # --- effektlar (aura / zarba izi) ---
    if aura or fx:
        body = draw_effects(body, ch, sk, pose, aura, fx)

    return body.resize((FRAME_W, FRAME_H), Image.LANCZOS)


def draw_effects(img: Image.Image, ch: Character, sk: Skeleton, pose: dict,
                 aura: str | None, fx: str | None) -> Image.Image:
    """Aura (Bankai) va zarba izi (slash) effektlarini qo'shadi.

    DIQQAT: `sk` allaqachon SS barobar kattalashtirilgan, shuning uchun
    joylashuvlarga yana SS ko'paytirilmaydi.
    """
    W, H = img.size
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)

    if aura:
        # olov tili: pelvis atrofidan yuqoriga, egilgan "tilak"lar
        bx0, by0 = sk.pelvis
        for i in range(20):
            t = i / 19
            ang = -180 + 360 * t
            bell = math.sin(t * math.pi) ** 0.6
            rr = (58 + 60 * bell) * SS
            bx = bx0 + math.cos(math.radians(ang)) * rr * 1.0
            by = by0 + math.sin(math.radians(ang)) * rr * 0.40 - 20 * SS
            h = (44 + 150 * bell) * SS
            w = (11 + 10 * bell) * SS
            # egilgan tilak
            tipx = bx + math.cos(math.radians(ang)) * w * 2.4
            d.polygon([(bx - w, by), (bx + w * 0.4, by - h * 0.35),
                       (tipx, by - h), (bx + w * 1.1, by - h * 0.4),
                       (bx + w, by)], fill=_c(aura, 150))
            d.polygon([(bx - w * 0.4, by - h * 0.10), (bx + w * 0.1, by - h * 0.55),
                       (tipx * 0.6 + bx * 0.4, by - h * 0.72),
                       (bx + w * 0.5, by - h * 0.30)], fill=_c("#FFFFFF", 110))
        # yerga yotgan nur
        d.ellipse([bx0 - 150 * SS, by0 + 112 * SS, bx0 + 150 * SS, by0 + 152 * SS],
                  fill=_c(aura, 80))
        # palka bo'ylab yorug'lik
        d.line([sk.chest, sk.wrist], fill=_c("#FFFFFF", 90), width=int(5 * SS))
        d.line([sk.wrist, sk.muzzle], fill=_c("#FFFFFF", 70), width=int(4 * SS))

    if fx == "slash":
        # palka yo'lida o'tgan ingichka, yorqin yarimoy iz
        cx = (sk.chest[0] + sk.wrist[0]) * 0.5
        cy = (sk.chest[1] + sk.wrist[1]) * 0.5
        a0 = math.radians(sk.weaponA)
        L = ch.weapon_len * SS * 1.18
        for span, r_in, r_out, al in ((-1.00, 0.90, 1.00, 90),
                                      (-0.80, 0.72, 0.94, 150),
                                      (-0.56, 0.58, 0.88, 225)):
            pts = []
            steps = 16
            for i in range(steps + 1):
                aa = a0 + span * (0.5 - i / steps) * 2
                pts.append((cx + math.cos(aa) * L * r_out, cy + math.sin(aa) * L * r_out))
            for i in range(steps + 1):
                aa = a0 + span * (0.5 - i / steps) * 2
                pts.append((cx + math.cos(aa) * L * r_in, cy + math.sin(aa) * L * r_in))
            d.polygon(pts, fill=(255, 255, 255, al))

    ov = ov.filter(ImageFilter.GaussianBlur(1.6 * SS))
    return Image.alpha_composite(img, ov)


# ----------------------------------------------------------------------------
# Hitbox / hurtbox
# ----------------------------------------------------------------------------
def hurt_capsules(ch: Character, sk: Skeleton) -> list[list[float]]:
    """Belgining tanasi kapsulalar ro'yxati (kadr px, o'ngga qaragan)."""
    caps = [
        (sk.pelvis, sk.chest, 24.0, 28.0),
        (sk.chest, sk.head, 20.0, RIG["headR"] * 0.95),
        (sk.hip, sk.knee, 21.0, 14.0),
        (sk.knee, sk.ankle, 14.0, 9.0),
        (sk.hip2, sk.knee2, 20.0, 13.5),
        (sk.knee2, sk.ankle2, 13.0, 8.5),
        (sk.sh, sk.elbow, 13.5, 10.5),
        (sk.elbow, sk.wrist, 10.5, 7.6),
        (sk.sh2, sk.elbow2, 12.5, 9.5),
        (sk.elbow2, sk.wrist2, 9.5, 7.0),
    ]
    out = []
    for a, b, r0, r1 in caps:
        out.append([round(a[0], 1), round(a[1], 1), round(b[0], 1), round(b[1], 1),
                    round(max(r0, r1), 1)])
    return out


def swing_capsule(sk: Skeleton, a_deg: float, length: float, r: float,
                  offset: float = 0.0) -> list[float]:
    """Qo'l yoki qilich yo'li bo'ylab zarba kapsulasi."""
    w = (sk.wrist[0] * SS, sk.wrist[1] * SS) if False else sk.wrist
    d = polar(a_deg, length)
    tip = (w[0] + d[0], w[1] + d[1])
    o = polar(a_deg + 90, offset)
    return [round(w[0] + o[0], 1), round(w[1] + o[1], 1),
            round(tip[0] + o[0], 1), round(tip[1] + o[1], 1), round(r, 1)]


def sprite_anchor(sk: Skeleton) -> list[float]:
    return [round(sk.anchor[0], 1), round(sk.anchor[1], 1)]
