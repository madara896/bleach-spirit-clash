/**
 * match.ts — o'yin qoidalari: to'qnashuv, raundlar, taymer, hisob.
 *
 * Bu modul o'yin holatining YAG'ONA egasi. Tarmoqlanishda p1 shu modulni
 * to'liq simulyatsiya qilib, holatni `snapshot()` orqali boshqalarga yuboradi.
 */

import { SUPER_COST, comboScale } from "./chars";
import { Fighter } from "./fighter";
import { capsuleHit, clamp, pointSegDist2 } from "./physics";
import { PROJ, spawnProjectile, updateProjectiles } from "./projectile";
import type { Projectile } from "./projectile";
import { SCALE, SPR_GROUND_Y, SPR_PELVIS_X, STAGE_W } from "./types";
import type { ButtonMask, CharData, CharDef, FighterState, SpriteBank } from "./types";

export const ROUND_TIME = 99;
export const ROUNDS_TO_WIN = 2;
export const PUSH_W = 74;
export const PUSH_H = 296;

export type MatchPhase =
  | "menu"
  | "intro"     // "ROUND 1 / FIGHT!"
  | "fight"
  | "ko"
  | "roundEnd"
  | "matchEnd";

export interface MatchEvent {
  type: "hit" | "block" | "ko" | "round" | "match" | "special" | "bankai";
  x: number;
  y: number;
  heavy: boolean;
  who: 0 | 1;
  color?: string;
}

export class Match {
  fighters: [Fighter, Fighter];
  projectiles: Projectile[] = [];
  phase: MatchPhase = "menu";
  phaseTick = 0;
  timer = ROUND_TIME;
  roundIndex = 0;
  wins: [number, number] = [0, 0];
  /** g'alibani aniqlash uchun */
  winner: 0 | 1 | -1 = -1;
  events: MatchEvent[] = [];

  constructor(
    defs: [CharDef, CharDef], data: [CharData, CharData],
    sprites: [SpriteBank, SpriteBank],
  ) {
    this.fighters = [
      new Fighter(defs[0], data[0], sprites[0], 0),
      new Fighter(defs[1], data[1], sprites[1], 1),
    ];
  }

  get p1() { return this.fighters[0]; }
  get p2() { return this.fighters[1]; }

  // -------------------------------------------------------------------------
  // Boshqaruv
  // -------------------------------------------------------------------------
  startMatch() {
    this.roundIndex = 0;
    this.wins = [0, 0];
    this.winner = -1;
    this.projectiles.length = 0;
    this.startRound();
  }

  startRound() {
    const cx = STAGE_W / 2;
    this.p1.reset(cx - 190, 1);
    this.p2.reset(cx + 190, -1);
    this.projectiles.length = 0;
    this.timer = ROUND_TIME;
    this.phase = "intro";
    this.phaseTick = 0;
    this.p1.setIntro();
    this.p2.setIntro();
  }

