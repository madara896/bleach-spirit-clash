/**
 * render.ts — canvas chizish.
 *
 * Kamera oyin dunyosini VIEW_W x VIEW_H oynaga siqadi. Sahifa 2400px, kamera
 * 1280px — shuning uchun `camX` belgilar o'rtasini ushlab turadi.
 */

import { Fighter } from "./fighter";
import { FxSystem } from "./effects";
import { Match, ROUNDS_TO_WIN } from "./match";
import { PROJ } from "./projectile";
import type { Projectile } from "./projectile";
import { clamp } from "./physics";
import {
  CAMERA_SCALE, SCALE, SPR_FRAME_H, SPR_FRAME_W, SPR_GROUND_Y,
  SPR_PELVIS_X, STAGE_W, VIEW_H, VIEW_W,
} from "./types";
import type { ButtonMask } from "./types";

// ---------------------------------------------------------------------------
// Fon qatlamlari
// ---------------------------------------------------------------------------
/**
 * Sahna PNG'lari `gen_stage.py` tomonidan chiziladi. Ularning ichki
 * koordinat tizimi o'yin o'qidan farq qiladi:
 *
 *   - rasmda `GROUND_IMG_Y` (600) = yerga tegish chizig'i
 *   - rasm kengligi `STAGE_W` dan katta bo'lishi mumkin (parallax uchun)
 *
 * Shuning uchun `anchorY` — rasmda qaysi qator ekrandagi yerga tushishi kerak.
 */
export const GROUND_IMG_Y = 600;

export interface StageLayer {
  img: HTMLImageElement;
  /** gorizontal parallax koeffitsienti (0 = harakatsiz, 1 = to'liq) */
  factor: number;
  /** o'lcham masshtabi */
  scale: number;
  /** rasmdagi shu qator yerga tushadi */
  anchorY: number;
  /** qo'shimcha vertikal siljish (px, ekran) */
  offsetY?: number;
}
export interface StageSet {
  sky: StageLayer;
  far: StageLayer;
  mid: StageLayer;
  near: StageLayer;
  /** sahifa balandligi (world) */
  worldH: number;
}

const LAYER_ORDER: Array<keyof Omit<StageSet, "worldH">> = ["sky", "far", "mid", "near"];

export function drawStage(
  ctx: CanvasRenderingContext2D, stage: StageSet, camX: number, camY: number,
) {
  // Yerga tegish chizig'ining ekrandagi joyi
  const groundScreenY = (0 - camY) * CAMERA_SCALE;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  for (const key of LAYER_ORDER) {
    const L = stage[key];
    if (!L?.img || !L.img.width) continue;
    const s = L.scale * CAMERA_SCALE;
    const w = L.img.width * s;
    const h = L.img.height * s;
    const ox = -camX * L.factor * CAMERA_SCALE;
    const oy = groundScreenY - L.anchorY * s + (L.offsetY ?? 0);
    // takrorlash — parallax uchun rasm keng bo'lganda chegaradan chiqmasin
    if (w <= 0 || h <= 0) continue;
    let x = ox;
    if (x > 0) x = ox - Math.ceil(x / w) * w;
    for (; x < VIEW_W; x += w) {
      ctx.drawImage(L.img, x, oy, w, h);
    }
    // eng oldingi qatlam (yo'l) ekranning pastki qismini to'liq qoplashi kerak;
    // kamera tepaga ko'tilganda pastda bo'sh joy qolmasin
    if (key === "near" && oy + h < VIEW_H) {
      ctx.fillStyle = ROAD_FILL;
      ctx.fillRect(0, Math.max(0, oy + h), VIEW_W, VIEW_H - Math.max(0, oy + h));
    }
  }
  ctx.restore();
}

/** Yo'l qatlami tugagandan keyin pastdagi bo'sh joyni to'ldiruvchi rang. */
const ROAD_FILL = "#1E1A26";

