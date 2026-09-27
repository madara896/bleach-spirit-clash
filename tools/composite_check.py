"""
composite_check.py — belgi + sahna + kamera kompozitsiyasini tekshiradi.

Bu skript brauzer ker emas: sprite PNG'lar, kadr ma'lumotlari va kamera
mantiqini Python'da takrorlab, o'yin ekrandagi ko'rinishni PNG'ga yozadi.
Shu bilan sprite joylashuvi, masshtab va fon qatlamlari tekshiriladi.
"""

import json
import json
import math
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from rig import (  # noqa: E402
    Character, blend_pose, compute_skeleton, make_pose,
)
from gen_sprites import (  # noqa: E402
    AIZEN, ICHIGO, build_anims, sample_keys,
)

ROOT = Path(__file__).parent.parent
SPR = ROOT / "public" / "assets" / "sprites"
STG = ROOT / "public" / "assets" / "stages" / "karakura"
OUT = ROOT / "preview"

VIEW_W, VIEW_H = 1280, 720
CAMERA_SCALE = 0.95
STAGE_W = 2400
GROUND_IMG_Y = 600
SPR_FRAME_W, SPR_FRAME_H = 560, 448
SPR_GROUND_Y, SPR_PELVIS_X = 404, 280

SKY_ANCHOR = 820


def draw_stage(canvas: Image.Image, cam_x: float, cam_y: float) -> None:
    ground_screen_y = (0 - cam_y) * CAMERA_SCALE
    for name, factor, anchor in (
        ("sky", 0.06, SKY_ANCHOR), ("far", 0.30, GROUND_IMG_Y),
        ("mid", 0.60, GROUND_IMG_Y), ("near", 1.00, GROUND_IMG_Y),
    ):
        img = Image.open(STG / f"{name}.png").convert("RGBA")
        s = CAMERA_SCALE
        w, h = int(img.width * s), int(img.height * s)
        ox = -cam_x * factor * CAMERA_SCALE
        oy = ground_screen_y - anchor * s
        x = ox
        if x > 0:
            x = ox - (int(x // w) + 1) * w
        small = img.resize((w, h), Image.LANCZOS)
        while x < VIEW_W:
            canvas.alpha_composite(small, (int(x), int(oy)))
            x += w


def draw_fighter(canvas: Image.Image, char: Character, key: str, anim: str,
                 frame: int, wx: float, wy: float, cam_x: float, cam_y: float,
                 facing: int) -> None:
    """Sprite lenti KONTENT BO'YICHA qirqilgan — JSON'dagi cw/ch/ox/oy ishlatiladi."""
    meta = json.loads((SPR / f"{key}.json").read_text(encoding="utf-8"))
    a = meta["anims"][anim]
    sheet = Image.open(SPR / key / a["file"]).convert("RGBA")
    cw, ch = a["cw"], a["ch"]
    ox, oy = a["ox"], a["oy"]
    fi = min(frame, a["n"] - 1)
    fr = sheet.crop((fi * cw, 0, (fi + 1) * cw, ch))
    if facing < 0:
        fr = fr.transpose(Image.FLIP_LEFT_RIGHT)
    fr = fr.resize((int(cw * CAMERA_SCALE), int(ch * CAMERA_SCALE)), Image.LANCZOS)
    px = (wx - cam_x) * CAMERA_SCALE + VIEW_W / 2
    py = (wy - cam_y) * CAMERA_SCALE
    dx = px - SPR_PELVIS_X * CAMERA_SCALE + ox * CAMERA_SCALE
    dy = py - SPR_GROUND_Y * CAMERA_SCALE + oy * CAMERA_SCALE
    canvas.alpha_composite(fr, (int(dx), int(dy)))


SCENES = [
    # (nom, ichigo_anim, ichigo_kadr, aizen_anim, aizen_kadr, p1x, p2x, p1y, p2y)
    ("1_mayoda",      "idle", 0,  "idle", 0, 1180, 1300, 0, 0),
    ("2_ataka",       "atk1", 3,  "hit_stand", 0, 1150, 1235, 0, 0),
    ("3_bankai",      "bankai", 5, "knockdown", 3, 1120, 1260, 0, 0),
    ("4_havo",        "air_atk", 2, "crouch", 0, 1200, 1290, -250, 0),
    ("5_otirish",     "crouch_atk", 3, "block_crouch", 0, 1150, 1240, 0, 0),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for (name, ia, iframe, aa, aframe, p1x, p2x, p1y, p2y) in SCENES:
        canvas = Image.new("RGBA", (VIEW_W, VIEW_H), (11, 9, 18, 255))
        cam_x = max((VIEW_W / 2) / CAMERA_SCALE,
                    min(STAGE_W - (VIEW_W / 2) / CAMERA_SCALE, (p1x + p2x) / 2))
        cam_y = -((VIEW_H - 60) / CAMERA_SCALE) + (-min(p1y, p2y) * 0.42)
        draw_stage(canvas, cam_x, cam_y)
        draw_fighter(canvas, ICHIGO, "ichigo", ia, iframe, p1x, p1y, cam_x, cam_y, 1)
        draw_fighter(canvas, AIZEN, "aizen", aa, aframe, p2x, p2y, cam_x, cam_y, -1)
        p = OUT / f"composite_{name}.png"
        canvas.convert("RGB").save(p)
        print("yozildi:", p.name, f"kamera=({cam_x:.0f},{cam_y:.0f})")


if __name__ == "__main__":
    main()