  // -------------------------------------------------------------------------
  // Asosiy qadam
  // -------------------------------------------------------------------------
  step(inputs: [ButtonMask, ButtonMask]) {
    this.events.length = 0;
    this.phaseTick++;

    if (this.phase === "menu" || this.phase === "matchEnd") return;

    const [a, b] = this.fighters;

    if (this.phase === "intro") {
      if (this.phaseTick === 1) {
        this.events.push({ type: "round", x: STAGE_W / 2, y: -330, heavy: false, who: 0 });
      }
      if (this.phaseTick >= 96) {
        this.phase = "fight";
        this.phaseTick = 0;
        a.releaseIntro();
        b.releaseIntro();
      }
      // harakatni to'xtatamiz
      a.update(0, b);
      b.update(0, a);
      return;
    }

    if (this.phase === "roundEnd") {
      a.update(0, b);
      b.update(0, a);
      this.separate();
      if (this.phaseTick >= 150) {
        if (this.wins[0] >= ROUNDS_TO_WIN || this.wins[1] >= ROUNDS_TO_WIN) {
          this.phase = "matchEnd";
          this.winner = this.wins[0] > this.wins[1] ? 0 : 1;
          this.events.push({ type: "match", x: STAGE_W / 2, y: -340, heavy: true, who: this.winner });
          const w = this.fighters[this.winner];
          w.setVictory();
        } else {
          this.startRound();
        }
      }
      return;
    }

    // --- "fight" ---
    if (this.phase === "fight") {
      this.timer -= 1 / 60;
      if (this.timer <= 0) { this.timer = 0; this.endRoundByTime(); }
    }

    // --- kiritishni berish ---
    a.update(inputs[0], b);
    b.update(inputs[1], a);

    // --- yuzlanish ---
    if (a.state !== "knockdown" && a.state !== "getup") a.faceTowards(b.x);
    if (b.state !== "knockdown" && b.state !== "getup") b.faceTowards(a.x);

    // --- projectile yaratish ---
    this.spawnFrom(a);
    this.spawnFrom(b);

    // --- to'qnashuv: p1 urmoqda, p2 ga qarshi ---
    this.resolveMelee(a, b);
    this.resolveMelee(b, a);

    // --- projectile to'qnashuvi ---
    this.resolveProjectiles();

    // --- pushbox ---
    this.separate();

    // --- zaxira: devorda turib qolmasin ---
    for (const f of this.fighters) {
      f.x = clamp(f.x, PUSH_W / 2, STAGE_W - PUSH_W / 2);
    }

    // --- raund tugashini tekshirish ---
    if (this.phase === "fight") {
      if (!a.alive || !b.alive) {
        const loserIdx: 0 | 1 = !a.alive ? 0 : 1;
        this.wins[loserIdx === 0 ? 1 : 0]++;
        const winner = this.fighters[loserIdx === 0 ? 1 : 0];
        if (!winner.alive) this.wins[winner.index]++; // chizma
        this.phase = "ko";
        this.phaseTick = 0;
        this.winner = loserIdx === 0 ? 1 : 0;
        this.events.push({
          type: "ko", x: this.fighters[loserIdx].x, y: -180,
          heavy: true, who: loserIdx,
        });
      }
    }
    if (this.phase === "ko" && this.phaseTick >= 110) {
      this.phase = "roundEnd";
      this.phaseTick = 0;
    }
  }

  private endRoundByTime() {
    // qolgan sog'lig'i ko'p bo'lgan yutadi
    const ra = this.p1.health / this.p1.maxHealth;
    const rb = this.p2.health / this.p2.maxHealth;
    const w: 0 | 1 = ra > rb ? 0 : 1;
    this.wins[w]++;
    this.winner = w;
    this.phase = "ko";
    this.phaseTick = 60; // "TIME UP" ko'rsatish uchun
  }

  // -------------------------------------------------------------------------
  // To'qnashuv
  // -------------------------------------------------------------------------
  private spawnFrom(f: Fighter) {
    if (!f.move) return;
    const m = f.move;
    if (!m.projectile || !f.projectileSpawned) return;
    if (f.phaseSpawned) return;
    f.phaseSpawned = true;
    const fr = f.frame;
    const mu = fr?.m ?? [SPR_PELVIS_X + 120, SPR_GROUND_Y - 170];
    const w = f.toWorld(mu[0], mu[1]);
    this.projectiles.push(spawnProjectile(m.projectile, f, w));
    this.events.push({
      type: m.kind === "super" ? "bankai" : "special",
      x: w.x, y: w.y, heavy: m.kind === "super", who: f.index,
      color: PROJ[m.projectile].color,
    });
  }

