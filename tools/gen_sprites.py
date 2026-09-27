"""
gen_sprites.py — barcha belgilar uchun spritesheet + hitbox/hurtbox JSON.

Har bir animatsiya:
  * kalit pozalar (keyframes) -> smoothstep interpolyatsiya -> N kadr
  * har kadr PNG ga chiziladi, gorizontal lentaga yig'iladi
  * hitbox kapsulalari SKELETDAN avtomatik hisoblanadi (ko'z bilan mos keladi)
  * hurtbox kapsulalari skeletdan avtomatik olinadi

Chiqish:
  public/assets/sprites/<belgi>/<animatsiya>.png
  public/assets/sprites/<belgi>.json
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from rig import (  # noqa: E402
    FRAME_H, FRAME_W, GROUND_Y, PELVIS_X, Character, add, blend_pose,
    compute_skeleton, hurt_capsules, make_pose, polar, render_pose,
)

ROOT = Path(__file__).parent.parent
OUT = ROOT / "public" / "assets" / "sprites"

# Barcha burchaklar: 0 = yuqori, 90 = o'ngga, 180 = pastga, -90 = chapga.
U, D, F, B = 0.0, 180.0, 90.0, -90.0
UP_R, UP_L = -30.0, -150.0
DN_R, DN_L = 150.0, 210.0


# ============================================================================
# BELGILAR
# ============================================================================
ICHIGO = Character(
    key="ichigo", name="Ichigo Kurosaki",
    skin="#F7C9A2", skin_shade="#D79F78",
    hair="#F2802A", hair_light="#FFC46B", hair_style="spiky",
    top="#171524", top_light="#312E45", trim="#E8E4DC",
    pants="#1D1B28", pants_light="#333046", sash="#F2802A", shoe="#585269",
    eye="#E8A33C", blade="#15131C", blade_light="#3A3747", blade_edge="#D9DDE6",
    weapon="sword", weapon_len=134, weapon_w=27, aura="#F2802A",
)

AIZEN = Character(
    key="aizen", name="Aizen Sōsuke",
    skin="#EAC7A6", skin_shade="#C08E6B",
    hair="#E4E7F2", hair_light="#FFFFFF", hair_style="flat",
    top="#E6E3DA", top_light="#C9C5BA", trim="#4A3B7A",
    pants="#1E1C28", pants_light="#35324A", sash="#3A3550", shoe="#D6D1C4",
    eye="#E3B23C", blade="#15131C", blade_light="#3A3747", blade_edge="#D9DDE6",
    weapon="none", sleeves=True, coat=True, sukuna=True,
    sukuna_col="#DCD4C4", aura="#8B7BE8",
)

CHARS = {"ichigo": ICHIGO, "aizen": AIZEN}

# Bankai (super) holati uchun soch, ko'z va aura ranglari
BANKAI_HAIR = {
    "ichigo": ("#1A1620", "#5A4F33"),
    "aizen": ("#D8D2E8", "#FFFFFF"),
}
BANKAI_AURA = {
    "ichigo": "#FFC24A",   # Tensa Zangetsu — qora-gold
    "aizen": "#A88BFF",    # Zenshin — binafsha
}


def P(**kw):
    """Stance ustidan quriladigan to'liq poz."""
    return make_pose(**kw)


