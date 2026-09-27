/**
 * physics.ts — kapsula to'qnashuvi, segment masofasi, matematik yordamchilar.
 */

/** Ikki nuqta orasidagi kvadrat masofa. */
export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** X soni 0..1 oralig'iga siqiladi. */
export function smoothstep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/**
 * Ikki nuqta (p3-p1) va (q3-q2) orasidagi minimal masofa.
 * Uchburchak to'g'riligi formulasidan — ancha tez.
 */
export function segSegDist2(
  px: number, py: number,
  qx: number, qy: number,
  rx: number, ry: number,
  sx: number, sy: number,
): number {
  const dx = rx - px;
  const dy = ry - py;
  const ex = sx - qx;
  const ey = sy - qy;
  const wx = px - qx;
  const wy = py - qy;
  const a = dx * dx + dy * dy;
  const b = dx * ex + dy * ey;
  const c = ex * ex + ey * ey;
  const d = dx * wx + dy * wy;
  const f = ex * wx + ey * wy;
  const den = a * c - b * b;

  let s: number;
  let t: number;
  if (den < 1e-9) {
    // parallel
    s = 0;
    t = c > 1e-9 ? f / c : 0;
  } else {
    s = (b * f - c * d) / den;
    t = (a * f - b * d) / den;
  }
  s = clamp(s, 0, 1);
  t = clamp(t, 0, 1);
  // qayta chegaralashdan keyin eng yaqin nuqtani topamiz
  const cx = wx + s * dx - t * ex;
  const cy = wy + s * dy - t * ey;
  return cx * cx + cy * cy;
}

/** Nuqta va segment orasidagi kvadrat masofa. */
export function pointSegDist2(
  px: number, py: number, qx: number, qy: number, rx: number, ry: number,
): number {
  const ex = rx - qx;
  const ey = ry - qy;
  const len2 = ex * ex + ey * ey;
  if (len2 < 1e-9) {
    const dx = px - qx;
    const dy = py - qy;
    return dx * dx + dy * dy;
  }
  let t = ((px - qx) * ex + (py - qy) * ey) / len2;
  t = clamp(t, 0, 1);
  const cx = px - (qx + t * ex);
  const cy = py - (qy + t * ey);
  return cx * cx + cy * cy;
}

/** Kapsulalar to'qnashdimi? */
export function capsuleHit(
  ax1: number, ay1: number, ax2: number, ay2: number, ar: number,
  bx1: number, by1: number, bx2: number, by2: number, br: number,
): boolean {
  const rr = ar + br;
  return segSegDist2(ax1, ay1, bx1, by1, ax2, ay2, bx2, by2) <= rr * rr;
}

/** Nuqta kapsulaning ichida-mi? */
export function pointInCapsule(
  px: number, py: number,
  x1: number, y1: number, x2: number, y2: number, r: number,
): boolean {
  return dist2(px, py, x1, y1) <= r * r || dist2(px, py, x2, y2) <= r * r ||
    segSegDist2(px, py, x1, y1, px, py, x2, y2) <= r * r;
}

/** Soxta tasodifiy sonlar (takrorlanuvchi). */
export class Rng {
  private s: number;
  constructor(seed = 0x2f6e2b1) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    // xorshift32
    let x = this.s;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.s = x;
    return x / 0x100000000;
  }
  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  reset(seed: number) {
    this.s = seed >>> 0 || 1;
  }
}