  private resolveMelee(atk: Fighter, def: Fighter) {
    const hb = atk.hitboxWorld;
    if (!hb || hb.connected) return;
    if (!atk.move) return;
    if (atk.invuln > 0) return;
    if (def.invuln > 0) return;

    // Zarba kapsulasi va dushman og'irlik kapsulalari kesishuvi.
    // Kapsulalar sprite o'qida "o'ngga qaragan" holda chizilgan, shuning
    // uchun chapga qaraganda X koordinatasi pelvis atrofida akslanadi.
    const c = hb.cap;
    const A = atk.toWorld(c[0], c[1]);
    const B = atk.toWorld(c[2], c[3]);
    const r = c[4] * SCALE;
    const ax1 = atk.facing === 1 ? A.x : 2 * atk.x - A.x;
    const ax2 = atk.facing === 1 ? B.x : 2 * atk.x - B.x;

    let hit = false;
    for (const h of def.lastFrameHurt) {
      const p1 = def.toWorld(h[0], h[1]);
      const p2 = def.toWorld(h[2], h[3]);
      const hr = h[4] * SCALE;
      if (capsuleHit(ax1, A.y, ax2, B.y, r, p1.x, p1.y, p2.x, p2.y, hr)) {
        hit = true; break;
      }
    }
    if (!hit) return;

    hb.connected = true;
    atk.markHitWindow(hb.window);
    this.applyHit(atk, def, atk.move, ax1, A.y);
  }

  private applyHit(atk: Fighter, def: Fighter, m: NonNullable<Fighter["move"]>, hx: number, hy: number) {
    const dir = atk.facing;
    // blok: dushman orqaga qaragan holda turib yoki "block" holatida
    const blocking = (def.state === "block_stand" || def.state === "block_crouch") ||
      (def.grounded && !def.move && def.hitstun <= 0 &&
        facingAway(def, atk) && !defIsAttacking(def));

    const scale = comboScale(atk.comboHits + 1);
    const res = def.takeHit(
      m.damage, m.hitstun, m.pushback, blocking, dir, m.launch, scale,
    );
    if (res === "miss") return;

    if (res === "block") {
      atk.meter = clamp(atk.meter + m.meterGain * 0.4, 0, 100);
      this.events.push({ type: "block", x: hx, y: hy, heavy: false, who: def.index });
      return;
    }

    // kombinatsiya
    atk.comboHits++;
    atk.comboDamage += m.damage * scale;
    atk.comboTimer = 70;
    atk.meter = clamp(atk.meter + m.meterGain, 0, 100);
    def.comboHits = 0;
    def.comboTimer = 0;

    // zarba turiga qarab yiqilish
    if (m.launch > 0) def.knockdown_(dir);
    else if ((m.kind === "special" || m.kind === "super") && def.health > 0) {
      def.knockdown_(dir);
    }

    this.events.push({
      type: "hit", x: hx, y: hy,
      heavy: m.damage > 60 || m.kind === "special" || m.kind === "super",
      who: def.index, color: m.kind === "super" ? "#FFC24A" : undefined,
    });
  }

  private resolveProjectiles() {
    for (const p of this.projectiles) {
      const d = PROJ[p.kind];
      const target = this.fighters[p.owner === 0 ? 1 : 0];
      const owner = this.fighters[p.owner];
      if (target.invuln > 0) continue;
      if ((p.hitMask & (p.owner === 0 ? 2 : 1)) !== 0) {
        // allaqachon teggan, lekin ko'p urishli to'lqin — oraliqdan o'tkazib yuborish
        continue;
      }
      let hit = false;
      for (const h of target.lastFrameHurt) {
        const q1 = target.toWorld(h[0], h[1]);
        const q2 = target.toWorld(h[2], h[3]);
        const hr = h[4] * SCALE;
        const rr = d.r * SCALE;
        if (pointSegDist2(p.x, p.y, q1.x, q1.y, q2.x, q2.y) <= (rr + hr) * (rr + hr)) {
          hit = true; break;
        }
      }
      if (!hit) continue;

      p.hitMask |= p.owner === 0 ? 2 : 1;
      const dir = p.vx > 0 ? 1 : -1;
      const blocking = target.state === "block_stand" || target.state === "block_crouch" ||
        (target.grounded && !target.move && target.hitstun <= 0 && facingAway(target, owner) && !defIsAttacking(target));
      const scale = comboScale(owner.comboHits + 1);
      const res = target.takeHit(d.damage, d.hitstun, d.pushback, blocking, dir, 0, scale);

      if (res === "block") {
        this.events.push({ type: "block", x: p.x, y: p.y, heavy: false, who: target.index });
        p.life = Math.min(p.life, 6);
      } else if (res === "hit") {
        owner.comboHits++;
        owner.comboDamage += d.damage * scale;
        owner.comboTimer = 70;
        owner.meter = clamp(owner.meter + 7, 0, 100);
        target.comboHits = 0;
        this.events.push({
          type: "hit", x: p.x, y: p.y, heavy: true, who: target.index, color: d.color,
        });
        if (d.maxHits <= 1) p.life = 0;
      }
    }
    updateProjectiles(this.projectiles);
  }