# ============================================================================
# UMUMIY ANIMATSIYALAR (ikki belgiga ham tegishli)
# ============================================================================
COMMON: dict[str, dict] = {
    "idle": dict(
        n=8, dur=9, loop=True, aura=False,
        keys=[
            P(),
            P(torso=8, head=-5, armU=123, armF=41, armU2=147, armF2=65,
              squash=1.012, hairSway=3, weaponAbs=158),
            P(),
            P(torso=15, head=1, armU=133, armF=27, armU2=157, armF2=51,
              squash=0.992, hairSway=3, weaponAbs=152),
        ],
    ),
    "walk_f": dict(
        n=8, dur=6, loop=True,
        keys=[
            # o'ng oyoq oldinga
            P(thigh=148, shin=192, foot=184, thigh2=202, shin2=176, foot2=188,
              torso=18, head=-4, armU=150, armF=16, armU2=116, armF2=44, hairSway=-4),
            # o'tish
            P(thigh=162, shin=178, foot=180, thigh2=190, shin2=192, foot2=184,
              torso=13, head=-2, armU=136, armF=31, armU2=131, armF2=49, hairSway=-2),
            # chap oyoq oldinga
            P(thigh=202, shin=176, foot=188, thigh2=148, shin2=192, foot2=184,
              torso=18, head=-4, armU=116, armF=44, armU2=150, armF2=16, hairSway=-4),
            P(thigh=190, shin=192, foot=184, thigh2=162, shin2=178, foot2=180,
              torso=13, head=-2, armU=131, armF=49, armU2=136, armF2=31, hairSway=-2),
        ],
    ),
    "walk_b": dict(
        n=8, dur=7, loop=True,
        keys=[
            P(thigh=140, shin=186, foot=180, thigh2=212, shin2=182, foot2=190,
              torso=12, head=-1, armU=122, armF=40, armU2=138, armF2=38, hairSway=2),
            P(thigh=158, shin=180, foot=182, thigh2=196, shin2=196, foot2=186,
              torso=9, head=0, armU=128, armF=35, armU2=132, armF2=45, hairSway=2),
            P(thigh=212, shin=182, foot=190, thigh2=140, shin2=186, foot2=180,
              torso=12, head=-1, armU=138, armF=38, armU2=122, armF2=40, hairSway=2),
            P(thigh=196, shin=196, foot=186, thigh2=158, shin2=180, foot2=182,
              torso=9, head=0, armU=132, armF=45, armU2=128, armF2=35, hairSway=2),
        ],
    ),
    "crouch": dict(
        n=3, dur=10, loop=True,
        keys=[
            P(thigh=106, shin=146, foot=176, thigh2=126, shin2=206, foot2=196,
              torso=32, head=-6, armU=86, armF=68, armU2=96, armF2=58, hairSway=4),
            P(thigh=110, shin=150, foot=176, thigh2=130, shin2=202, foot2=196,
              torso=30, head=-5, armU=90, armF=64, armU2=100, armF2=54, hairSway=4),
        ],
    ),
    "jump_rise": dict(
        n=3, dur=8, loop=False,
        keys=[
            P(thigh=170, shin=198, foot=168, thigh2=190, shin2=198, foot2=172,
              torso=-16, head=-8, armU=172, armF=-6, armU2=180, armF2=-2,
              hairSway=-6, squash=1.05),
        ],
    ),
    "jump_fall": dict(
        n=3, dur=8, loop=False,
        keys=[
            P(thigh=146, shin=198, foot=172, thigh2=180, shin2=198, foot2=180,
              torso=8, head=2, armU=162, armF=-24, armU2=146, armF2=28,
              hairSway=5),
        ],
    ),
    "block_stand": dict(
        n=2, dur=6, loop=True,
        keys=[
            P(thigh=144, shin=196, foot=184, thigh2=196, shin2=184, foot2=188,
              torso=22, head=-4, armU=72, armF=96, armU2=86, armF2=90,
              weaponAbs=2, hairSway=-2),
        ],
    ),
    "block_crouch": dict(
        n=2, dur=6, loop=True,
        keys=[
            P(thigh=104, shin=144, foot=174, thigh2=124, shin2=208, foot2=198,
              torso=36, head=-8, armU=64, armF=92, armU2=80, armF2=86,
              weaponAbs=8, hairSway=4),
        ],
    ),
    "hit_stand": dict(
        n=2, dur=5, loop=False,
        keys=[
            P(torso=-16, head=-22, armU=152, armF=8, armU2=168, armF2=4,
              thigh=138, shin=200, foot2=192, thigh2=192, shin2=192,
              offsetX=-8, hairSway=-6, weaponAbs=205, eyes=1.0),
        ],
    ),
    "hit_crouch": dict(
        n=2, dur=5, loop=False,
        keys=[
            P(thigh=96, shin=140, foot=172, thigh2=116, shin2=212, foot2=200,
              torso=42, head=-16, armU=140, armF=20, armU2=156, armF2=14,
              offsetX=-6, hairSway=-5, weaponAbs=210, eyes=1.0),
        ],
    ),
    "knockdown": dict(
        n=4, dur=7, loop=False,
        keys=[
            P(torso=-22, head=-24, bodyRot=-16, armU=168, armF=16, armU2=180,
              armF2=10, thigh=150, shin=178, foot=186, thigh2=166, shin2=186,
              foot2=190, offsetX=-8, hairSway=-8, weaponAbs=230, eyes=1.0),
            P(torso=-14, head=-18, bodyRot=-46, armU=150, armF=44, armU2=162,
              armF2=34, thigh=118, shin=132, foot=180, thigh2=144, shin2=124,
              foot2=186, offsetX=-12, hairSway=-6, weaponAbs=250, eyes=1.0),
            P(torso=-4, head=-8, bodyRot=-74, armU=126, armF=78, armU2=138,
              armF2=68, thigh=92, shin=110, foot=176, thigh2=116, shin2=102,
              foot2=182, offsetX=-16, hairSway=-4, weaponAbs=270, eyes=1.0),
            P(torso=4, head=0, bodyRot=-94, armU=100, armF=98, armU2=112,
              armF2=90, thigh=78, shin=96, foot=172, thigh2=100, shin2=90,
              foot2=178, offsetX=-20, hairSway=-3, weaponAbs=284, eyes=1.0),
        ],
    ),
    "getup": dict(
        n=4, dur=7, loop=False,
        keys=[
            P(torso=4, head=0, bodyRot=-88, armU=106, armF=92, armU2=118,
              armF2=84, thigh=82, shin=100, foot=174, thigh2=104, shin2=94,
              foot2=180, offsetX=-18, hairSway=-3, weaponAbs=280),
            P(torso=22, head=2, bodyRot=-46, armU=130, armF=58, armU2=142,
              armF2=50, thigh=116, shin=146, foot=180, thigh2=142, shin2=136,
              foot2=186, offsetX=-12, hairSway=2),
            P(torso=20, head=-2, bodyRot=-10, armU=124, armF=42, armU2=138,
              armF2=44, thigh=140, shin=182, foot=182, thigh2=166, shin2=186,
              foot2=188, offsetX=-5, hairSway=4),
            P(),
        ],
    ),
    "dash": dict(
        n=4, dur=5, loop=False,
        keys=[
            P(thigh=118, shin=196, foot=178, thigh2=214, shin2=174, foot2=192,
              torso=30, head=-6, armU=150, armF=12, armU2=104, armF2=56,
              hairSway=-8, weaponAbs=150),
            P(thigh=104, shin=200, foot=176, thigh2=224, shin2=168, foot2=194,
              torso=36, head=-10, armU=158, armF=2, armU2=96, armF2=64,
              hairSway=-10, weaponAbs=146),
            P(thigh=132, shin=192, foot=180, thigh2=206, shin2=178, foot2=190,
              torso=24, head=-4, armU=142, armF=22, armU2=112, armF2=48,
              hairSway=-6, weaponAbs=152),
            P(),
        ],
    ),
    "backdash": dict(
        n=4, dur=5, loop=False,
        keys=[
            P(thigh=196, shin=180, foot=190, thigh2=140, shin2=192, foot2=184,
              torso=-4, head=2, armU=104, armF=58, armU2=128, armF2=26,
              hairSway=6, weaponAbs=166),
            P(thigh=214, shin=172, foot=194, thigh2=124, shin2=198, foot2=180,
              torso=-12, head=6, armU=94, armF=70, armU2=118, armF2=18,
              hairSway=8, weaponAbs=172),
            P(thigh=196, shin=182, foot=190, thigh2=140, shin2=190, foot2=184,
              torso=2, head=0, armU=112, armF=48, armU2=126, armF2=32,
              hairSway=4, weaponAbs=164),
            P(),
        ],
    ),
    "victory": dict(
        n=6, dur=8, loop=True,
        keys=[
            P(torso=-6, head=-8, armU=166, armF=-20, armU2=172, armF2=-14,
              weaponAbs=340, hairSway=-4),
            P(torso=-4, head=-6, armU=170, armF=-28, armU2=176, armF2=-22,
              weaponAbs=345, hairSway=2),
            P(torso=8, head=2, armU=132, armF=26, armU2=156, armF2=54,
              weaponAbs=160, hairSway=4),
        ],
    ),
    "ko": dict(
        n=4, dur=10, loop=False,
        keys=[
            P(torso=-26, head=-30, armU=164, armF=22, armU2=176, armF2=16,
              thigh=150, shin=180, foot=186, thigh2=170, shin2=188, foot2=190,
              offsetX=-10, hairSway=-8, weaponAbs=240, eyes=1.0),
            P(torso=-16, head=-22, bodyRot=-46, armU=146, armF=48, armU2=158,
              armF2=38, thigh=122, shin=138, foot=180, thigh2=148, shin2=128,
              foot2=186, offsetX=-14, hairSway=-6, weaponAbs=256, eyes=1.0),
            P(torso=-6, head=-10, bodyRot=-76, armU=128, armF=74, armU2=140,
              armF2=64, thigh=92, shin=110, foot=176, thigh2=116, shin2=102,
              foot2=182, offsetX=-18, hairSway=-4, weaponAbs=272, eyes=1.0),
            P(torso=4, head=0, bodyRot=-94, armU=100, armF=98, armU2=112,
              armF2=90, thigh=78, shin=96, foot=172, thigh2=100, shin2=90,
              foot2=178, offsetX=-22, hairSway=-3, weaponAbs=284, eyes=1.0),
        ],
    ),
}