// ---------------------------------------------------------------------------
// Belgilar
// ---------------------------------------------------------------------------
export function drawFighter(
  ctx: CanvasRenderingContext2D, f: Fighter, camX: number, camY: number,
  timeMs: number,
) {
  const img = f.sprites[f.anim];
  if (!img || !img.width) return;
  const data = f.animData;
  if (!data) return;

  // sprite lentasi KONTENT BO'YICHA qirqilgan: kadr o'lchami va joyi
  // animatsiya ma'lumotida berilgan (renderer/generator qisqartirgan).
  const fi = clamp(f.animFrame, 0, data.n - 1);
  const cw = data.cw || SPR_FRAME_W;
  const ch = data.ch || SPR_FRAME_H;
  const ox = data.ox ?? 0;
  const oy = data.oy ?? 0;

  // sprite koordinatalarini kamera/world o'qiga o'tkazamiz
  const px = (f.x - camX) * CAMERA_SCALE + VIEW_W / 2;
  const py = (f.y - camY) * CAMERA_SCALE;

  // gizlantirish (blok/qabul qilish payti)
  let alpha = 1;
  if (f.invuln > 0 && (f.state === "dash" || f.state === "backdash" || f.state === "bankai")) {
    alpha = 0.45 + 0.35 * Math.sin(timeMs / 40);
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(px, py);
  ctx.scale(f.facing * CAMERA_SCALE, CAMERA_SCALE);
  // Sprite pelvisi (SPR_PELVIS_X, SPR_GROUND_Y) o'yin nuqtasiga to'g'ri kelishi uchun
  // qirqilgan kadr o'z joyini (ox, oy) saqlashi kerak.
  ctx.drawImage(
    img, fi * cw, oy, cw, ch,
    -SPR_PELVIS_X + ox, -SPR_GROUND_Y + oy, cw, ch,
  );
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Projectile'lar
// ---------------------------------------------------------------------------
export function drawProjectiles(
  ctx: CanvasRenderingContext2D, list: Projectile[], camX: number, camY: number,
  timeMs: number,
) {
  for (const p of list) {
    const d = PROJ[p.kind];
    const x = (p.x - camX) * CAMERA_SCALE + VIEW_W / 2;
    const y = (p.y - camY) * CAMERA_SCALE;
    const s = d.size * SCALE * CAMERA_SCALE * (0.9 + 0.1 * Math.sin(timeMs / 60 + p.seed));
    const dir = p.vx >= 0 ? 1 : -1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    ctx.globalCompositeOperation = "lighter";

    if (d.kind === "crescent") {
      // qizil to'lqin yarimoy
      const g = ctx.createRadialGradient(0, 0, s * 0.1, 0, 0, s * 0.7);
      g.addColorStop(0, "#FFF3C0");
      g.addColorStop(0.35, d.color);
      g.addColorStop(1, "rgba(255,110,20,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.7, s * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      // o'tkir uch
      ctx.fillStyle = d.color2;
      ctx.beginPath();
      ctx.moveTo(s * 0.1, -s * 0.42);
      ctx.quadraticCurveTo(s * 0.8, 0, s * 0.1, s * 0.42);
      ctx.quadraticCurveTo(s * 0.35, 0, s * 0.1, -s * 0.42);
      ctx.fill();
    } else if (d.kind === "bolt") {
      // kichik portlab chiqadigan nishon
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.6);
      g.addColorStop(0, "#FFFFFF");
      g.addColorStop(0.4, d.color2);
      g.addColorStop(1, "rgba(80,110,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = d.color2;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(s * 0.3, 0, s * 0.42, s * 0.16, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // keng ko'lamli halqa
      const r = s * 0.5;
      const g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
      g.addColorStop(0, "rgba(90,120,255,0.05)");
      g.addColorStop(0.55, d.color);
      g.addColorStop(0.85, d.color2);
      g.addColorStop(1, "rgba(120,150,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = d.color2;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Effektlar
// ---------------------------------------------------------------------------
export function drawFx(
  ctx: CanvasRenderingContext2D, fx: FxSystem, layer: 0 | 1,
  camX: number, camY: number, timeMs: number,
) {
  ctx.save();
  for (const f of fx.all) {
    if (f.layer !== layer) continue;
    const t = f.life / f.maxLife;
    const x = (f.x - camX) * CAMERA_SCALE + VIEW_W / 2;
    const y = (f.y - camY) * CAMERA_SCALE;
    const s = f.size * CAMERA_SCALE * (1.1 - t * 0.35);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(f.rot);
    ctx.globalAlpha = clamp(t, 0, 1);
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = f.color;

    switch (f.kind) {
      case "hit":
      case "hitHeavy": {
        // yulduzsimon uchqun
        const spikes = f.kind === "hitHeavy" ? 8 : 6;
        ctx.beginPath();
        for (let i = 0; i < spikes * 2; i++) {
          const a = (i / (spikes * 2)) * Math.PI * 2;
          const rr = i % 2 === 0 ? s * 0.5 : s * 0.18;
          const ex = Math.cos(a) * rr, ey = Math.sin(a) * rr * 0.7;
          if (i === 0) ctx.moveTo(ex, ey);
          else ctx.lineTo(ex, ey);
        }
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = t * 0.6;
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.3 * t + 6, 0, Math.PI * 2);
        ctx.fillStyle = "#FFFFFF";
        ctx.fill();
        break;
      }
      case "block": {
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.42 * (1.2 - t), -0.9, 0.9);
        ctx.stroke();
        break;
      }
      case "dust":
      case "land":
      case "jump": {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = f.color;
        ctx.globalAlpha = t * 0.42;
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 0.5 * (1.4 - t * 0.6), s * 0.26 * (1.4 - t * 0.6), 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "getsuga":
      case "shakaho":
      case "sokatsui": {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.6);
        g.addColorStop(0, f.color);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.55 * (0.5 + t * 0.6), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "bankai": {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.6 * (0.3 + t));
        g.addColorStop(0, `rgba(255,230,150,${t})`);
        g.addColorStop(0.5, `rgba(255,180,60,${t * 0.7})`);
        g.addColorStop(1, "rgba(255,120,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.6 * (0.3 + t), 0, Math.PI * 2);
        ctx.fill();
        // yorqin nur
        ctx.strokeStyle = `rgba(255,240,190,${t})`;
        ctx.lineWidth = 5;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2 + timeMs / 900;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * s * 0.2, Math.sin(a) * s * 0.2);
          ctx.lineTo(Math.cos(a) * s * 0.55 * (0.4 + t), Math.sin(a) * s * 0.55 * (0.4 + t));
          ctx.stroke();
        }
        break;
      }
      case "ko": {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.5 * (0.2 + t * 0.9));
        g.addColorStop(0, `rgba(255,255,255,${t})`);
        g.addColorStop(0.6, `rgba(255,210,120,${t * 0.6})`);
        g.addColorStop(1, "rgba(255,150,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.5 * (0.2 + t * 0.9), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "ring": {
        ctx.strokeStyle = `rgba(255,255,255,${t})`;
        ctx.lineWidth = 6 * t;
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.3 + (1 - t) * s * 1.6, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      default: {
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.2 * t, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Kamera
// ---------------------------------------------------------------------------
/**
 * `camY` — oynaning pastki chizig'iga mos keladigan world Y.
 * Yerga chiziq ekranning 100px ostida turadi, shuning uchun pastki qism
 * yo'l bo'lib ko'rinadi.
 */
export function computeCamera(m: Match, shake: number, timeMs: number) {
  const [a, b] = m.fighters;
  const mid = (a.x + b.x) / 2;
  const half = (VIEW_W / 2) / CAMERA_SCALE;
  const s = shake * 15;

  // gorizontal: belgilar o'rtasi, chegaralangan
  let camX = clamp(mid, half, STAGE_W - half);
  camX += Math.sin(timeMs / 19) * s;

  // vertikal: yerga tegish chizig'i ekranning 60px ostida turadi,
  // tepaga qarab yugurilganda kamera ham ko'tariladi
  const highest = Math.min(a.y, b.y); // manfiy = tepada
  const base = -((VIEW_H - 60) / CAMERA_SCALE);
  const follow = -highest * 0.42;
  const camY = base + follow + Math.cos(timeMs / 23) * s * 0.35;

  return { camX, camY };
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
export function drawHud(ctx: CanvasRenderingContext2D, m: Match, timeMs: number) {
  const [a, b] = m.fighters;
  ctx.save();
  ctx.textBaseline = "middle";

  // --- sog'lik paneli ---
  const barW = 430, barH = 26;
  drawHealthBar(ctx, 40, 34, barW, barH, a.health / a.maxHealth, true, a.def.color, a.def.color2, m, 0, timeMs);
  drawHealthBar(ctx, VIEW_W - 40 - barW, 34, barW, barH, b.health / b.maxHealth, false, b.def.color, b.def.color2, m, 1, timeMs);

  // meter
  const mw = 300, mh = 12;
  drawMeter(ctx, 46, 70, mw, mh, a.meter / 100, true, a.def.color2);
  drawMeter(ctx, VIEW_W - 46 - mw, 70, mw, mh, b.meter / 100, false, b.def.color2);

  // ismlar
  ctx.font = "700 21px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "#FFFFFF";
  ctx.shadowColor = "rgba(0,0,0,0.85)"; ctx.shadowBlur = 6;
  ctx.fillText(a.def.name, 40, 104);
  ctx.textAlign = "right";
  ctx.fillText(b.def.name, VIEW_W - 40, 104);
  ctx.shadowBlur = 0;

  // --- taymer ---
  ctx.textAlign = "center";
  const secs = Math.max(0, Math.ceil(m.timer));
  ctx.font = "800 46px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = secs <= 10 ? "#FF6B5A" : "#FFF6DC";
  ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 8;
  ctx.fillText(String(secs).padStart(2, "0"), VIEW_W / 2, 46);
  ctx.shadowBlur = 0;

  // --- raund pipkalari (P1 chapda, P2 o'ngda) ---
  const pipY = 30;
  for (let i = 0; i < ROUNDS_TO_WIN; i++) {
    const x1 = VIEW_W / 2 - 26 - i * 24;
    const x2 = VIEW_W / 2 + 26 + i * 24;
    dot(ctx, x1, pipY, m.wins[0] > i ? a.def.color : "rgba(255,255,255,0.20)");
    dot(ctx, x2, pipY, m.wins[1] > i ? b.def.color : "rgba(255,255,255,0.20)");
  }

  // --- kombinatsiya hisoblagichi ---
  drawCombo(ctx, a, 40, 150, true);
  drawCombo(ctx, b, VIEW_W - 40, 150, false);

  ctx.restore();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawHealthBar(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  pct: number, leftSide: boolean, c1: string, c2: string, m: Match,
  who: 0 | 1, timeMs: number,
) {
  const p = clamp(pct, 0, 1);
  // ramka
  ctx.save();
  ctx.fillStyle = "rgba(8,6,14,0.72)";
  ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x - 3.5, y - 3.5, w + 7, h + 7);

  // "jon" o'zi (sekin qisqaradi) — MK uslubi
  const ghost = m.fighters[who].health / m.fighters[who].maxHealth;
  const gh = clamp(ghost, 0, 1);
  const gx = leftSide ? x + w * (1 - gh) : x;
  const grd0 = ctx.createLinearGradient(0, y, 0, y + h);
  grd0.addColorStop(0, "rgba(255,190,90,0.85)");
  grd0.addColorStop(1, "rgba(255,120,40,0.5)");
  ctx.fillStyle = grd0;
  ctx.fillRect(gx, y, w * gh, h);

  // asosiy
  const bx = leftSide ? x + w * (1 - p) : x;
  const grd = ctx.createLinearGradient(0, y, 0, y + h);
  grd.addColorStop(0, c2);
  grd.addColorStop(0.5, c1);
  grd.addColorStop(1, shade(c1, -0.35));
  ctx.fillStyle = grd;
  ctx.fillRect(bx, y, w * p, h);
  // porlash
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillRect(bx, y, w * p, h * 0.38);
  // 25% chegarasi
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  for (const f of [0.25, 0.5, 0.75]) {
    const lx = x + w * f;
    ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(lx, y + h); ctx.stroke();
  }
  if (p < 0.25) {
    const bl = 0.5 + 0.5 * Math.sin(timeMs / 90);
    ctx.fillStyle = `rgba(255,60,50,${0.18 + bl * 0.2})`;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

function drawMeter(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  pct: number, leftSide: boolean, color: string,
) {
  const p = clamp(pct, 0, 1);
  ctx.save();
  ctx.fillStyle = "rgba(8,6,14,0.7)";
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5);
  const bx = leftSide ? x + w * (1 - p) : x;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "#FFFFFF");
  g.addColorStop(0.4, color);
  g.addColorStop(1, shade(color, -0.4));
  ctx.fillStyle = g;
  ctx.fillRect(bx, y, w * p, h);
  // 100% chizig'i
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.moveTo(leftSide ? x + w * 0.2 : x + w * 0.8, y);
  ctx.lineTo(leftSide ? x + w * 0.2 : x + w * 0.8, y + h);
  ctx.stroke();
  if (p >= 1) {
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

function drawCombo(ctx: CanvasRenderingContext2D, f: Fighter, x: number, y: number, left: boolean) {
  if (f.comboHits < 2) return;
  ctx.save();
  ctx.textAlign = left ? "left" : "right";
  ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 6;
  const n = f.comboHits;
  const pop = 1 + 0.25 * Math.max(0, (f.comboTimer - 60) / 10);
  ctx.font = `800 ${Math.round(34 * pop)}px 'Segoe UI', system-ui, sans-serif`;
  const g = ctx.createLinearGradient(x, y - 18, x, y + 8);
  g.addColorStop(0, "#FFF3C0"); g.addColorStop(1, f.def.color);
  ctx.fillStyle = g;
  ctx.fillText(`${n} HITS`, x, y);
  ctx.font = "700 18px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(`${Math.round(f.comboDamage)} DMG`, x, y + 24);
  ctx.restore();
}

/** O'yin matnlari (ROUND 1 / FIGHT! / K.O. / TIME UP). */
export function drawBanner(ctx: CanvasRenderingContext2D, m: Match) {
  const cx = VIEW_W / 2;
  const cy = 250;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const big = (txt: string, size: number, col: string, y: number) => {
    ctx.font = `900 ${size}px 'Segoe UI', system-ui, sans-serif`;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillText(txt, cx + 3, y + 3);
    const g = ctx.createLinearGradient(0, y - size * 0.6, 0, y + size * 0.6);
    g.addColorStop(0, "#FFFFFF");
    g.addColorStop(0.55, col);
    g.addColorStop(1, shade(col, -0.4));
    ctx.fillStyle = g;
    ctx.fillText(txt, cx, y);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 2;
    ctx.strokeText(txt, cx, y);
  };

  if (m.phase === "intro") {
    const t = m.phaseTick;
    if (t < 46) big(`ROUND ${m.roundIndex + 1}`, 74, "#FFD24A", cy);
    else big("FIGHT!", 92, "#FF6B35", cy);
  } else if (m.phase === "ko") {
    if (m.phaseTick < 30) big("K.O.", 120, "#FF3B30", cy);
    else big("TIME UP", 82, "#FFD24A", cy);
  } else if (m.phase === "matchEnd" && (m.winner === 0 || m.winner === 1)) {
    const w = m.fighters[m.winner];
    if (w) big(`${w.def.name} WINS!`, 62, "#FFD24A", cy);
  }
  ctx.restore();
}

/** Rangni ochaytirish / qoraytirish. */
export function shade(hex: string, amt: number): string {
  const h = hex.replace("#", "");
  let r = parseInt(h.slice(0, 2), 16);
  let g = parseInt(h.slice(2, 4), 16);
  let b = parseInt(h.slice(4, 6), 16);
  if (amt >= 0) {
    r = Math.round(r + (255 - r) * amt);
    g = Math.round(g + (255 - g) * amt);
    b = Math.round(b + (255 - b) * amt);
  } else {
    r = Math.round(r * (1 + amt));
    g = Math.round(g * (1 + amt));
    b = Math.round(b * (1 + amt));
  }
  return `rgb(${r},${g},${b})`;
}

export type { ButtonMask };
