"""
stage_render_check.py — o'yin kamerasi bilan SAHNA chizishni tekshiradi.

`render.ts` dagi `drawStage` mantiqini aynan takrorlab, haqiqiy kompozit
rasm yasaydi va ko'z bilan tekshirish uchun `preview/render_check.png`
ga yozadi. Bu render.ts geometriyasi o'zgarganda qayta ishga tushiriladi.
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).parent.parent
STG = ROOT / "public" / "assets" / "stages" / "karakura"

VIEW_W, VIEW_H = 1280, 720
CAMERA_SCALE = 0.95
GROUND_IMG_Y = 600
# render.ts: camY = -((VIEW_H - 60) / CAMERA_SCALE) + follow
CAM_Y = -((VIEW_H - 60) / CAMERA_SCALE)

LAYERS = [
    ("sky", 0.06, 820),
    ("far", 0.30, GROUND_IMG_Y),
    ("mid", 0.60, GROUND_IMG_Y),
    ("near", 1.00, GROUND_IMG_Y),
]


def draw_stage(cam_x: float, out: str) -> Path:
    canvas = Image.new("RGBA", (VIEW_W, VIEW_H), (11, 9, 18, 255))
    ground_screen_y = (0 - CAM_Y) * CAMERA_SCALE
    for name, factor, anchor_y in LAYERS:
        img = Image.open(STG / f"{name}.png").convert("RGBA")
        s = CAMERA_SCALE
        w, h = int(img.width * s), int(img.height * s)
        ox = -cam_x * factor * CAMERA_SCALE
        oy = ground_screen_y - anchor_y * s
        x = ox
        if x > 0:
            x = ox - int((x // w) + 1) * w
        while x < VIEW_W:
            canvas.alpha_composite(img.resize((w, h), Image.LANCZOS), (int(x), int(oy)))
            x += w
    p = ROOT / "preview" / out
    p.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(p)
    return p


if __name__ == "__main__":
    for cam, name in ((1200, "render_check_mid.png"), (780, "render_check_left.png"),
                      (1620, "render_check_right.png")):
        p = draw_stage(cam, name)
        print("yozildi:", p)
    print(f"yer chizig'i ekranda: y={(0 - CAM_Y) * CAMERA_SCALE:.0f} "
          f"(ko'rish balandligi {VIEW_H})")