# ============================================================================
# ICHIGO: qilich uslubi
# ============================================================================
def ichigo_atk1():
    """Tez gorizontal zarba — Getsuga Keshi kichigi."""
    return dict(
        n=6, dur=4, loop=False,
        keys=[
            # 0-1: orqaga yig'ilish
            P(torso=-10, head=-6, armU=64, armF=8, armU2=150, armF2=48,
              weaponAbs=232, hairSway=-5),
            P(torso=-14, head=-8, armU=56, armF=2, armU2=146, armF2=44,
              weaponAbs=242, hairSway=-7),
            # 2-3: urish
            P(torso=26, head=6, armU=104, armF=96, armU2=132, armF2=66,
              weaponAbs=118, hairSway=6, offsetX=6, eyes=2.0),
            P(torso=32, head=8, armU=118, armF=110, armU2=124, armF2=74,
              weaponAbs=104, hairSway=8, offsetX=10),
            # 4-5: tiklanish
            P(torso=22, head=4, armU=130, armF=98, armU2=134, armF2=64,
              weaponAbs=126, hairSway=5, offsetX=6),
            P(),
        ],
    )


def ichigo_atk2():
    """Og'ir yuqoridan kesuvchi — katta knockback."""
    return dict(
        n=8, dur=5, loop=False,
        keys=[
            P(torso=-18, head=-10, armU=44, armF=-14, armU2=156, armF2=36,
              weaponAbs=326, hairSway=-8),
            P(torso=-24, head=-14, armU=36, armF=-26, armU2=162, armF2=28,
              weaponAbs=338, hairSway=-11),
            P(torso=-20, head=-10, armU=44, armF=-18, armU2=158, armF2=32,
              weaponAbs=332, hairSway=-9),
            # pastga urish
            P(torso=34, head=10, armU=96, armF=118, armU2=120, armF2=80,
              weaponAbs=100, hairSway=9, offsetX=8, eyes=2.0),
            P(torso=42, head=14, armU=112, armF=134, armU2=112, armF2=90,
              weaponAbs=88, hairSway=11, offsetX=14),
            P(torso=40, head=13, armU=116, armF=136, armU2=110, armF2=92,
              weaponAbs=86, hairSway=11, offsetX=16),
            P(torso=28, head=6, armU=126, armF=116, armU2=126, armF2=76,
              weaponAbs=106, hairSway=7, offsetX=8),
            P(),
        ],
    )


def ichigo_atk3():
    """Yuqoriga uruvchi (launcher) — kombinatsiya yakuni."""
    return dict(
        n=7, dur=5, loop=False,
        keys=[
            P(thigh=118, shin=176, foot=182, thigh2=140, shin2=206, foot2=196,
              torso=20, head=2, armU=126, armF=30, armU2=142, armF2=52,
              weaponAbs=196, hairSway=-4),
            P(thigh=112, shin=172, foot=182, thigh2=136, shin2=210, foot2=198,
              torso=26, head=4, armU=122, armF=22, armU2=146, armF2=44,
              weaponAbs=206, hairSway=-6),
            P(thigh=124, shin=188, foot=178, thigh2=152, shin2=196, foot2=190,
              torso=-14, head=-6, armU=68, armF=-16, armU2=158, armF2=26,
              weaponAbs=316, hairSway=-8, offsetY=4),
            P(thigh=132, shin=196, foot=172, thigh2=166, shin2=190, foot2=186,
              torso=-22, head=-10, armU=56, armF=-30, armU2=164, armF2=18,
              weaponAbs=330, hairSway=-10, offsetY=8),
            P(thigh=120, shin=182, foot=176, thigh2=150, shin2=198, foot2=192,
              torso=-30, head=-14, armU=42, armF=-44, armU2=170, armF2=8,
              weaponAbs=344, hairSway=-12, offsetY=12, eyes=2.0),
            P(thigh=134, shin=192, foot=176, thigh2=160, shin2=192, foot2=188,
              torso=-18, head=-6, armU=70, armF=-10, armU2=160, armF2=30,
              weaponAbs=310, hairSway=-6, offsetY=6),
            P(),
        ],
    )


def ichigo_crouch_atk():
    """O'tirgan holatda pastga urish."""
    return dict(
        n=6, dur=4, loop=False,
        keys=[
            P(thigh=104, shin=144, foot=174, thigh2=124, shin2=208, foot2=198,
              torso=36, head=-8, armU=60, armF=10, armU2=100, armF2=56,
              weaponAbs=248, hairSway=4),
            P(thigh=102, shin=142, foot=174, thigh2=122, shin2=210, foot2=198,
              torso=40, head=-10, armU=48, armF=0, armU2=96, armF2=52,
              weaponAbs=258, hairSway=6),
            P(thigh=108, shin=150, foot=174, thigh2=128, shin2=204, foot2=198,
              torso=44, head=-6, armU=88, armF=120, armU2=104, armF2=70,
              weaponAbs=96, hairSway=8, offsetX=6, eyes=2.0),
            P(thigh=108, shin=150, foot=174, thigh2=128, shin2=204, foot2=198,
              torso=46, head=-4, armU=100, armF=134, armU2=100, armF2=76,
              weaponAbs=84, hairSway=9, offsetX=10),
            P(thigh=106, shin=146, foot=174, thigh2=126, shin2=206, foot2=198,
              torso=40, head=-6, armU=96, armF=116, armU2=102, armF2=68,
              weaponAbs=100, hairSway=6, offsetX=4),
            P(thigh=106, shin=146, foot=174, thigh2=126, shin2=206, foot2=198,
              torso=32, head=-6, armU=86, armF=68, armU2=96, armF2=58,
              weaponAbs=108, hairSway=4),
        ],
    )