  /** Ikki belgining pushbox'lari bir-biriga tegmasin. */
  private separate() {
    const [a, b] = this.fighters;
    if (a.state === "knockdown" && b.state === "knockdown") return;
    const dx = b.x - a.x;
    const dist = Math.abs(dx);
    const minD = PUSH_W;
    if (dist >= minD) return;
    // yonma-yon turganlar (bitta tomonga) — surishni to'xtatamiz
    if ((a.x < 60 && b.x < 60) || (a.x > STAGE_W - 60 && b.x > STAGE_W - 60)) return;

    // to'liq ustma-ust tushgan holat: yuzalariga qarab ajratamiz
    const s = dist < 0.001 ? (a.facing === 1 ? 1 : -1) : Math.sign(dx);
    const overlap = minD - dist;
    const aw = a.def.weight;
    const bw = b.def.weight;
    const total = aw + bw;
    a.x -= s * overlap * (bw / total);
    b.x += s * overlap * (aw / total);
  }

  // -------------------------------------------------------------------------
  // Holat ko'rinishi (tarmoqlanish uchun)
  // -------------------------------------------------------------------------
  snapshot(): MatchSnap {
    return {
      phase: this.phase,
      phaseTick: this.phaseTick,
      timer: this.timer,
      round: this.roundIndex,
      wins: [this.wins[0], this.wins[1]],
      winner: this.winner,
      p: this.fighters.map(snapFighter) as [FSnap, FSnap],
      j: this.projectiles.map((p) => ({
        i: p.id, k: p.kind, o: p.owner, x: p.x, y: p.y, a: p.age,
      })),
    };
  }
}

export interface FSnap {
  x: number; y: number; vx: number; vy: number; f: 1 | -1;
  hp: number; mp: number; st: FighterState; an: string; fr: number; at: number;
  hs: number; bs: number; iv: number; cv: number; dh: number; dc: number;
  mc: number;
}

export interface MatchSnap {
  phase: MatchPhase;
  phaseTick: number;
  timer: number;
  round: number;
  wins: [number, number];
  winner: 0 | 1 | -1;
  p: [FSnap, FSnap];
  j: Array<{ i: number; k: string; o: 0 | 1; x: number; y: number; a: number }>;
}

export function snapFighter(f: Fighter): FSnap {
  return {
    x: Math.round(f.x * 100) / 100,
    y: Math.round(f.y * 100) / 100,
    vx: Math.round(f.vx * 100) / 100,
    vy: Math.round(f.vy * 100) / 100,
    f: f.facing,
    hp: Math.round(f.health),
    mp: Math.round(f.meter * 10) / 10,
    st: f.state,
    an: f.anim,
    fr: f.animFrame,
    at: f.animTick,
    hs: f.hitstun,
    bs: f.blockstun,
    iv: f.invuln,
    cv: f.comboHits,
    dh: Math.round(f.comboDamage),
    dc: f.comboTimer,
    mc: f.move ? 1 : 0,
  };
}

/** `def` `atk`ga qaragan holda orqaga qarayaptimi? */
function facingAway(def: Fighter, atk: Fighter): boolean {
  const away = def.facing === 1
    ? (def.x - atk.x) > 0     // o'ngga qaragan -> dushman chapda bo'lishi kerak
    : (def.x - atk.x) < 0;
  return away;
}

function defIsAttacking(f: Fighter): boolean {
  return f.move !== null && (f.move.kind === "normal" || f.move.kind === "special");
}

export { SUPER_COST };
