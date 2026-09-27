/**
 * projectile.ts — uchish to'proqlari.
 *
 * Ichiga kiritilgan (ichki) bo'lgani uchun o'yin holati bitta joyda saqlanadi
 * va tarmoqlanishda serverning p1'idan keladi.
 */

import type { Fighter } from "./fighter";
export type ProjKind = "getsuga" | "shakaho" | "sokatsui";

export interface ProjDef {
  speed: number;
  damage: number;
  hitstun: number;
  blockstun: number;
  pushback: number;
  /** radius (o'lcham birligi) */
  r: number;
  /** ikki urish orasidagi minimal kadr (ko'p urishli to'lqin uchun) */
  maxHits: number;
  life: number;
  color: string;
  color2: string;
  y: number;      // spravo boshlang'ich balandligi (belgi yonida)
  size: number;   // chizilish o'lchami
  kind: "crescent" | "bolt" | "ring";
}

export const PROJ: Record<ProjKind, ProjDef> = {
  getsuga: {
    speed: 11.5, damage: 78, hitstun: 22, blockstun: 12, pushback: 6.0,
    r: 34, maxHits: 1, life: 130, color: "#FF7A2A", color2: "#FFE08A",
    y: -168, size: 96, kind: "crescent",
  },
  shakaho: {
    speed: 15.0, damage: 54, hitstun: 18, blockstun: 9, pushback: 3.0,
    r: 22, maxHits: 1, life: 110, color: "#6E8BFF", color2: "#C9D8FF",
    y: -172, size: 46, kind: "bolt",
  },
  sokatsui: {
    speed: 7.2, damage: 62, hitstun: 20, blockstun: 11, pushback: 5.0,
    r: 58, maxHits: 3, life: 150, color: "#4A6BE8", color2: "#B9C8FF",
    y: -170, size: 168, kind: "ring",
  },
};

export interface Projectile {
  id: number;
  kind: ProjKind;
  owner: 0 | 1;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hitMask: number; // 1 | 2 — kimga teggan
  age: number;
  seed: number;
}

let nextId = 1;

export function spawnProjectile(
  kind: ProjKind, owner: Fighter, m: { x: number; y: number },
): Projectile {
  const d = PROJ[kind];
  return {
    id: nextId++,
    kind,
    owner: owner.index,
    x: m.x,
    y: m.y,
    vx: d.speed * owner.facing,
    vy: 0,
    life: d.life,
    hitMask: 0,
    age: 0,
    seed: (id_hash(owner.index, m.x, m.y)),
  };
}

function id_hash(a: number, b: number, c: number): number {
  let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
  h = h >>> 0;
  return h || 7;
}

export function updateProjectiles(list: Projectile[]): void {
  for (const p of list) {
    p.age++;
    p.x += p.vx;
    p.life--;
  }
  // o'ldirilganlarni olib tashlash
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if (p.life <= 0 || p.x < -200 || p.x > 2700) list.splice(i, 1);
  }
}