def ichigo_air_atk():
    """Havodagi aylanma — ikki yo'nalishli."""
    return dict(
        n=6, dur=5, loop=False,
        keys=[
            P(thigh=150, shin=192, foot=176, thigh2=182, shin2=194, foot2=184,
              torso=14, head=0, armU=142, armF=22, armU2=150, armF2=30,
              weaponAbs=186, hairSway=-4),
            P(thigh=128, shin=180, foot=172, thigh2=168, shin2=190, foot2=182,
              torso=-16, head=-8, bodyRot=-16, armU=70, armF=-14, armU2=160,
              armF2=20, weaponAbs=300, hairSway=-8),
            P(thigh=112, shin=150, foot=168, thigh2=140, shin2=160, foot2=176,
              torso=-24, head=-12, bodyRot=-28, armU=48, armF=-34, armU2=168,
              armF2=6, weaponAbs=330, hairSway=-10, eyes=2.0),
            P(thigh=104, shin=132, foot=164, thigh2=126, shin2=146, foot2=172,
              torso=-20, head=-10, bodyRot=-36, armU=60, armF=-24, armU2=162,
              armF2=14, weaponAbs=318, hairSway=-8),
            P(thigh=128, shin=176, foot=172, thigh2=160, shin2=188, foot2=184,
              torso=-4, head=-2, bodyRot=-10, armU=108, armF=70, armU2=140,
              armF2=56, weaponAbs=140, hairSway=-2),
            P(thigh=150, shin=194, foot=176, thigh2=186, shin2=196, foot2=186,
              torso=10, head=0, armU=138, armF=34, armU2=150, armF2=36,
              weaponAbs=176, hairSway=2),
        ],
    )


def ichigo_special1():
    """GETSUGA TENSHŌ — chap qo'lni yerga urib qizil to'lqin yuboradi."""
    return dict(
        n=10, dur=5, loop=False, projectile="getsuga",
        keys=[
            P(torso=-14, head=-8, armU=40, armF=-30, armU2=52, armF2=-24,
              weaponAbs=344, hairSway=-8),
            P(torso=-20, head=-12, armU=26, armF=-46, armU2=34, armF2=-38,
              weaponAbs=352, hairSway=-11),
            P(torso=10, head=0, armU=128, armF=40, armU2=140, armF2=44,
              weaponAbs=150, hairSway=6, offsetX=-4),
            # chap qo'lni oldinga uzatish
            P(torso=24, head=4, armU=150, armF=60, armU2=96, armF2=92,
              weaponAbs=140, hairSway=8, offsetX=6, eyes=2.0),
            P(torso=28, head=6, armU=158, armF=76, armU2=88, armF2=98,
              weaponAbs=136, hairSway=10, offsetX=10, eyes=2.0),
            P(torso=28, head=6, armU=160, armF=80, armU2=86, armF2=100,
              weaponAbs=134, hairSway=10, offsetX=12, eyes=2.0),
            P(torso=26, head=5, armU=156, armF=74, armU2=90, armF2=96,
              weaponAbs=138, hairSway=8, offsetX=10, eyes=2.0),
            P(torso=18, head=2, armU=146, armF=58, armU2=104, armF2=80,
              weaponAbs=146, hairSway=6, offsetX=4),
            P(torso=12, head=0, armU=136, armF=44, armU2=118, armF2=66,
              weaponAbs=152, hairSway=4),
            P(),
        ],
    )


def ichigo_special2():
    """KESSETSU: SHIBA-ORI — oldinga sakrab, aylanib, chuqur kesim."""
    return dict(
        n=10, dur=5, loop=False, dash=2,
        keys=[
            P(thigh=126, shin=170, foot=180, thigh2=136, shin2=200, foot2=194,
              torso=22, head=0, armU=132, armF=34, armU2=140, armF2=48,
              weaponAbs=176, hairSway=-4),
            P(thigh=108, shin=160, foot=176, thigh2=122, shin2=206, foot2=198,
              torso=36, head=-8, armU=50, armF=-8, armU2=60, armF2=0,
              weaponAbs=330, hairSway=-10),
            P(thigh=96, shin=132, foot=168, thigh2=106, shin2=150, foot2=174,
              torso=40, head=-12, bodyRot=-22, armU=34, armF=-36, armU2=44,
              armF2=-28, weaponAbs=348, hairSway=-12, offsetY=10),
            P(thigh=86, shin=120, foot=164, thigh2=96, shin2=134, foot2=170,
              torso=44, head=-14, bodyRot=-40, armU=24, armF=-52, armU2=32,
              armF2=-44, weaponAbs=356, hairSway=-12, offsetY=18, eyes=2.0),
            P(thigh=92, shin=128, foot=166, thigh2=102, shin2=142, foot2=172,
              torso=30, head=-8, bodyRot=-10, armU=96, armF=88, armU2=70,
              armF2=104, weaponAbs=110, hairSway=6, offsetY=8, eyes=2.0),
            P(thigh=104, shin=150, foot=170, thigh2=116, shin2=164, foot2=178,
              torso=14, head=0, bodyRot=6, armU=126, armF=124, armU2=104,
              armF2=138, weaponAbs=78, hairSway=9, offsetY=2, eyes=2.0),
            P(thigh=120, shin=174, foot=174, thigh2=132, shin2=186, foot2=186,
              torso=6, head=0, bodyRot=2, armU=132, armF=116, armU2=118,
              armF2=112, weaponAbs=88, hairSway=6),
            P(thigh=136, shin=184, foot=178, thigh2=150, shin2=192, foot2=190,
              torso=12, head=-2, armU=134, armF=88, armU2=126, armF2=86,
              weaponAbs=112, hairSway=4),
            P(torso=16, head=0, armU=130, armF=60, armU2=132, armF2=60,
              weaponAbs=142, hairSway=2),
            P(),
        ],
    )


