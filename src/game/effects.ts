/**
 * effects.ts — qisqa muddatli vizual effektlar (zarba, chang, uchqun, iz).
 * Hammasi vaqt asosida ishlaydi va o'yin holatiga kirmaydi (faqat chiziladi),
 * shuning uchun tarmoqlanishda muammo tug'maydi.
 */

import { Rng } from "./physics";

export type FxKind =
  | "hit"        // oddiy zarba uchquni
  | "hitHeavy"   // og'ir zarba uchquni
  | "block"      // blok uchquni
  | "dust"       // yerga yugurish changi
  | "land"       // yerga tushish
  | "jump"       // sakrash
  | "getsuga"    // Getsuga to'lqin izi
  | "shakaho"    // Shakkahō portlash
  | "sokatsui"   // Sōkatsui to'lqin
  | "bankai"     // Bankai portlash
  | "ko"         // KO yulduzi
  | "ring"       // raund boshlanishi halqasi
  | "sparkle";   // umumiy porlash

export interface Fx {
  kind: FxKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  rot: number;
  vrot: number;
  color: string;
  seed: number;
  /** 0 = quyidagi, 1 = yuqoridagi (render qatlami) */
  layer: 0 | 1;
}

const CFG: Record<FxKind, {
  life: number; size: number; color: string; vx: number; vy: number;
  grav: number; layer: 0 | 1; vr: number;
}> = {
  hit:      { life: 16, size: 62,  color: "#FFF4C8", vx: 2.2,  vy: -0.7, grav: 0.02, layer: 1, vr: 0.16 },
  hitHeavy: { life: 24, size: 118, color: "#FFD070", vx: 3.4,  vy: -1.1, grav: 0.03, layer: 1, vr: 0.2 },
  block:    { life: 14, size: 56,  color: "#8FD8FF", vx: 2.6,  vy: -0.4, grav: 0.0,  layer: 1, vr: 0.3 },
  dust:     { life: 22, size: 40,  color: "#9A8E7E", vx: 1.1,  vy: -0.55, grav: 0.0, layer: 0, vr: 0.1 },
  land:     { life: 20, size: 66,  color: "#A99C8A", vx: 2.6,  vy: -0.8, grav: 0.0,  layer: 0, vr: 0.12 },
  jump:     { life: 18, size: 44,  color: "#A99C8A", vx: 1.6,  vy: -0.3, grav: 0.0,  layer: 0, vr: 0.1 },
  getsuga:  { life: 22, size: 90,  color: "#FF8A34", vx: 3.0,  vy: 0,    grav: 0.0,  layer: 1, vr: 0.2 },
  shakaho:  { life: 18, size: 48,  color: "#7E9BFF", vx: 2.4,  vy: 0,    grav: 0.0,  layer: 1, vr: 0.4 },
  sokatsui: { life: 30, size: 170, color: "#5A7BFF", vx: 3.6,  vy: 0,    grav: 0.0,  layer: 1, vr: 0.12 },
  bankai:   { life: 46, size: 300, color: "#FFC24A", vx: 0,    vy: 0,    grav: 0.0,  layer: 1, vr: 0.03 },
  ko:       { life: 40, size: 200, color: "#FFFFFF", vx: 0,    vy: 0,    grav: 0.0,  layer: 1, vr: 0.05 },
  ring:     { life: 34, size: 40,  color: "#FFFFFF", vx: 0,    vy: 0,    grav: 0.0,  layer: 1, vr: 0.1 },
  sparkle:  { life: 26, size: 26,  color: "#FFFFFF", vx: 1.0,  vy: -1.2, grav: 0.04, layer: 1, vr: 0.2 },
};

export class FxSystem {
  private list: Fx[] = [];
  private rng = new Rng(0x51f3a7);
  private id = 1;

  spawn(kind: FxKind, x: number, y: number, color?: string, sizeMul = 1) {
    const c = CFG[kind];
    this.list.push({
      kind, x, y,
      vx: c.vx * this.rng.range(0.5, 1.4),
      vy: c.vy * this.rng.range(0.6, 1.3),
      life: c.life, maxLife: c.life,
      size: c.size * sizeMul * this.rng.range(0.85, 1.2),
      rot: this.rng.range(0, Math.PI * 2),
      vrot: c.vr * this.rng.range(-1, 1),
      color: color ?? c.color,
      seed: this.id++,
      layer: c.layer,
    });
  }

  /** Zarba uchquni — bir nechta kichik bo'lak hosil qiladi. */
  burst(kind: FxKind, x: number, y: number, n = 5, color?: string) {
    for (let i = 0; i < n; i++) this.spawn(kind, x, y, color);
  }

  update() {
    for (const f of this.list) {
      f.x += f.vx;
      f.y += f.vy;
      f.rot += f.vrot;
      const g = CFG[f.kind].grav;
      f.vy -= g;
      f.life--;
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].life <= 0) this.list.splice(i, 1);
    }
    if (this.list.length > 420) this.list.splice(0, this.list.length - 420);
  }

  clear() { this.list.length = 0; }
  get all() { return this.list; }
}