def ichigo_bankai():
    """TENSA ZANGETSU — qora-gold auras, 3 zarbadan iborat combo."""
    return dict(
        n=12, dur=5, loop=False, aura=True, bankai=True, super_move=True,
        keys=[
            # 0-1: aurganing paydo bo'lishi
            P(torso=-6, head=-6, armU=160, armF=-14, armU2=166, armF2=-8,
              weaponAbs=8, hairSway=-4, eyes=2.0),
            P(torso=-10, head=-10, armU=170, armF=-26, armU2=176, armF2=-20,
              weaponAbs=352, hairSway=-8, eyes=2.0),
            P(torso=-14, head=-12, armU=176, armF=-34, armU2=182, armF2=-28,
              weaponAbs=344, hairSway=-10, eyes=2.0),
            # 2-3: 1-zarba (pastdan yuqoriga)
            P(torso=40, head=12, armU=92, armF=126, armU2=116, armF2=88,
              weaponAbs=92, hairSway=10, offsetX=8, eyes=2.0),
            P(torso=48, head=16, armU=104, armF=142, armU2=108, armF2=96,
              weaponAbs=80, hairSway=12, offsetX=14, eyes=2.0),
            # 4-5: 2-zarba (yon kesim)
            P(torso=-20, head=-10, bodyRot=-18, armU=48, armF=-20, armU2=160,
              armF2=24, weaponAbs=316, hairSway=-10, offsetX=18, eyes=2.0),
            P(torso=28, head=8, bodyRot=8, armU=110, armF=112, armU2=112,
              armF2=104, weaponAbs=100, hairSway=12, offsetX=24, eyes=2.0),
            # 6-7: 3-zarba (kuchli oxirgi)
            P(torso=-24, head=-12, bodyRot=-24, armU=40, armF=-36, armU2=168,
              armF2=14, weaponAbs=340, hairSway=-12, offsetX=28, eyes=2.0),
            P(torso=44, head=14, bodyRot=10, armU=108, armF=138, armU2=104,
              armF2=126, weaponAbs=78, hairSway=14, offsetX=36, eyes=2.0),
            P(torso=46, head=15, bodyRot=12, armU=112, armF=142, armU2=100,
              armF2=130, weaponAbs=76, hairSway=14, offsetX=40, eyes=2.0),
            # tiklanish
            P(torso=26, head=4, bodyRot=2, armU=126, armF=112, armU2=118,
              armF2=104, weaponAbs=104, hairSway=8, offsetX=20, eyes=2.0),
            P(torso=10, head=0, armU=130, armF=52, armU2=134, armF2=58,
              weaponAbs=150, hairSway=4, offsetX=6, eyes=2.0),
        ],
    )


# ============================================================================
# AIZEN: masofaviy "Hadō" uslubi
# ============================================================================
def aizen_atk1():
    """Ko'rsatkich nishoni — tez, qisqa masofa."""
    return dict(
        n=5, dur=4, loop=False,
        keys=[
            P(torso=16, head=2, armU=124, armF=44, armU2=132, armF2=52),
            P(torso=20, head=3, armU=118, armF=36, armU2=136, armF2=48),
            P(torso=26, head=5, armU=100, armF=86, armU2=124, armF2=70,
              offsetX=6, eyes=2.0),
            P(torso=24, head=4, armU=104, armF=80, armU2=126, armF2=68,
              offsetX=8),
            P(),
        ],
    )


def aizen_atk2():
    """Kuchli to'qirash — kaft bilan itarish."""
    return dict(
        n=7, dur=5, loop=False,
        keys=[
            P(torso=-10, head=-4, armU=76, armF=10, armU2=64, armF2=2),
            P(torso=-16, head=-8, armU=66, armF=-2, armU2=54, armF2=-8),
            P(torso=34, head=8, armU=92, armF=104, armU2=78, armF2=92,
              offsetX=10, eyes=2.0),
            P(torso=40, head=10, armU=98, armF=116, armU2=74, armF2=100,
              offsetX=16),
            P(torso=38, head=9, armU=100, armF=118, armU2=74, armF2=102,
              offsetX=18),
            P(torso=28, head=4, armU=110, armF=92, armU2=90, armF2=84,
              offsetX=10),
            P(),
        ],
    )


def aizen_atk3():
    """Yuqoriga to'qirash — kaftni tepaga."""
    return dict(
        n=7, dur=5, loop=False,
        keys=[
            P(thigh=122, shin=172, foot=182, thigh2=138, shin2=202, foot2=196,
              torso=24, head=2, armU=120, armF=36, armU2=136, armF2=48),
            P(thigh=118, shin=170, foot=182, thigh2=134, shin2=206, foot2=198,
              torso=30, head=4, armU=112, armF=26, armU2=142, armF2=40),
            P(thigh=128, shin=190, foot=178, thigh2=152, shin2=196, foot2=190,
              torso=-16, head=-6, armU=70, armF=-12, armU2=62, armF2=-18,
              offsetY=4),
            P(thigh=134, shin=196, foot=174, thigh2=166, shin2=190, foot2=186,
              torso=-26, head=-12, armU=52, armF=-30, armU2=46, armF2=-36,
              offsetY=10, eyes=2.0),
            P(thigh=124, shin=186, foot=176, thigh2=152, shin2=198, foot2=192,
              torso=-14, head=-6, armU=84, armF=-6, armU2=74, armF2=-10,
              offsetY=6),
            P(thigh=120, shin=176, foot=180, thigh2=138, shin2=204, foot2=196,
              torso=10, head=0, armU=110, armF=34, armU2=126, armF2=44,
              offsetY=2),
            P(),
        ],
    )


def aizen_crouch_atk():
    """O'tirgan holatda tez nishon."""
    return dict(
        n=5, dur=4, loop=False,
        keys=[
            P(thigh=104, shin=144, foot=174, thigh2=124, shin2=208, foot2=198,
              torso=32, head=-6, armU=112, armF=40, armU2=124, armF2=50),
            P(thigh=102, shin=142, foot=174, thigh2=122, shin2=210, foot2=198,
              torso=36, head=-8, armU=104, armF=30, armU2=132, armF2=42),
            P(thigh=106, shin=148, foot=174, thigh2=126, shin2=206, foot2=198,
              torso=42, head=-6, armU=92, armF=92, armU2=110, armF2=76,
              offsetX=6, eyes=2.0),
            P(thigh=106, shin=148, foot=174, thigh2=126, shin2=206, foot2=198,
              torso=40, head=-6, armU=98, armF=84, armU2=116, armF2=72,
              offsetX=8),
            P(thigh=106, shin=146, foot=174, thigh2=126, shin2=206, foot2=198,
              torso=32, head=-6, armU=86, armF=68, armU2=96, armF2=58),
        ],
    )


def aizen_air_atk():
    """Havodagi zarba — ikki qo'l bilan."""
    return dict(
        n=5, dur=5, loop=False,
        keys=[
            P(thigh=150, shin=192, foot=176, thigh2=182, shin2=194, foot2=184,
              torso=14, head=0, armU=132, armF=34, armU2=142, armF2=38),
            P(thigh=118, shin=160, foot=170, thigh2=136, shin2=176, foot2=178,
              torso=34, head=6, bodyRot=-14, armU=96, armF=96, armU2=88, armF2=88,
              offsetY=4, eyes=2.0),
            P(thigh=104, shin=134, foot=164, thigh2=120, shin2=148, foot2=170,
              torso=40, head=8, bodyRot=-30, armU=82, armF=110, armU2=74,
              armF2=104, offsetY=12, eyes=2.0),
            P(thigh=120, shin=172, foot=172, thigh2=140, shin2=184, foot2=182,
              torso=18, head=2, bodyRot=-8, armU=112, armF=66, armU2=118,
              armF2=72, offsetY=4),
            P(thigh=150, shin=194, foot=176, thigh2=186, shin2=196, foot2=186,
              torso=10, head=0, armU=134, armF=32, armU2=146, armF2=36),
        ],
    )


def aizen_special1():
    """HADŌ #31 SHAKKAHŌ — barmoq bilan portlab chiqadigan nishon."""
    return dict(
        n=10, dur=5, loop=False, projectile="shakaho",
        keys=[
            # qo'llar belgisi
            P(torso=4, head=0, armU=92, armF=86, armU2=88, armF2=80),
            P(torso=2, head=-2, armU=84, armF=96, armU2=80, armF2=90),
            P(torso=6, head=0, armU=96, armF=88, armU2=92, armF2=84),
            # qo'lni oldinga cho'zish
            P(torso=18, head=2, armU=88, armF=92, armU2=70, armF2=76,
              offsetX=4, eyes=2.0),
            P(torso=24, head=4, armU=84, armF=98, armU2=56, armF2=62,
              offsetX=8, eyes=2.0),
            P(torso=26, head=5, armU=82, armF=100, armU2=52, armF2=58,
              offsetX=10, eyes=2.0),
            P(torso=24, head=4, armU=84, armF=98, armU2=54, armF2=60,
              offsetX=10, eyes=2.0),
            P(torso=18, head=2, armU=90, armF=92, armU2=62, armF2=70,
              offsetX=6),
            P(torso=10, head=0, armU=96, armF=84, armU2=78, armF2=76),
            P(),
        ],
    )


def aizen_special2():
    """HADŌ #33 SŌKATSU — keng ko'lamli ko'k halqa to'lqinlari."""
    return dict(
        n=10, dur=5, loop=False, projectile="sokatsui",
        keys=[
            P(torso=26, head=4, armU=62, armF=56, armU2=58, armF2=50),
            P(torso=30, head=6, armU=56, armF=48, armU2=52, armF2=42),
            P(torso=16, head=2, armU=96, armF=104, armU2=66, armF2=72,
              offsetX=-4, eyes=2.0),
            P(torso=10, head=0, armU=100, armF=112, armU2=62, armF2=80,
              offsetX=4, eyes=2.0),
            P(torso=6, head=-2, armU=102, armF=116, armU2=58, armF2=86,
              offsetX=8, eyes=2.0),
            P(torso=6, head=-2, armU=102, armF=116, armU2=58, armF2=86,
              offsetX=10, eyes=2.0),
            P(torso=8, head=0, armU=100, armF=112, armU2=60, armF2=82,
              offsetX=8),
            P(torso=12, head=2, armU=96, armF=100, armU2=66, armF2=74,
              offsetX=4),
            P(torso=16, head=2, armU=92, armF=86, armU2=76, armF2=70),
            P(),
        ],
    )


def aizen_bankai():
    """ZENSHTIN — suyunish aurasiga kiringan holat, to'liq ekron to'lqin."""
    return dict(
        n=12, dur=5, loop=False, aura=True, bankai=True, super_move=True,
        keys=[
            P(torso=-4, head=-6, armU=70, armF=60, armU2=66, armF2=54,
              hairSway=-3, eyes=2.0),
            P(torso=-8, head=-8, armU=62, armF=52, armU2=58, armF2=46,
              hairSway=-6, eyes=2.0),
            P(torso=-12, head=-10, armU=56, armF=44, armU2=52, armF2=38,
              hairSway=-8, eyes=2.0),
            # to'lqin chiqarish
            P(torso=22, head=4, armU=88, armF=96, armU2=52, armF2=60,
              offsetX=6, eyes=2.0),
            P(torso=28, head=6, armU=82, armF=104, armU2=44, armF2=54,
              offsetX=12, eyes=2.0),
            P(torso=30, head=7, armU=80, armF=106, armU2=42, armF2=52,
              offsetX=14, eyes=2.0),
            P(torso=30, head=7, armU=80, armF=106, armU2=42, armF2=52,
              offsetX=14, eyes=2.0),
            P(torso=28, head=6, armU=84, armF=102, armU2=46, armF2=56,
              offsetX=10, eyes=2.0),
            P(torso=20, head=3, armU=92, armF=92, armU2=54, armF2=66,
              offsetX=6),
            P(torso=12, head=1, armU=96, armF=80, armU2=68, armF2=72),
            P(torso=8, head=0, armU=94, armF=74, armU2=76, armF2=70),
            P(),
        ],
    )


# ============================================================================
# ANIMATSIYALAR RO'YXATI
# ============================================================================
def build_anims(char_key: str) -> dict[str, dict]:
    a = {name: dict(cfg) for name, cfg in COMMON.items()}
    a["atk1"] = ichigo_atk1() if char_key == "ichigo" else aizen_atk1()
    a["atk2"] = ichigo_atk2() if char_key == "ichigo" else aizen_atk2()
    a["atk3"] = ichigo_atk3() if char_key == "ichigo" else aizen_atk3()
    a["crouch_atk"] = ichigo_crouch_atk() if char_key == "ichigo" else aizen_crouch_atk()
    a["air_atk"] = ichigo_air_atk() if char_key == "ichigo" else aizen_air_atk()
    if char_key == "ichigo":
        a["special1"] = ichigo_special1()
        a["special2"] = ichigo_special2()
        a["bankai"] = ichigo_bankai()
    else:
        a["special1"] = aizen_special1()
        a["special2"] = aizen_special2()
        a["bankai"] = aizen_bankai()
    return a


# Hitbox jadvallari: animatsiya -> [(kadr_boshi, kadr_oxiri, uzunlik, radius, tip)]
HITBOX: dict[str, dict[str, list[tuple[int, int, float, float, str]]]] = {
    "ichigo": {
        "atk1":       [(2, 3, 118, 24, "blade")],
        "atk2":       [(3, 5, 142, 30, "blade")],
        "atk3":       [(4, 4, 128, 26, "blade")],
        "crouch_atk": [(2, 3, 108, 24, "blade")],
        "air_atk":    [(2, 3, 124, 26, "blade")],
        "special2":   [(4, 5, 132, 28, "blade")],
        # TENSA ZANGETSU — uchta alohida zarba
        "bankai":     [(3, 4, 140, 30, "blade"), (5, 5, 146, 32, "blade"),
                       (7, 8, 152, 34, "blade")],
    },
    "aizen": {
        "atk1":       [(2, 2, 62, 17, "hand")],
        "atk2":       [(2, 4, 78, 22, "hand")],
        "atk3":       [(3, 3, 68, 19, "hand")],
        "crouch_atk": [(2, 3, 60, 17, "hand")],
        "air_atk":    [(2, 2, 70, 20, "hand")],
        # ZENSHTIN — butun ekron (maxsus effekt, hitbox yo'q)
        "bankai":     [],
    },
}

# Projectile qayerdan chiqadi (kadr indeksi)
SPAWN: dict[str, dict[str, int]] = {
    "ichigo": {"special1": 4, "special2": 4},
    "aizen": {"special1": 4, "special2": 4, "bankai": 4},
}


# ============================================================================
# KADR YIG'ISH
# ============================================================================
def sample_keys(keys: list[dict], i: int, n: int, loop: bool) -> dict:
    """Kalit pozalar orasidan i-chi kadrni interpolyatsiya qilib oladi."""
    if n <= 1:
        return dict(keys[0])
    if loop:
        u = (i / n) * len(keys)
        k = int(math.floor(u)) % len(keys)
        k2 = (k + 1) % len(keys)
        f = u - math.floor(u)
    else:
        u = (i / (n - 1)) * (len(keys) - 1)
        k = min(int(u), len(keys) - 2)
        f = u - k
        k2 = k + 1
    return blend_pose(keys[k], keys[k2], f)


def hit_capsule(sk, spec) -> list[float] | None:
    """Zarba kapsulasini skeletdan hisoblaydi.

    Kapsula YELKADAN palka uchigacha cho'ziladi (faqat palkadan emas). Shu sababli
    yaqin masofada ham urish ulanadi — Mortal Kombat uslubidagi "uzun quti" kabi.
    """
    _f0, _f1, length, radius, mode = spec
    origin = sk.sh
    if mode == "blade":
        tip = add(sk.wrist, polar(sk.weaponA, length))
    elif mode == "hand":
        tip = add(sk.wrist, polar(sk_head_arm(sk), length))
    else:
        tip = add(sk.chest, polar(0.0, length))
    return [round(origin[0], 1), round(origin[1], 1),
            round(tip[0], 1), round(tip[1], 1), round(radius, 1)]


def sheet_from_frames(frames: list[Image.Image]):
    """Kadrlarni bitta lentaga yig'adi va KONTENT BO'YICHA qirqadi.

    Har bir animatsiyadagi kadrlar yagona umumiy chegaraga (union bbox) qisqaradi
    — masalan `idle` 560x448 dan ~210x350 ga tushadi. Bu sifatsiz (piksel o'zgarmaydi)
    va fayl hajmini 3-5 barobar kamaytiradi.

    Qaytaradi: (sheet, ox, oy, cw, ch)
    """
    pad = 2
    x0 = y0 = 10**9
    x1 = y1 = 0
    for im in frames:
        bb = im.split()[3].getbbox()  # alfa kanalidan haqiqiy kontent
        if not bb:
            continue
        x0 = min(x0, bb[0]); y0 = min(y0, bb[1])
        x1 = max(x1, bb[2]); y1 = max(y1, bb[3])
    if x0 > x1:
        x0 = y0 = 0
        x1, y1 = FRAME_W, FRAME_H
    x0 = max(0, x0 - pad); y0 = max(0, y0 - pad)
    x1 = min(FRAME_W, x1 + pad); y1 = min(FRAME_H, y1 + pad)
    cw, ch = x1 - x0, y1 - y0

    sheet = Image.new("RGBA", (cw * len(frames), ch), (0, 0, 0, 0))
    for i, im in enumerate(frames):
        sheet.alpha_composite(im.crop((x0, y0, x1, y1)), (i * cw, 0))
    return sheet, x0, y0, cw, ch


def save_sheet(sheet: Image.Image, path: Path, colors: int = 256) -> int:
    """Sprite lentasini saqlaydi.

    Cel-shading uslubidagi grafikada rang soni kam, shuning uchun PNG8
    (palitra, 256 rang) fayl hajmini ~5 barobar kamaytiradi va ko'rinishga
    amalda ta'sir qilmaydi (256 rang ushbu grafikada yetarli).
    Qaytaradi: fayl hajmi (bayt).
    """
    q = sheet.quantize(colors=colors, method=Image.FASTOCTREE, dither=Image.Dither.NONE)
    q.save(path, optimize=True)
    return path.stat().st_size


def timing(durations: list[int], hitspecs: list[tuple], spawn_frame: int | None):
    """Animatsiya kadr davomiyliklaridan harakat vaqtini hisoblaydi.

    Dvigateldagi `moveTick` harakat boshlangan kadrda 0 bo'ladi va keyin
    1, 2, ... ga osiladi. i-chi kadr `moveTick` oralig'ida ko'rinadi:

        start(i) = 1 + sum(d[0..i-1])
        end(i)   = sum(d[0..i])

    Qaytariladi:
        windows  — zarba faollik oynalari [[boshlanish, tugash], ...]
        startup  — birinchi oyna boshlanishi
        active   — oynalarning umumiy uzunligi
        recovery — oxirgi oynadan keyingi qolish
        total    — butun harakat uzunligi (kadr)
        spawn    — projectile chiqadigan moveTick (yoki -1)
    """
    cum = [0]
    for d in durations:
        cum.append(cum[-1] + d)

    def start_of(i: int) -> int:
        return 1 + cum[i]

    def end_of(i: int) -> int:
        return cum[i + 1]

    windows: list[list[int]] = []
    for f0, f1, *_ in hitspecs:
        s, e = start_of(f0), end_of(f1)
        if windows and s <= windows[-1][1]:
            windows[-1][1] = max(windows[-1][1], e)
        else:
            windows.append([s, e])

    spawn = start_of(spawn_frame) if spawn_frame is not None else -1

    if windows:
        first = windows[0][0]
        last = max(w[1] for w in windows)
    elif spawn >= 0:
        first = spawn
        last = spawn
    else:
        return {"windows": [], "startup": 0, "active": 0,
                "recovery": 0, "total": 1 + cum[-1], "spawn": -1}

    active = sum(w[1] - w[0] + 1 for w in windows) if windows else 0
    move_end = 1 + cum[-1]
    recovery = max(1, move_end - last)
    return {
        "windows": windows,
        "startup": first,
        "active": active,
        "recovery": recovery,
        "total": startup_total(first, active, recovery),
        "spawn": spawn,
    }


def startup_total(first: int, active: int, recovery: int) -> int:
    return first + active + recovery


def sk_head_arm(sk) -> float:
    """Qo'lning oldinga qaragan burchagi (bilak -> barmoq)."""
    dx, dy = sk.wrist[0] - sk.elbow[0], sk.wrist[1] - sk.elbow[1]
    return math.degrees(math.atan2(dy, dx))


def muzzle_point(ch: Character, sk) -> list[float]:
    """Nishon/toplama chiqadigan nuqta."""
    if ch.weapon == "sword":
        d = polar(sk.weaponA, ch.weapon_len + 10)
        return [round(sk.wrist[0] + d[0], 1), round(sk.wrist[1] + d[1], 1)]
    ang = math.degrees(math.atan2(sk.wrist[1] - sk.elbow[1], sk.wrist[0] - sk.elbow[0]))
    d = polar(ang, 46)
    return [round(sk.wrist[0] + d[0], 1), round(sk.wrist[1] + d[1], 1)]


def gen_character(key: str, ch: Character, verbose: bool = True) -> dict:
    anims = build_anims(key)
    folder = OUT / key
    folder.mkdir(parents=True, exist_ok=True)
    hits = HITBOX.get(key, {})
    meta: dict = {"frameW": FRAME_W, "frameH": FRAME_H, "groundY": GROUND_Y,
                  "pelvisX": PELVIS_X, "anims": {}}

    total = 0
    spawns = SPAWN.get(key, {})
    for name, cfg in anims.items():
        n = cfg["n"]
        dur = cfg["dur"]
        loop = cfg.get("loop", False)
        keys = cfg["keys"]
        is_bankai = cfg.get("bankai", False)
        fx_slash = name in ("atk1", "atk2", "atk3", "crouch_atk", "air_atk",
                            "special2", "bankai")

        frames: list[Image.Image] = []
        fdata: list[dict] = []
        for i in range(n):
            pose = sample_keys(keys, i, n, loop)
            sk = compute_skeleton(pose)

            aura = ch.aura if cfg.get("aura") else None
            fx = "slash" if (fx_slash and n >= 4 and 1 <= i <= 3) else None
            eyes = int(round(pose.get("eyes", 0.0)))

            img = render_pose(ch, pose, eyes=eyes, aura=aura, fx=fx)
            frames.append(img)

            # --- hitbox (faqat zarba kadrlarida) ---
            hbox = None
            for spec in hits.get(name, []):
                if spec[0] <= i <= spec[1]:
                    hbox = hit_capsule(sk, spec)
                    break

            fdata.append({
                "d": dur,
                "h": hurt_capsules(ch, sk),
                "a": hbox,
                "m": muzzle_point(ch, sk),
                "e": eyes,
            })

        # sprite lentasi (kontent bo'yicha qirqilgan)
        # DIQQAT: `ch` belgi obyekti — qirqish o'lchamlarini boshqa nom bilan
        # olamiz, aks holda `ch` ni niqobga (int) ustidan yopib qo'yamiz.
        sheet, crop_x, crop_y, cw, chh = sheet_from_frames(frames)
        size = save_sheet(sheet, folder / f"{name}.png")

        tm = timing([f["d"] for f in fdata], hits.get(name, []), spawns.get(name))
        entry = {
            "n": n, "dur": dur, "loop": loop, "frames": fdata,
            "file": f"{name}.png",
            # lentadagi kadr o'lchami va uning to'liq kadr ichidagi joyi
            "cw": cw, "ch": chh, "ox": crop_x, "oy": crop_y,
            "startup": tm["startup"], "active": tm["active"],
            "recovery": tm["recovery"], "total": tm["total"],
            "windows": tm["windows"], "spawn": tm["spawn"],
        }
        for opt in ("projectile", "dash", "aura", "bankai", "super_move"):
            if cfg.get(opt):
                entry[opt] = True
        meta["anims"][name] = entry
        total += n
        if verbose:
            print(f"  {key}/{name:<13} {n:>2} kadr  {cw}x{chh}  "
                  f"{size/1024:>5.0f} KB  vaqt={tm['total']:>3} "
                  f"(startup={tm['startup']} active={tm['active']} rec={tm['recovery']})"
                  f" oyna={tm['windows']} spawn={tm['spawn']}")

    # Bankai paytida soch/ko'z/aura ranglari o'zgaradi
    if True:
        hair, hair_light = BANKAI_HAIR[key]
        ch_bankai = Character(**{**ch.__dict__, "hair": hair,
                                 "hair_light": hair_light,
                                 "aura": BANKAI_AURA[key]})
        cfg = anims["bankai"]
        n, dur, loop = cfg["n"], cfg["dur"], cfg.get("loop", False)
        frames, fdata = [], []
        for i in range(n):
            pose = sample_keys(cfg["keys"], i, n, loop)
            sk = compute_skeleton(pose)
            fx = "slash" if 3 <= i <= 8 else None
            img = render_pose(ch_bankai, pose, eyes=2, aura=ch_bankai.aura, fx=fx)
            frames.append(img)
            hbox = None
            for spec in hits.get("bankai", []):
                if spec[0] <= i <= spec[1]:
                    hbox = hit_capsule(sk, spec)
            fdata.append({"d": dur, "h": hurt_capsules(ch_bankai, sk), "a": hbox,
                          "m": muzzle_point(ch_bankai, sk), "e": 2})
        sheet, _ox, _oy, _cw, _chh = sheet_from_frames(frames)
        save_sheet(sheet, folder / "bankai.png")
        meta["anims"]["bankai"]["frames"] = fdata
        if verbose:
            print(f"  {key}/bankai(rang)   {n:>2} kadr")
    (OUT / f"{key}.json").write_text(
        json.dumps(meta, separators=(",", ":")), encoding="utf-8")
    if verbose:
        print(f"  {key}: jami {total} kadr -> {folder}")
    return meta


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    print("Spritesheetlar yaratilmoqda...")
    for key, ch in CHARS.items():
        gen_character(key, ch)
    print("Tayyor!")


if __name__ == "__main__":
    main()
